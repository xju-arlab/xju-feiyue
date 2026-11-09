"""Real HTTP coverage for individual assignment permissions and file lifecycle."""

from __future__ import annotations

import io
import zipfile
from datetime import UTC, datetime

import pytest
from sqlalchemy import update

from app.db.models import HomeworkSubmission, User
from app.services import homeworks as svc
from app.services.auth import create_access_token
from app.settings import settings

ROOT = "/classes/me/homeworks"
BODY = {
    "course": "操作系统",
    "experimentNo": 1,
    "title": "进程调度",
    "dueAt": "2026-11-12T23:59:00+08:00",
    "namingClass": "计算机24-3",
    "namingOrder": "class-id-name",
}
FILENAME = "计算机24-3-20240001002-成员乙.txt"


def auth(sid="20240001001"):
    return {"Authorization": f"Bearer {create_access_token(sid)}"}


@pytest.fixture(autouse=True)
def private_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "homework_upload_dir", str(tmp_path / "homeworks"))
    return tmp_path / "homeworks"


async def publish(client, **changes):
    r = await client.post(ROOT, json=BODY | changes, headers=auth())
    assert r.status_code == 201, r.text
    return r.json()


async def put(client, hid, name=FILENAME, data=b"report", sid="20240001002"):
    return await client.put(
        f"{ROOT}/{hid}/submission",
        headers=auth(sid),
        files={"file": (name, data, "application/octet-stream")},
    )


async def test_publish_permissions_and_shape(client, class_setup):
    assert (await client.get(ROOT)).status_code == 401
    for sid in ("20240001002", "20240003001", "20240009001"):
        assert (await client.post(ROOT, json=BODY, headers=auth(sid))).status_code == 403
    task = await publish(client, title="")
    assert task["expectedFilename"] == "计算机24-3-20240001001-班委甲"
    assert task["title"] == ""
    assert task["dueAt"] == "2026-11-12T15:59:00Z"
    assert task["totalCount"] == 4 and task["submittedCount"] == 0
    assert task["submission"] is None
    for sid, allowed in [("20240001002", False), ("20240001001", True), ("20240001004", True)]:
        r = await client.get(ROOT, headers=auth(sid))
        assert r.json()["canManage"] is allowed
        assert len(r.json()["items"]) == 1
    assert (await client.post(ROOT, json=BODY, headers=auth("20240001004"))).status_code == 201


@pytest.mark.parametrize(
    "change",
    [
        {"namingClass": "../unsafe"},
        {"course": "  "},
        {"experimentNo": 0},
        {"namingOrder": "anything"},
        {"dueAt": "2026-11-12T23:59"},
    ],
)
async def test_publish_validates_input(client, class_setup, change):
    assert (await client.post(ROOT, json=BODY | change, headers=auth())).status_code == 422


async def test_isolation_and_download_permissions(client, class_setup):
    hid = (await publish(client))["id"]
    assert (await put(client, hid)).status_code == 200
    member = auth("20240001002")
    other = auth("20240002001")
    assert (await client.get(ROOT, headers=other)).json()["items"] == []
    for suffix in ("submissions", "export", "submissions/20240001002/download"):
        assert (await client.get(f"{ROOT}/{hid}/{suffix}", headers=other)).status_code == 404
    assert (await put(client, hid, sid="20240002001")).status_code == 404
    assert (await client.get(f"{ROOT}/{hid}/submissions", headers=member)).status_code == 403
    assert (await client.get(f"{ROOT}/{hid}/export", headers=member)).status_code == 403
    path = f"{ROOT}/{hid}/submissions/20240001002/download"
    assert (await client.get(path, headers=auth("20240001003"))).status_code == 403
    assert (await client.get(path)).status_code == 401
    for headers in (member, auth(), auth("20240001004")):
        r = await client.get(path, headers=headers)
        assert r.status_code == 200 and r.content == b"report"
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["cache-control"] == "private, no-store"
        assert r.headers["content-disposition"].startswith("attachment;")


