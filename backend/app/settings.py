from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded from .env.local / environment variables."""

    database_url: str = "sqlite+aiosqlite:///./labnotes.db"
    jwt_secret: str = "dev-only-change-in-prod"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days

    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-v4-flash"
    deepseek_dry_run: bool = False
    deepseek_timeout_s: float = 30.0

    # AI pre-screening of new reports (see app/services/moderation.py). Runs as
    # a fire-and-forget background task after POST /reports. Disabled in tests
    # (see conftest) so the queue stays deterministic; flag_threshold is the
    # min AI confidence at which a report auto-jumps to `ai_flagged`.
    moderation_enabled: bool = True
    moderation_flag_threshold: float = 0.75

    # Wire as a comma-separated string (e.g. CORS_ORIGINS=a,b,c).
    # pydantic-settings v2 would try JSON-parsing list[str] env vars and
    # crash on plain CSV; sticking to str + a derived list property avoids it.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Public base URL the *frontend* uses to reach this API (e.g.
    # http://localhost:8000). Stored avatar URLs prepend this so an
    # uploaded file at /uploads/avatars/foo.png renders as
    # `${public_base_url}/uploads/avatars/foo.png`. Override per env.
    public_base_url: str = "http://localhost:8000"

    # Daily author-alignment job (see app/services/author_sync.py). Tests
    # disable this to keep the lifespan deterministic and avoid noisy log
    # output when the test DB schema isn't fully set up.
    author_sync_enabled: bool = True

    # Per-user throttling of high-frequency interaction writes (see
    # app/ratelimit.py). Disabled in tests so existing multi-op suites don't
    # trip the limiter; a dedicated test flips it on.
    rate_limit_enabled: bool = True

    # Single-admin gate for /admin/* routes. Match by `users.sid`; any
    # request from a non-matching sid gets a generic 404 so the route
    # is undiscoverable to anyone but the admin.
    admin_sid: str = "20241401231"

    # Directory holding claw's schools export (manifest.json + schools.sqlite).
    # Resolved relative to backend/ (i.e. Path(app/main.py).parent.parent).
    # Override with an absolute path or `SCHOOLS_DATA_DIR=...` env var. The
    # file is attached read-only by app/db/schools_engine.py. Missing files
    # don't block boot — /schools/* simply returns 503 until present.
    schools_data_dir: str = "data/schools"
    conferences_data_dir: str = "data/conferences"
    # Private assignment files, served only by authenticated homework endpoints.
    # Include this directory in runtime backups alongside the database.
    homework_upload_dir: str = "private/homeworks"

    # Conference deadline crawler — background loop that checks due conferences,
    # fetches homepages, and asks DeepSeek to extract CFP info. Interval is how
    # often the loop wakes up to check for due rows (per-conf frequency is
    # controlled by crawl_state: unannounced=1d, announced=5d, closed=stop).
    conf_crawl_enabled: bool = True
    conf_crawl_interval_hours: int = 72

    @property
    def cors_origin_list(self) -> list[str]:
        return [s.strip() for s in self.cors_origins.split(",") if s.strip()]

    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )


settings = Settings()
