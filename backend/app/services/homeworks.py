"""Class-scoped homework collection with private, validated file replacement."""

from __future__ import annotations

import errno
import logging
import shutil
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
from starlette.concurrency import run_in_threadpool

from app.db.models import Homework, HomeworkSubmission, User
from app.schemas.homeworks import (
    HomeworkCreateIn,
    HomeworkOut,
    HomeworkRecordOut,
    HomeworkRecordsOut,
    SubmissionOut,
    SubmittedFile,
)
from app.services import classes
from app.services.auth import is_admin
from app.services.homework_zip import inspect_android_zip
from app.services.uploads_common import ALLOWED_DOC_EXTS, ALLOWED_IMAGE_EXTS, sniff_magic
from app.settings import settings

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_BATCH_BYTES = 45 * 1024 * 1024
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


def batch_prefixes(homework: Homework, user: User) -> list[str]:
    name = user.name.strip() or user.nickname.strip()
    class_name = homework.naming_class
    alternate = class_name.removesuffix("班") if class_name.endswith("班") else f"{class_name}班"
    prefixes = []
    for label in dict.fromkeys((class_name, alternate)):
        prefixes.extend((f"{label}_{user.sid}_{name}", f"{label}-{user.sid}-{name}-"))
    return [unicodedata.normalize("NFC", prefix) for prefix in prefixes]


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
        required_questions=h.required_questions,
        batch_prefixes=batch_prefixes(h, user) if h.required_questions else None,
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
                files=s.files if s else None,
            )
            for u, s in rows
        ],
    )


def valid_display_name(name: str) -> bool:
    return len(name) <= 255 and not any(
        char in '/\\:*?"<>|' or ord(char) < 32 or ord(char) == 127 for char in name
    )


def validate_filename(raw: str | None, expected: str) -> tuple[str, str]:
    name = unicodedata.normalize("NFC", raw or "")
    if not valid_display_name(name):
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
    if homework.required_questions:
        raise HTTPException(400, "这项作业需要按题批量上传")
    name, ext = validate_filename(file.filename, expected_filename(homework, user))
    previous = await db.get(HomeworkSubmission, (homework.id, user.sid))
    previous_path = previous.storage_path if previous else None
    relative, size = await write_file(file, homework, ext)
    return await commit_submission(db, homework, user, previous_path, name, relative, size)


async def commit_submission(
    db: AsyncSession,
    homework: Homework,
    user: User,
    previous_path: str | None,
    name: str,
    relative: str,
    size: int,
    files: list[SubmittedFile] | None = None,
) -> SubmissionOut:
    now = datetime.now(UTC)
    metadata = [file.model_dump() for file in files] if files else None
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
                    files=metadata,
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
                .values(
                    filename=name,
                    storage_path=relative,
                    size=size,
                    submitted_at=now,
                    files=metadata,
                )
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
    return SubmissionOut(filename=name, size=size, submitted_at=now, files=files)


async def save_batch(
    db: AsyncSession, homework: Homework, user: User, uploads: list[UploadFile]
) -> SubmissionOut:
    required = homework.required_questions
    if not required:
        raise HTTPException(400, "这项作业只接受单文件")
    if len(uploads) > len(required) or len(uploads) < 1:
        raise HTTPException(400, f"请选择 {len(required)} 个压缩包，每题一个")
    if any(file.size is None for file in uploads):
        raise HTTPException(400, "无法读取文件大小，请重新选择")
    if sum(file.size or 0 for file in uploads) > MAX_BATCH_BYTES:
        raise HTTPException(413, "整批文件不能超过 45 MB")

    prefixes = batch_prefixes(homework, user)
    bundle_name = f"{prefixes[0]}-实验{homework.experiment_no}.zip"
    if not valid_display_name(bundle_name) or any(
        not valid_display_name(f"{prefixes[0]}{question}.zip") for question in required
    ):
        raise HTTPException(400, "班级或姓名无法组成有效文件名，请联系发布者")
    filenames = {f"{prefix}{question}": question for prefix in prefixes for question in required}
    candidates: dict[str, UploadFile] = {}
    errors: list[str] = []
    for file in uploads:
        name = unicodedata.normalize("NFC", file.filename or "")
        question = (
            filenames.get(name[:-4])
            if name[-4:].lower() == ".zip" and valid_display_name(name)
            else None
        )
        if question is None:
            errors.append(f"{name[:180]}：请按班级_学号_姓名Xiti章号_题号.zip 命名")
        elif question in candidates:
            errors.append(f"{question}：每题只能上传一个压缩包")
        else:
            candidates[question] = file
    missing = [question for question in required if question not in candidates]
    if missing:
        errors.append("缺少：" + "、".join(missing))
    if errors:
        raise HTTPException(400, "\n".join(errors))

    previous = await db.get(HomeworkSubmission, (homework.id, user.sid))
    previous_path = previous.storage_path if previous else None
    staged: list[tuple[str, SubmittedFile]] = []
    relative = f"{homework.id}/{uuid4().hex}.zip"
    target = private_path(relative)
    try:
        for question in required:
            try:
                path, size = await write_file(candidates[question], homework, ".zip")
            except HTTPException as exc:
                if exc.status_code >= 500:
                    raise
                errors.append(f"{question}：{exc.detail}")
                continue
            metadata = SubmittedFile(
                filename=f"{prefixes[0]}{question}.zip", size=size, question=question, warnings=[]
            )
            staged.append((path, metadata))
            try:
                metadata.warnings = await run_in_threadpool(
                    inspect_android_zip, private_path(path), question, user.name
                )
            except ValueError as exc:
                errors.append(f"{question}：{exc}")
        if errors:
            raise HTTPException(400, "\n".join(errors))
        await run_in_threadpool(pack_batch, target, staged)
        bundle_size = target.stat().st_size
    except OSError as exc:
        unlink_old(relative)
        if exc.errno == errno.ENOSPC:
            raise HTTPException(507, "存储空间不足。请联系发布者") from exc
        raise
    except BaseException:
        unlink_old(relative)
        raise
    finally:
        for path, _ in staged:
            unlink_old(path)
    return await commit_submission(
        db,
        homework,
        user,
        previous_path,
        bundle_name,
        relative,
        bundle_size,
        [metadata for _, metadata in staged],
    )


def pack_batch(target: Path, staged: list[tuple[str, SubmittedFile]]) -> None:
    with target.open("xb") as output:
        target.chmod(0o600)
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
            for path, metadata in staged:
                archive.write(private_path(path), arcname=metadata.filename)


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
                with open_submission(record) as source:
                    if record.files:
                        with zipfile.ZipFile(source) as bundle:
                            for file in record.files:
                                name = file["filename"]
                                with bundle.open(name) as part, archive.open(name, "w") as target:
                                    shutil.copyfileobj(part, target, length=1024 * 1024)
                    else:
                        with archive.open(record.filename, "w") as target:
                            shutil.copyfileobj(source, target, length=1024 * 1024)
        output.seek(0)
        return output
    except BaseException:
        output.close()
        raise