async def test_replacement_counts_export_and_private_storage(client, class_setup, private_storage):
    hid = (await publish(client))["id"]
    assert (await put(client, hid, data=b"first")).status_code == 200
    r = await put(client, hid, name="wrong.txt")
    assert r.status_code == 400 and "计算机24-3" in r.json()["detail"]
    path = f"{ROOT}/{hid}/submissions/20240001002/download"
    assert (await client.get(path, headers=auth())).content == b"first"
    assert (await put(client, hid, data=b"replacement")).json()["size"] == 11
    stored = list(private_storage.rglob("*.txt"))
    assert len(stored) == 1 and stored[0].read_bytes() == b"replacement"
    # Private files have neither a public URL nor a path in JSON.
    assert (await client.get(f"/uploads/homeworks/{hid}/{stored[0].name}")).status_code == 404
    own = (await client.get(ROOT, headers=auth("20240001002"))).json()["items"][0]
    assert own["submittedCount"] == 1
    assert own["submission"]["filename"] == FILENAME
    assert "storagePath" not in own["submission"]
    recs = (await client.get(f"{ROOT}/{hid}/submissions", headers=auth())).json()["records"]
    assert len(recs) == 4 and recs[1]["name"] == "成员乙" and recs[1]["filename"] == FILENAME
    exported = await client.get(f"{ROOT}/{hid}/export", headers=auth())
    assert exported.status_code == 200
    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        assert archive.namelist() == [FILENAME]
        assert archive.read(FILENAME) == b"replacement"


async def test_alternate_naming_and_task_independence(client, class_setup):
    first = (await publish(client))["id"]
    second = (await publish(client, namingOrder="class-name-id"))["id"]
    assert (await put(client, second)).status_code == 400
    r = await put(client, second, name="计算机24-3-成员乙-20240001002.txt")
    assert r.status_code == 200
    tasks = {
        t["id"]: t for t in (await client.get(ROOT, headers=auth("20240001002"))).json()["items"]
    }
    assert tasks[first]["submission"] is None
    assert tasks[second]["submittedCount"] == 1
    assert tasks[second]["expectedFilename"] == "计算机24-3-成员乙-20240001002"


async def test_empty_oversized_and_bad_magic_preserve_submission(
    client, class_setup, monkeypatch, private_storage
):
    hid = (await publish(client))["id"]
    assert (await put(client, hid, data=b"old")).status_code == 200
    assert (await put(client, hid, data=b"")).status_code == 400
    monkeypatch.setattr(svc, "MAX_FILE_BYTES", 10)
    assert (await put(client, hid, data=b"x" * 11)).status_code == 413
    for ext, data in [(".pdf", b"not pdf"), (".zip", b"not zip"), (".html", b"x")]:
        assert (await put(client, hid, name=FILENAME[:-4] + ext, data=data)).status_code == 400
    assert len(list(private_storage.rglob("*.txt"))) == 1
    assert not list(private_storage.rglob("*.pdf")) and not list(private_storage.rglob("*.zip"))
    path = f"{ROOT}/{hid}/submissions/20240001002/download"
    assert (await client.get(path, headers=auth())).content == b"old"


async def test_uses_real_name_and_current_class_roster(client, class_setup, db_session):
    hid = (await publish(client))["id"]
    await db_session.execute(
        update(User).where(User.sid == "20240001002").values(nickname="nickname")
    )
    await db_session.commit()
    assert (await put(client, hid)).status_code == 200
    await db_session.execute(
        update(User).where(User.sid == "20240001002").values(class_id=class_setup["other_class"].id)
    )
    await db_session.commit()
    task = (await client.get(ROOT, headers=auth())).json()["items"][0]
    assert task["totalCount"] == 3 and task["submittedCount"] == 0
    assert (
        await client.get(f"{ROOT}/{hid}/submissions/20240001002/download", headers=auth())
    ).status_code == 404


