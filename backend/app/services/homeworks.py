"""Class-scoped homework collection with private, validated file replacement."""

from __future__ import annotations

import errno
import logging
import tempfile
import unicodedata
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import BinaryIO
from uuid import uuid4

from fastapi import HTTPException, UploadFile
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Homework, HomeworkSubmission, User
from app.schemas.homeworks import (
    HomeworkCreateIn,
    HomeworkOut,
    HomeworkRecordOut,
    HomeworkRecordsOut,
    SubmissionOut,
)
from app.services import classes
from app.services.auth import is_admin
from app.services.uploads_common import ALLOWED_DOC_EXTS, ALLOWED_IMAGE_EXTS, sniff_magic
from app.settings import settings

MAX_FILE_BYTES = 20 * 1024 * 1024
ALLOWED_EXTS = ALLOWED_DOC_EXTS | ALLOWED_IMAGE_EXTS | {".zip", ".txt", ".csv", ".md"}
_log = logging.getLogger(__name__)


def storage_root() -> Path:
    path = Path(settings.homework_upload_dir)
    root = path if path.is_absolute() else Path(__file__).resolve().parents[2] / path
    root = root.resolve()
    public = (Path(__file__).resolve().parents[2] / "uploads").resolve()
    if root == public or public in root.parents:
        raise RuntimeError("HOMEWORK_UPLOAD_DIR must not be inside public uploads")
    return root


def private_path(relative: str) -> Path:
    root = storage_root()
    path = (root / relative).resolve()
    if root not in path.parents:
        raise HTTPException(404, "文件不存在")
    return path


def can_manage(user: User, class_id: int) -> bool:
    return classes.is_committee_of(user, class_id) or is_admin(user)


def expected_filename(homework: Homework, user: User) -> str:
    name = user.name.strip() or user.nickname.strip()
    parts = [homework.naming_class, user.sid, name]
    if homework.naming_order == "class-name-id":
        parts = [homework.naming_class, name, user.sid]
    return unicodedata.normalize("NFC", "-".join(parts))


async def get_homework(db: AsyncSession, homework_id: str, class_id: int) -> Homework:
    homework = await db.get(Homework, homework_id)
    if homework is None or homework.class_id != class_id:
        raise HTTPException(404, "作业不存在")
    return homework


async def list_homeworks(db: AsyncSession, user: User, class_id: int) -> list[HomeworkOut]:
    homeworks = (
        await db.scalars(
            select(Homework)
            .where(Homework.class_id == class_id)
            .order_by(Homework.created_at.desc(), Homework.id.desc())
        )
    ).all()
    total = await classes.count_class_members(db, class_id)
    counts = dict(
        (
            await db.execute(
                select(HomeworkSubmission.homework_id, func.count())
                .join(User, User.sid == HomeworkSubmission.sid)
                .join(Homework, Homework.id == HomeworkSubmission.homework_id)
                .where(Homework.class_id == class_id, User.class_id == class_id)
                .group_by(HomeworkSubmission.homework_id)
            )
        ).all()
    )
    own = {
        s.homework_id: s
        for s in (
            await db.scalars(
                select(HomeworkSubmission)
                .join(Homework)
                .where(Homework.class_id == class_id, HomeworkSubmission.sid == user.sid)
            )
        ).all()
    }
    return [homework_out(h, user, own.get(h.id), counts.get(h.id, 0), total) for h in homeworks]


def homework_out(
    h: Homework, user: User, submission: HomeworkSubmission | None, count: int, total: int
) -> HomeworkOut:
    return HomeworkOut(
        id=h.id,
        course=h.course,
        experiment_no=h.experiment_no,
        title=h.title,
        due_at=h.due_at,
        naming_class=h.naming_class,
        naming_order=h.naming_order,
        expected_filename=expected_filename(h, user),
        submission=SubmissionOut.model_validate(submission) if submission else None,
        submitted_count=count,
        total_count=total,
        created_at=h.created_at,
    )


async def create_homework(
    db: AsyncSession, user: User, class_id: int, body: HomeworkCreateIn
) -> HomeworkOut:
    homework = Homework(
        id=uuid4().hex,
        class_id=class_id,
        created_by_sid=user.sid,
        **body.model_dump(exclude={"due_at"}),
        due_at=body.due_at.astimezone(UTC),
    )
    db.add(homework)
    await db.commit()
    await db.refresh(homework)
    return homework_out(homework, user, None, 0, await classes.count_class_members(db, class_id))


async def records_for(
    db: AsyncSession, homework: Homework
) -> list[tuple[User, HomeworkSubmission | None]]:
    return list(
        (
            await db.execute(
                select(User, HomeworkSubmission)
                .outerjoin(
                    HomeworkSubmission,
                    (HomeworkSubmission.sid == User.sid)
                    & (HomeworkSubmission.homework_id == homework.id),
                )
                .where(User.class_id == homework.class_id)
                .order_by(User.sid)
            )
        ).all()
    )


async def collection(db: AsyncSession, homework: Homework, user: User) -> HomeworkRecordsOut:
    rows = await records_for(db, homework)
    own = next((s for u, s in rows if u.sid == user.sid), None)
    return HomeworkRecordsOut(
        homework=homework_out(homework, user, own, sum(s is not None for _, s in rows), len(rows)),
        records=[
            HomeworkRecordOut(
                sid=u.sid,
                name=u.name.strip() or u.nickname,
                filename=s.filename if s else None,
                size=s.size if s else None,
                submitted_at=s.submitted_at if s else None,
            )
            for u, s in rows
        ],
    )


