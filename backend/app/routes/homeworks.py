"""Individual assignment publishing, private submission and collection endpoints."""

from collections.abc import Iterator
from typing import Annotated, BinaryIO
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from app.db.models import User
from app.deps import get_current_user, get_db
from app.schemas.homeworks import (
    HomeworkCreateIn,
    HomeworkListOut,
    HomeworkOut,
    HomeworkRecordsOut,
    SubmissionOut,
)
from app.services import classes
from app.services import homeworks as svc

router = APIRouter(prefix="/classes/me/homeworks", tags=["homeworks"])
CurrentUser = Annotated[User, Depends(get_current_user)]
Database = Annotated[AsyncSession, Depends(get_db)]


def download_response(stream: BinaryIO, filename: str, media_type: str) -> StreamingResponse:
    def chunks() -> Iterator[bytes]:
        try:
            while data := stream.read(1024 * 1024):
                yield data
        finally:
            stream.close()

    return StreamingResponse(
        chunks(),
        media_type=media_type,
        background=BackgroundTask(stream.close),
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.get("", response_model=HomeworkListOut)
async def list_homeworks(user: CurrentUser, db: Database) -> HomeworkListOut:
    class_id = classes.ensure_in_class(user)
    return HomeworkListOut(
        items=await svc.list_homeworks(db, user, class_id),
        can_manage=svc.can_manage(user, class_id),
    )


@router.post("", response_model=HomeworkOut, status_code=201)
async def create_homework(body: HomeworkCreateIn, user: CurrentUser, db: Database) -> HomeworkOut:
    class_id = classes.ensure_in_class(user)
    classes.ensure_committee(user, class_id)
    return await svc.create_homework(db, user, class_id, body)


@router.put("/{homework_id}/submission", response_model=SubmissionOut)
async def upload_submission(
    homework_id: str, file: Annotated[UploadFile, File()], user: CurrentUser, db: Database
) -> SubmissionOut:
    homework = await svc.get_homework(db, homework_id, classes.ensure_in_class(user))
    try:
        return await svc.save_submission(db, homework, user, file)
    finally:
        await file.close()


@router.get("/{homework_id}/submissions", response_model=HomeworkRecordsOut)
async def collection(homework_id: str, user: CurrentUser, db: Database) -> HomeworkRecordsOut:
    class_id = classes.ensure_in_class(user)
    homework = await svc.get_homework(db, homework_id, class_id)
    classes.ensure_committee(user, class_id)
    return await svc.collection(db, homework, user)


@router.get("/{homework_id}/submissions/{sid}/download")
async def download(
    homework_id: str, sid: str, user: CurrentUser, db: Database
) -> StreamingResponse:
    class_id = classes.ensure_in_class(user)
    homework = await svc.get_homework(db, homework_id, class_id)
    if user.sid != sid:
        classes.ensure_committee(user, class_id)
    record = await svc.get_submission(db, homework, sid)
    return download_response(
        svc.open_submission(record), record.filename, "application/octet-stream"
    )


@router.get("/{homework_id}/export")
async def export(homework_id: str, user: CurrentUser, db: Database) -> StreamingResponse:
    class_id = classes.ensure_in_class(user)
    homework = await svc.get_homework(db, homework_id, class_id)
    classes.ensure_committee(user, class_id)
    records = [s for _, s in await svc.records_for(db, homework) if s is not None]
    stream = await run_in_threadpool(svc.build_archive, records)
    return download_response(
        stream, f"{homework.course}-实验{homework.experiment_no}.zip", "application/zip"
    )
