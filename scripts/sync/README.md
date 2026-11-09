# labnotes-sync

Mirrors everything that lives **outside git** — the runtime sqlite DB, uploaded
files (avatars + note images), `.env.local` secrets, and the schools advisor
reference data — to **one private Hugging Face Dataset** (`xju-feiyue-data`), so
a fresh machine can be restored losslessly with `git clone` + one pull.

Source lives in `scripts/sync/`; everyday commands run from the repo root via
`make`. (The tool keeps its `labnotes-sync` name and `~/.config/labnotes-sync`
config dir for continuity.)

## What gets synced

One dataset, three namespaces — each side mirrors only its own prefix so they
never clobber each other:

| Namespace | Artifact | Local path | In dataset as | Form |
|---|---|---|---|---|
| `state/` | sqlite DB | `backend/labnotes.db` | `state/labnotes.db` | VACUUM INTO snapshot (plain) |
| `state/` | uploads | `backend/uploads/` | `state/uploads.tar` | deterministic tar (plain) |
| `state/` | private homework submissions | `backend/private/homeworks/` | `state/homeworks.tar` | deterministic tar (private dataset) |
| `state/` | secrets | `backend/.env.local`, `frontend/.env.local` | `state/secrets.age` | tar + age (encrypted) |
| `state/` | metadata | (generated) | `state/manifest.json` | sha256 + size per file |
| `schools/` | advisor DB | `backend/data/schools/schools.sqlite` | `schools/schools.sqlite` | plain (regenerable by claw) |
| `schools/` | claw manifest | `backend/data/schools/manifest.json` | `schools/manifest.json` | plain |
| `conferences/` | conference DB | `backend/data/conferences/conferences.sqlite` | `conferences/conferences.sqlite` | plain (seed / R3 crawler) |
| `conferences/` | seed manifest | `backend/data/conferences/manifest.json` | `conferences/manifest.json` | plain |

`sync-*` drives `state/`; `schools-*` drives `schools/`; `conf-*` drives
`conferences/`; `data-*` does all three. The DB is uploaded **plain** — privacy relies on the dataset being
private. Only `.env.local` (JWT/API keys) is age-encrypted.

## Why HF Dataset

- Private datasets are free, git-LFS underneath (handles the ~20MB schools blob
  that timed out on a normal `git push`), well-supported by `huggingface_hub`.
- One command on a fresh machine — see "Fresh-machine restore" below.
- No S3/IAM, no VPN, no rsync (forbidden in this repo — see `MEMORY.md`).

## First-time setup (per machine)

1. OS deps: `sudo apt install age bsdextrautils sqlite3`
2. `uv` on `PATH` (`~/.local/bin/uv`)
3. HF login (token with **write** scope):
   ```
   uv run --project scripts/sync hf auth login        # or: huggingface-cli login
   ```
   (writes `~/.cache/huggingface/token`, which cron reads). The old
   `python -m huggingface_hub.commands.huggingface_cli` path no longer exists in
   current `huggingface_hub`.
4. `make sync-bootstrap` — verifies deps + token, prompts twice for an age
   passphrase (saved 0600 to `~/.config/labnotes-sync/age.passphrase` — back it
   up, it's irrecoverable), prompts for `repo_id` (default
   `<your-hf-user>/xju-feiyue-data`) + a machine label, then
   `create_repo(private=True, exist_ok=True)`.

## Daily use

```
make sync-push        # snapshot DB + tar uploads + encrypt secrets → state/  (mirror)
make sync-pull        # restore state/ (DB + uploads + secrets), .bak.<ts> kept
make sync-status      # last state/ manifest summary
make schools-push     # mirror local schools data → schools/
make schools-pull     # restore schools/ → backend/data/schools/
make schools-status   # last schools/ manifest summary
make conf-push        # mirror local conferences data → conferences/
make conf-pull        # restore conferences/ → backend/data/conferences/
make conf-status      # last conferences/ manifest summary
make data-push        # sync-push + schools-push + conf-push
make data-pull        # sync-pull + schools-pull + conf-pull
```

`sync-pull` is non-destructive: existing local files are renamed to
`<file>.bak.<UTC-stamp>` before overwrite (`--force` skips the prompt).

## Fresh-machine restore

```
git clone <repo> && cd <repo>
make sync-bootstrap                       # HF login + same age passphrase + repo_id
make data-pull                            # DB + uploads + secrets + schools, all at once
cd backend && uv sync && uv run alembic upgrade head   # alembic is idempotent
```

The DB stores absolute `<PUBLIC_BASE_URL>/uploads/...` URLs, so restoring
`backend/uploads/` to the same path is what keeps avatars/images from 404'ing.

Homework submissions are stored separately from public uploads and restored by
the same registry-driven state sync. When overriding `HOMEWORK_UPLOAD_DIR`, pass
the same value to the sync process (including cron); relative paths resolve from
`backend/`. Historical snapshots without `state/homeworks.tar` remain restorable.

## Adding future state (extension interface)

`push`/`pull` are registry-driven: they iterate `config.py::ARTIFACTS` and
dispatch on `kind` (`db_snapshot` / `dir_tar` / `encrypted_tar`). To back up a
new piece of runtime state, append one `Artifact(...)` entry — no change to
push.py/pull.py. A new kind needs one handler branch in each.

## Background sync

```
make sync-cron-install
```

Adds a `*/30 * * * *` entry running `make sync-push-quiet` (state/ only —
schools is claw/manual-driven), logging to `~/.cache/labnotes-sync.log`.
Idempotent. WSL: `sudo service cron start` after install.

Remove: `crontab -l | grep -v 'make sync-push-quiet' | crontab -`

## Debugging

```
make sync-status                                   # last state/ push summary
make schools-status                                # last schools/ push summary
tail -f ~/.cache/labnotes-sync.log                 # cron output
cat ~/.cache/labnotes-sync.alert 2>/dev/null       # set after consecutive cron failures
```

HTTP 401 on push → token expired, re-run `hf auth login` (step 3 above). The
push reads `repo_id` from `~/.config/labnotes-sync/config.toml`; if it ever
404s, confirm that points at the current dataset name (`winbeau/xju-feiyue-data`).

## Layout

```
scripts/sync/
├── pyproject.toml      # uv subproject (huggingface_hub + rich)
├── config.py           # paths, ARTIFACTS registry, on-disk config loader
├── _common.py          # snapshot / dir-tar / age / sha256 / manifest / flock
├── bootstrap.py        # one-shot setup
├── push.py             # state/: registry → snapshot/tar/encrypt → upload (mirror)
├── pull.py             # state/: download → verify → restore
├── schools.py          # schools/: push / pull / status
├── selftest.py         # helper roundtrip checks (no HF/age)
├── cron_install.sh     # idempotent crontab installer
└── README.md           # this file
```

## Constraints

- **No automatic two-way merge.** `manifest.pushed_by` gives a soft warning; the
  pattern assumes one writer at a time. **huawei2 is the writer of `state/`** —
  `deploy.sh` only pulls `schools/`, never DB/uploads (that would overwrite the
  live DB with a staler snapshot). `state/` is pulled only on a fresh restore.
- **Passphrase is irrecoverable.** Lose it → encrypted secrets are gone.
- **WSL ↔ VPS code sync still goes through GitHub push/pull** — this system is
  only for data (DB + uploads + secrets + schools).