def validate_filename(raw: str | None, expected: str) -> tuple[str, str]:
    name = unicodedata.normalize("NFC", raw or "")
    if len(name) > 255 or any(c in '/\\:*?"<>|' or ord(c) < 32 or ord(c) == 127 for c in name):
        raise HTTPException(400, "文件名包含无效字符")
    ext = Path(name).suffix.lower()
    if not ext or ext not in ALLOWED_EXTS:
        raise HTTPException(400, "支持 PDF、Office 文档、图片、ZIP、TXT、CSV、Markdown 文件")
    if name[: -len(Path(name).suffix)] != expected:
        raise HTTPException(400, f"文件名应为 {expected}{ext}")
    return name, ext


async def write_file(file: UploadFile, homework: Homework, ext: str) -> tuple[str, int]:
    relative = f"{homework.id}/{uuid4().hex}{ext}"
    target = private_path(relative)
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    size = 0
    try:
        with target.open("xb") as output:
            target.chmod(0o600)
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise HTTPException(413, "文件不能超过 20 MB")
                output.write(chunk)
        if not size:
            raise HTTPException(400, "文件为空")
        if ext in ALLOWED_DOC_EXTS | ALLOWED_IMAGE_EXTS:
            # The file is already bounded to 20 MB; Office needs its full ZIP directory.
            if not sniff_magic(ext, target.read_bytes()):
                raise HTTPException(400, "文件内容与类型不符")
        elif ext == ".zip" and not zipfile.is_zipfile(target):
            raise HTTPException(400, "ZIP 文件格式无效")
    except OSError as exc:
        target.unlink(missing_ok=True)
        if exc.errno == errno.ENOSPC:
            raise HTTPException(507, "存储空间不足。请联系发布者") from exc
        raise
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    return relative, size


def unlink_old(relative: str) -> None:
    try:
        private_path(relative).unlink(missing_ok=True)
    except OSError:
        # The committed submission must still be reported as successful.
        _log.exception("Could not remove superseded homework file")


async def save_submission(
    db: AsyncSession, homework: Homework, user: User, file: UploadFile
) -> SubmissionOut:
    name, ext = validate_filename(file.filename, expected_filename(homework, user))
    previous = await db.get(HomeworkSubmission, (homework.id, user.sid))
    previous_path = previous.storage_path if previous else None
    relative, size = await write_file(file, homework, ext)
    now = datetime.now(UTC)
    try:
        # Membership may have changed while a slow upload was in flight.
        current_class = await db.scalar(select(User.class_id).where(User.sid == user.sid))
        if current_class != homework.class_id:
            raise HTTPException(403, "你已不在该班级")
        if previous_path is None:
            db.add(
                HomeworkSubmission(
                    homework_id=homework.id,
                    sid=user.sid,
                    filename=name,
                    storage_path=relative,
                    size=size,
                    submitted_at=now,
                )
            )
        else:
            # A CAS prevents concurrent replacements from deleting the winner's file.
            result = await db.execute(
                update(HomeworkSubmission)
                .where(
                    HomeworkSubmission.homework_id == homework.id,
                    HomeworkSubmission.sid == user.sid,
                    HomeworkSubmission.storage_path == previous_path,
                )
                .values(filename=name, storage_path=relative, size=size, submitted_at=now)
            )
            if result.rowcount != 1:
                raise HTTPException(409, "提交已更新。请刷新后重试")
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        private_path(relative).unlink(missing_ok=True)
        raise HTTPException(409, "提交已更新。请刷新后重试") from exc
    except BaseException:
        await db.rollback()
        private_path(relative).unlink(missing_ok=True)
        raise
    if previous_path:
        unlink_old(previous_path)
    return SubmissionOut(filename=name, size=size, submitted_at=now)


async def get_submission(db: AsyncSession, homework: Homework, sid: str) -> HomeworkSubmission:
    record = await db.scalar(
        select(HomeworkSubmission)
        .join(User)
        .where(
            HomeworkSubmission.homework_id == homework.id,
            HomeworkSubmission.sid == sid,
            User.class_id == homework.class_id,
        )
    )
    if record is None:
        raise HTTPException(404, "提交文件不存在")
    return record


def open_submission(record: HomeworkSubmission) -> BinaryIO:
    try:
        # Open before responding: an atomic replacement may unlink this path later,
        # but the open descriptor still delivers this exact version on Linux/macOS.
        return private_path(record.storage_path).open("rb")
    except FileNotFoundError as exc:
        raise HTTPException(404, "提交文件不存在。请联系发布者") from exc


def build_archive(records: list[HomeworkSubmission]) -> BinaryIO:
    if not records:
        raise HTTPException(400, "还没有可下载的提交")
    output = tempfile.TemporaryFile(mode="w+b")
    try:
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
            for record in records:
                with (
                    open_submission(record) as source,
                    archive.open(record.filename, "w") as target,
                ):
                    while chunk := source.read(1024 * 1024):
                        target.write(chunk)
        output.seek(0)
        return output
    except BaseException:
        output.close()
        raise
