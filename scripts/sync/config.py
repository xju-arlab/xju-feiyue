"""Path constants + on-disk config loader for labnotes-sync.

Single source of truth for where state lives — every other module imports
from here so that tests can swap paths via env vars without poking globals.
"""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass
from pathlib import Path


# Repo root: scripts/sync/<this file> → parents[2] is the Aurash repo root.
REPO_ROOT = Path(__file__).resolve().parents[2]

# What gets snapshotted. Keep these aligned with the plan.
DB_PATH = REPO_ROOT / "backend" / "labnotes.db"
# Uploaded files (avatars + note images). The DB stores absolute
# https://winbeau.top/uploads/... URLs into these, so they must be restored to
# the same path or images 404 after a DB restore.
UPLOADS_DIR = REPO_ROOT / "backend" / "uploads"
# Homework files are private and served through authenticated endpoints only.
# A custom HOMEWORK_UPLOAD_DIR must also be passed to the sync process.
HOMEWORKS_DIR = Path(os.environ.get("HOMEWORK_UPLOAD_DIR", "private/homeworks"))
if not HOMEWORKS_DIR.is_absolute():
    HOMEWORKS_DIR = REPO_ROOT / "backend" / HOMEWORKS_DIR
SECRETS_PATHS = [
    Path("backend/.env.local"),
    Path("frontend/.env.local"),
]

# Schools advisor reference data. Large (~20MB sqlite), not secret, regenerable
# by supervisor-claw → kept out of git and synced plain (no age). It shares the
# one dataset (repo_id from SyncConfig) under the `schools/` namespace, separate
# from the `state/` runtime mirror. Integrity is checked against claw's own
# manifest.json (schools_sqlite_sha256).
SCHOOLS_DATA_DIR = REPO_ROOT / "backend" / "data" / "schools"
SCHOOLS_SQLITE = SCHOOLS_DATA_DIR / "schools.sqlite"
SCHOOLS_MANIFEST = SCHOOLS_DATA_DIR / "manifest.json"
SCHOOLS_FILES = ["schools.sqlite", "manifest.json"]  # local filenames
SCHOOLS_PREFIX = "schools"  # dataset namespace

# CCF conferences reference data. Same pattern as schools: read-only sqlite +
# manifest, synced plain under the `conferences/` namespace in the same dataset.
CONFERENCES_DATA_DIR = REPO_ROOT / "backend" / "data" / "conferences"
CONFERENCES_SQLITE = CONFERENCES_DATA_DIR / "conferences.sqlite"
CONFERENCES_MANIFEST = CONFERENCES_DATA_DIR / "manifest.json"
CONFERENCES_FILES = ["conferences.sqlite", "manifest.json"]
CONFERENCES_PREFIX = "conferences"

# Per-user state. Both are 0600 and must NOT be committed or uploaded.
USER_CFG_DIR = Path(
    os.environ.get("LABNOTES_SYNC_CONFIG_DIR", str(Path.home() / ".config" / "labnotes-sync"))
)
CONFIG_FILE = USER_CFG_DIR / "config.toml"
AGE_PASSPHRASE_FILE = USER_CFG_DIR / "age.passphrase"

# Caches under $HOME.
LOCK_FILE = Path.home() / ".cache" / "labnotes-sync.lock"
LOG_FILE = Path.home() / ".cache" / "labnotes-sync.log"
ALERT_FILE = Path.home() / ".cache" / "labnotes-sync.alert"

# Layout inside the one HF Dataset. Runtime state lives under `state/`, schools
# data under `schools/` (see SCHOOLS_PREFIX) — each push mirrors only its own
# prefix (delete_patterns scoped) so the two never clobber each other.
STATE_PREFIX = "state"
DATASET_DB_PATH = "state/labnotes.db"
DATASET_UPLOADS_PATH = "state/uploads.tar"
DATASET_HOMEWORKS_PATH = "state/homeworks.tar"
DATASET_SECRETS_PATH = "state/secrets.age"
DATASET_MANIFEST_PATH = "state/manifest.json"
MANIFEST_SCHEMA_VERSION = 1


@dataclass(slots=True, frozen=True)
class Artifact:
    """One synced item. push/pull dispatch on `kind` — add a new artifact (a
    future feature's state) by appending one entry to ARTIFACTS below.

    kind:
      db_snapshot   — sqlite VACUUM INTO snapshot of `source` (plain)
      dir_tar       — deterministic tar of the `source` directory (plain)
      encrypted_tar — tar + age of SECRETS_PATHS (`source` is None)
    """

    name: str
    kind: str
    dataset_path: str
    source: Path | None
    sensitive: bool = True


# The state mirror's contents, in push order. The runtime DB + uploaded files
# + secrets — everything a fresh machine needs that isn't in git or the schools
# dataset. Extend here.
ARTIFACTS: list[Artifact] = [
    Artifact("db", "db_snapshot", DATASET_DB_PATH, DB_PATH),
    Artifact("uploads", "dir_tar", DATASET_UPLOADS_PATH, UPLOADS_DIR),
    Artifact("homeworks", "dir_tar", DATASET_HOMEWORKS_PATH, HOMEWORKS_DIR),
    Artifact("secrets", "encrypted_tar", DATASET_SECRETS_PATH, None),
]


@dataclass(slots=True)
class SyncConfig:
    repo_id: str  # e.g. "winbeau/xju-feiyue-data"
    machine_id: str  # human-readable label, lands in manifest.pushed_by

    @classmethod
    def load(cls) -> "SyncConfig":
        if not CONFIG_FILE.exists():
            raise FileNotFoundError(
                f"{CONFIG_FILE} not found — run `make sync-bootstrap` first."
            )
        data = tomllib.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        try:
            return cls(
                repo_id=data["hf"]["repo_id"],
                machine_id=data["machine"]["id"],
            )
        except KeyError as e:
            raise ValueError(
                f"{CONFIG_FILE} is missing required key {e}; re-run sync-bootstrap."
            ) from e

    @classmethod
    def write(cls, repo_id: str, machine_id: str) -> "SyncConfig":
        USER_CFG_DIR.mkdir(parents=True, exist_ok=True)
        # tomllib is read-only; hand-render the small file to avoid pulling tomli-w.
        body = (
            "# labnotes-sync config — generated by bootstrap.py\n"
            "[hf]\n"
            f'repo_id = "{repo_id}"\n'
            "\n"
            "[machine]\n"
            f'id = "{machine_id}"\n'
        )
        CONFIG_FILE.write_text(body, encoding="utf-8")
        CONFIG_FILE.chmod(0o600)
        return cls(repo_id=repo_id, machine_id=machine_id)