async def test_concurrent_replacement_cas_keeps_winner(
    client, class_setup, session_factory, monkeypatch, private_storage
):
    hid = (await publish(client))["id"]
    assert (await put(client, hid, data=b"old")).status_code == 200
    original = svc.write_file

    async def competing_write(file, homework, ext):
        result = await original(file, homework, ext)
        winner = private_storage / hid / "winner.txt"
        winner.write_bytes(b"winner")
        async with session_factory() as db:
            record = await db.get(HomeworkSubmission, (hid, "20240001002"))
            old_path = record.storage_path
            record.storage_path = f"{hid}/winner.txt"
            record.size = 6
            record.submitted_at = datetime.now(UTC)
            await db.commit()
            svc.private_path(old_path).unlink()
        return result

    monkeypatch.setattr(svc, "write_file", competing_write)
    assert (await put(client, hid, data=b"loser")).status_code == 409
    stored = list(private_storage.rglob("*.txt"))
    assert len(stored) == 1 and stored[0].read_bytes() == b"winner"
    path = f"{ROOT}/{hid}/submissions/20240001002/download"
    assert (await client.get(path, headers=auth())).content == b"winner"


async def test_failed_commit_cleans_new_file(client, class_setup, monkeypatch, private_storage):
    from sqlalchemy.ext.asyncio import AsyncSession

    hid = (await publish(client))["id"]
    assert (await put(client, hid, data=b"old")).status_code == 200

    async def broken_commit(self):
        raise RuntimeError("simulated database failure")

    monkeypatch.setattr(AsyncSession, "commit", broken_commit)
    with pytest.raises(RuntimeError, match="simulated database failure"):
        await put(client, hid, data=b"new")
    stored = list(private_storage.rglob("*.txt"))
    assert len(stored) == 1 and stored[0].read_bytes() == b"old"


async def test_disk_full_removes_partial_file_and_keeps_old(
    client, class_setup, monkeypatch, private_storage
):
    import errno
    from pathlib import Path

    hid = (await publish(client))["id"]
    assert (await put(client, hid, data=b"old")).status_code == 200
    real_open = Path.open

    class FullDisk:
        def __init__(self, stream):
            self.stream = stream

        def __enter__(self):
            return self

        def write(self, data):
            self.stream.write(data[:2])
            raise OSError(errno.ENOSPC, "simulated full disk")

        def __exit__(self, *args):
            self.stream.close()

    def broken_open(path, mode="r", *args, **kwargs):
        stream = real_open(path, mode, *args, **kwargs)
        return FullDisk(stream) if mode == "xb" else stream

    monkeypatch.setattr(Path, "open", broken_open)
    assert (await put(client, hid, data=b"new")).status_code == 507
    files = list(private_storage.rglob("*.txt"))
    assert len(files) == 1 and files[0].read_bytes() == b"old"


async def test_concurrent_first_submission_preserves_winner(
    client, class_setup, session_factory, monkeypatch, private_storage
):
    hid = (await publish(client))["id"]
    original = svc.write_file

    async def competing_create(file, homework, ext):
        result = await original(file, homework, ext)
        winner = private_storage / hid / "winner.txt"
        winner.write_bytes(b"winner")
        async with session_factory() as db:
            db.add(
                HomeworkSubmission(
                    homework_id=hid,
                    sid="20240001002",
                    filename=FILENAME,
                    storage_path=f"{hid}/winner.txt",
                    size=6,
                    submitted_at=datetime.now(UTC),
                )
            )
            await db.commit()
        return result

    monkeypatch.setattr(svc, "write_file", competing_create)
    assert (await put(client, hid, data=b"loser")).status_code == 409
    files = list(private_storage.rglob("*.txt"))
    assert len(files) == 1 and files[0].read_bytes() == b"winner"
