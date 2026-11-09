"""Lightweight self-test for sync helpers — no HF, no age, stdlib + tar/sqlite3.

    python scripts/sync/selftest.py

Exits non-zero on first failure. Covers the registry shape and the dir_tar /
db_snapshot helpers that the registry-driven push/pull rely on.
"""

from __future__ import annotations

import sqlite3
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import config  # noqa: E402
from _common import archive_dir, extract_dir, sha256_of, snapshot_db  # noqa: E402


def check(cond: bool, msg: str) -> None:
    if not cond:
        print(f"FAIL: {msg}")
        sys.exit(1)
    print(f"ok: {msg}")


# ---- registry / namespacing sanity ----
check(len(config.ARTIFACTS) == 4, "4 artifacts registered")
check({a.kind for a in config.ARTIFACTS} == {"db_snapshot", "dir_tar", "encrypted_tar"}, "all kinds present")
check(config.DATASET_DB_PATH == "state/labnotes.db", "db under state/ namespace")
check(config.DATASET_UPLOADS_PATH == "state/uploads.tar", "uploads under state/ namespace")
check(config.DATASET_HOMEWORKS_PATH == "state/homeworks.tar", "private homeworks under state/ namespace")
check(config.STATE_PREFIX == "state" and config.SCHOOLS_PREFIX == "schools", "prefixes set")

with tempfile.TemporaryDirectory() as td:
    root = Path(td)

    # ---- dir_tar roundtrip ----
    src = root / "uploads"
    (src / "avatars").mkdir(parents=True)
    (src / "avatars" / "a.txt").write_text("hello", encoding="utf-8")
    (src / "notes").mkdir()
    (src / "notes" / "b.bin").write_bytes(b"\x00\x01\x02world")

    tar1 = root / "u1.tar"
    n = archive_dir(src, tar1)
    check(n == 2, f"archived 2 regular files (got {n})")

    time.sleep(1.1)  # prove the archive is mtime-independent
    tar2 = root / "u2.tar"
    archive_dir(src, tar2)
    check(sha256_of(tar1) == sha256_of(tar2), "deterministic tar — identical sha across runs")

    dst = root / "restored" / "uploads"
    m = extract_dir(tar1, dst)
    check(m == 2, f"extracted 2 files (got {m})")
    check((dst / "avatars" / "a.txt").read_text(encoding="utf-8") == "hello", "text file restored")
    check((dst / "notes" / "b.bin").read_bytes() == b"\x00\x01\x02world", "binary file restored")

    # move-aside: re-extracting over an existing dir keeps a .bak
    extract_dir(tar1, dst)
    baks = list(dst.parent.glob("uploads.bak.*"))
    check(len(baks) == 1, "existing dir moved aside to .bak on re-extract")

    # empty / missing source still yields a valid (empty) archive
    empty = root / "empty"
    empty.mkdir()
    check(archive_dir(empty, root / "e.tar") == 0, "empty dir → 0 files, valid tar")
    check(archive_dir(root / "nope", root / "n.tar") == 0, "missing dir → 0 files, valid tar")

    # ---- db_snapshot roundtrip ----
    db = root / "x.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE t(x INTEGER)")
    conn.execute("INSERT INTO t VALUES (42)")
    conn.commit()
    conn.close()
    snap = root / "x.snap.db"
    _used_fallback, note = snapshot_db(db, snap)
    conn = sqlite3.connect(snap)
    val = conn.execute("SELECT x FROM t").fetchone()[0]
    conn.close()
    check(val == 42, f"db snapshot roundtrip ok (method={note})")

print("ALL OK")
