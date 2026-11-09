"""SQLAlchemy ORM models — single source of truth for the DB schema.

The 7 categories are kept as a Python `Literal` (mirroring frontend
`CategoryId`) and stored as a string column. Postgres has a native enum
type, but using strings keeps SQLite-fallback workable for tests.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON, TypeDecorator

from app.db.base import Base

if TYPE_CHECKING:
    pass


class StringList(TypeDecorator):
    """Use ARRAY(Text) on Postgres, JSON on SQLite. Keeps tests cheap."""

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):  # type: ignore[no-untyped-def]
        if dialect.name == "postgresql":
            return dialect.type_descriptor(ARRAY(Text))
        return dialect.type_descriptor(JSON())


CATEGORY_VALUES = (
    "research",
    "course",
    "recommend",
    "competition",
    "kaggle",
    "tools",
    "life",
)


class StudentClass(Base):
    """A 班级 (administrative class) — the scoping unit for roll-call and groups.

    The product spec asks for "two class-name columns on users"; we honor that
    on the wire (``UserOut.classFullName`` / ``classShortName``) but normalize
    storage into this table so a class rename is a 1-row update instead of a
    multi-table string sweep, and so roll-call sessions / groups can anchor to
    a stable FK. Rows are admin-managed (roster import / /admin UI); regular
    users never create or edit classes.
    """

    __tablename__ = "classes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 班级全名 — 专业全称 + 年级-班号, e.g. 计算机科学与技术24-3.
    full_name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    # 班级简名 — 惯用简称, e.g. 计算机24-3 (roster CSVs already use this form).
    short_name: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class User(Base):
    __tablename__ = "users"

    # Student ID is the natural primary key — 11-digit numeric string.
    sid: Mapped[str] = mapped_column(String(11), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Displayed across the app (cards / detail header / dropdown). Mutable;
    # seeded equal to `name` on first registration.
    nickname: Mapped[str] = mapped_column(String(120), nullable=False)
    # Greeting form-of-address: derived from the legal name at registration
    # (interpunct → first segment / ≤2 chars → whole / ≥3 chars → trailing
    # two), or user-customized. NULL for legacy rows → derived at runtime via
    # greeting.familiar_name(name). Drives the personalized homepage greeting.
    preferred_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    avatar: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # Server-generated 160px thumbnail derived from `avatar` on upload.
    # Cards / lists use this so we're not making the browser downsample a
    # 4 K portrait into a 20 px chip.
    avatar_thumb: Mapped[str | None] = mapped_column(String(512), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    wechat: Mapped[str | None] = mapped_column(String(64), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    email: Mapped[str | None] = mapped_column(String(128), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # Authorization tier: 'user' (default) | 'admin' | 'superadmin'. Drives the
    # /admin dashboard + material-management bypass. The configured bootstrap
    # super-admin (settings.admin_sid) is ALWAYS treated as superadmin at
    # runtime regardless of this column (see services.auth.effective_role), so
    # we can never lock ourselves out; the column is the source of truth for
    # every *other* account and is what super-admins flip when (de)promoting.
    role: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="user", default="user"
    )
    # ICT laboratory membership remains owned by Feiyue. ICTHub only reads
    # isLabMember from /auth/me and never stores local users or passwords.
    # Only a Feiyue super-admin can change this field through the narrow API.
    is_lab_member: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("0"), default=False
    )
    # 班级 membership — admin-managed (roster import / /admin UI); NULL until
    # assigned. ondelete='SET NULL': deleting a class detaches its students.
    class_id: Mapped[int | None] = mapped_column(
        ForeignKey("classes.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # 班委 (class committee) flag — grants roll-call / group-approval powers
    # *within the user's own class only* (services.classes.is_committee_of).
    # Orthogonal to the site-wide `role` tier; admin-managed. Cleared whenever
    # the user's class is cleared (a committee member of no class is nonsense).
    is_class_committee: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("0"), default=False
    )
    # 班委职务名称 (班长 / 团支书 / 学习委员 …) — display only; the boolean
    # above stays the single source of truth for permissions. Set/cleared
    # together with the flag by the admin endpoint.
    committee_title: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    notes: Mapped[list[Note]] = relationship(back_populates="author", lazy="raise")
    drafts: Mapped[list[Draft]] = relationship(back_populates="owner", lazy="raise")
    collections: Mapped[list[Collection]] = relationship(back_populates="owner", lazy="raise")
    # Eager (joined) so the flattened name properties below are always safe to
    # read wherever a User was *loaded* from the DB (get/select). Instances
    # mutated in-session must `await db.refresh(user)` before serializing —
    # refresh re-runs the mapper's eager loaders.
    clazz: Mapped[StudentClass | None] = relationship(lazy="joined")

    @property
    def class_full_name(self) -> str | None:
        """班级全名, flattened for UserOut — the wire keeps the two-field shape."""
        return self.clazz.full_name if self.clazz else None

    @property
    def class_short_name(self) -> str | None:
        """班级简名, flattened for UserOut."""
        return self.clazz.short_name if self.clazz else None


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    cover: Mapped[str | None] = mapped_column(String(512), nullable=True)
    category: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    tags: Mapped[list[str]] = mapped_column(StringList(), nullable=False, default=list)
    author_sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    read_minutes: Mapped[int] = mapped_column(nullable=False, default=1)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="visible", default="visible", index=True
    )

    author: Mapped[User] = relationship(back_populates="notes", lazy="joined")
    # passive_deletes=True: rely on DB-level ondelete='CASCADE' instead of
    # having SQLAlchemy try to NULL the FK first (which would violate Like's
    # PK constraint since note_id is part of its composite primary key).
    likes: Mapped[list[Like]] = relationship(
        back_populates="note", lazy="raise", passive_deletes=True
    )
    comments: Mapped[list[Comment]] = relationship(
        back_populates="note", lazy="raise", passive_deletes=True
    )


class Draft(Base):
    __tablename__ = "drafts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    category: Mapped[str | None] = mapped_column(String(20), nullable=True)
    tags: Mapped[list[str]] = mapped_column(StringList(), nullable=False, default=list)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
        index=True,
    )

    owner: Mapped[User] = relationship(back_populates="drafts", lazy="joined")


class Like(Base):
    __tablename__ = "likes"
    __table_args__ = (UniqueConstraint("note_id", "user_sid", name="uq_likes_note_user"),)

    note_id: Mapped[str] = mapped_column(
        ForeignKey("notes.id", ondelete="CASCADE"), primary_key=True
    )
    user_sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    note: Mapped[Note] = relationship(back_populates="likes", lazy="raise")


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    note_id: Mapped[str] = mapped_column(
        ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), nullable=False
    )
    parent_id: Mapped[str | None] = mapped_column(
        ForeignKey("comments.id", ondelete="CASCADE"), nullable=True, index=True
    )
    reply_to_sid: Mapped[str | None] = mapped_column(
        ForeignKey("users.sid", ondelete="SET NULL"), nullable=True
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    images: Mapped[list[str]] = mapped_column(StringList(), nullable=False, default=list)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="visible", default="visible", index=True
    )
    # Optional anchor — when present, the comment quotes a span of the note's
    # rendered body. Offsets index into the rendered DOM textContent stream
    # (kept for future highlight-restoration; MVP only uses anchor_text).
    anchor_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    anchor_offset_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    anchor_offset_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    note: Mapped[Note] = relationship(back_populates="comments", lazy="raise")
    author: Mapped[User] = relationship(foreign_keys=[author_sid], lazy="joined")
    reply_to: Mapped[User | None] = relationship(foreign_keys=[reply_to_sid], lazy="joined")
    parent: Mapped[Comment | None] = relationship(
        back_populates="replies",
        remote_side=[id],
        lazy="raise",
    )
    replies: Mapped[list[Comment]] = relationship(
        back_populates="parent",
        lazy="raise",
        passive_deletes=True,
    )


class NoteDislike(Base):
    __tablename__ = "note_dislikes"
    __table_args__ = (
        UniqueConstraint("note_id", "user_sid", name="uq_note_dislikes_note_user"),
    )

    note_id: Mapped[str] = mapped_column(
        ForeignKey("notes.id", ondelete="CASCADE"), primary_key=True
    )
    user_sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Favorite(Base):
    __tablename__ = "favorites"
    __table_args__ = (
        UniqueConstraint("note_id", "user_sid", name="uq_favorites_note_user"),
    )

    note_id: Mapped[str] = mapped_column(
        ForeignKey("notes.id", ondelete="CASCADE"), primary_key=True
    )
    user_sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class CommentReaction(Base):
    __tablename__ = "comment_reactions"
    __table_args__ = (
        UniqueConstraint("comment_id", "user_sid", name="uq_comment_reactions_comment_user"),
    )

    comment_id: Mapped[str] = mapped_column(
        ForeignKey("comments.id", ondelete="CASCADE"), primary_key=True
    )
    user_sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), primary_key=True
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    reporter_sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), nullable=False, index=True
    )
    target_type: Mapped[str] = mapped_column(String(16), nullable=False)
    target_note_id: Mapped[str | None] = mapped_column(
        ForeignKey("notes.id", ondelete="CASCADE"), nullable=True, index=True
    )
    target_comment_id: Mapped[str | None] = mapped_column(
        ForeignKey("comments.id", ondelete="CASCADE"), nullable=True, index=True
    )
    target_snapshot: Mapped[str] = mapped_column(Text, nullable=False, default="")
    reason: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="pending", default="pending", index=True
    )
    ai_label: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ai_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    ai_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolution_action: Mapped[str | None] = mapped_column(String(16), nullable=True)
    resolution_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_by_sid: Mapped[str | None] = mapped_column(
        ForeignKey("users.sid", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Block(Base):
    __tablename__ = "blocks"
    __table_args__ = (
        UniqueConstraint("blocker_sid", "blocked_sid", name="uq_blocks_blocker_blocked"),
    )

    blocker_sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), primary_key=True
    )
    blocked_sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Collection(Base):
    __tablename__ = "collections"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    owner: Mapped[User] = relationship(back_populates="collections", lazy="joined")
    entries: Mapped[list[CollectionEntry]] = relationship(
        back_populates="collection", lazy="raise", passive_deletes=True
    )


class CollectionEntry(Base):
    __tablename__ = "collection_entries"
    __table_args__ = (
        UniqueConstraint("note_id", name="uq_collection_entries_note_unique"),
    )

    collection_id: Mapped[str] = mapped_column(
        ForeignKey("collections.id", ondelete="CASCADE"), primary_key=True
    )
    note_id: Mapped[str] = mapped_column(
        ForeignKey("notes.id", ondelete="CASCADE"), primary_key=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    collection: Mapped[Collection] = relationship(back_populates="entries", lazy="raise")
    note: Mapped[Note] = relationship(lazy="joined")


class LoginEvent(Base):
    """Successful-login audit trail — admin-visible only.

    Captures the client IP from the reverse-proxy headers (X-Forwarded-For
    / X-Real-IP), the User-Agent, and a server timestamp.
    """

    __tablename__ = "login_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), nullable=False, index=True
    )
    ip: Mapped[str] = mapped_column(String(45), nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )


class MaterialResource(Base):
    """A shared course-material resource — a card on the `/materials` page.

    The resource is the top-level container; its files/folders live in
    `MaterialFile` as a self-referential recursive tree. `deleted` is a
    soft-delete flag (recoverable / auditable); physical files are unlinked
    at DELETE time to avoid orphans on disk.

    House rules (mirroring Note/Like): relationships are `lazy="raise"` +
    `passive_deletes=True` + DB `ondelete='CASCADE'`. We never use
    `cascade="all, delete-orphan"` — the DB drives the cascade.
    """

    __tablename__ = "material_resources"

    # uuid hex (no dashes) PK — same convention as Note/Draft string ids.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # 'New' | 'Hot' | 'Rec' (nullable) — drives the corner badge on the card.
    tag: Mapped[str | None] = mapped_column(String(16), nullable=True)
    owner_sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), nullable=False, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    owner: Mapped[User] = relationship(lazy="joined")
    # passive_deletes=True: rely on DB-level ondelete='CASCADE' rather than
    # SQLAlchemy NULLing FKs first. lazy='raise' forbids implicit IO — the
    # tree is assembled by a flat SELECT + Python grouping in the service.
    files: Mapped[list[MaterialFile]] = relationship(
        back_populates="resource", lazy="raise", passive_deletes=True
    )


class MaterialFile(Base):
    """A file or folder inside a `MaterialResource` (self-referential tree).

    `is_folder` distinguishes the two: folders are pure DB rows (no disk
    object), files carry `url`/`storage_path`/`ext`/`mime`/`size_bytes`.
    `parent_id` is NULL at the resource root and otherwise points at the
    enclosing folder (also a `MaterialFile`). `sort_order` is 0..n within a
    `(resource_id, parent_id)` sibling scope.

    Name uniqueness within a `(resource_id, parent_id)` scope is enforced in
    the service layer via `SELECT WHERE deleted=False` (NOT a DB
    UniqueConstraint — SQLite treats NULL parent_id rows as mutually
    distinct, which would miss root-level dup detection).
    """

    __tablename__ = "material_files"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    resource_id: Mapped[str] = mapped_column(
        ForeignKey("material_resources.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Self FK — root-level nodes have NULL parent_id. Deleting a folder row
    # cascades to its descendants at the DB level.
    parent_id: Mapped[str | None] = mapped_column(
        ForeignKey("material_files.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_folder: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Lowercased extension (no dot) — drives icon + preview routing. NULL/""
    # for folders.
    ext: Mapped[str | None] = mapped_column(String(32), nullable=True)
    mime: Mapped[str | None] = mapped_column(String(128), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Absolute URL: `${public_base_url}/uploads/materials/<sid>/<rid>/<file>`.
    url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # Relative on-disk path (physical delete / locate). NULL for folders.
    storage_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    resource: Mapped[MaterialResource] = relationship(back_populates="files", lazy="raise")
    # Self-referential tree. remote_side ties `parent` to the row whose `id`
    # equals this row's `parent_id`. passive_deletes=True + DB CASCADE drives
    # subtree deletion; lazy='raise' forbids implicit traversal (the service
    # builds the tree from a flat SELECT, never via .children/.parent).
    parent: Mapped[MaterialFile | None] = relationship(
        back_populates="children",
        remote_side=[id],
        lazy="raise",
    )
    children: Mapped[list[MaterialFile]] = relationship(
        back_populates="parent",
        lazy="raise",
        passive_deletes=True,
    )


class MaterialNotice(Base):
    """The single acknowledgment/credits bar shown on the `/materials` page.

    A singleton (one row, fixed PK ``MaterialNotice.SINGLETON_ID``) holding a
    short Notion-style note — e.g. crediting a contributed-resource repo. Any
    logged-in user can *read* it (it renders for everyone when ``visible``);
    only admins/super-admins (``services.auth.is_admin``) may edit the content
    or hide it. "Delete" is a soft hide (``visible=False``) so an admin can
    restore it later without losing the text.
    """

    __tablename__ = "material_notice"

    # Fixed singleton id — there is only ever one notice row.
    SINGLETON_ID = "default"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Hidden (deleted) when False; the row is kept so a hide is reversible.
    visible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # sid of the last admin who edited/hid it (audit only; nullable).
    updated_by_sid: Mapped[str | None] = mapped_column(String(11), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class RollCallSession(Base):
    """One 点名 (roll-call) run for a class.

    Creating a session snapshots the class roster into `RollCallRecord` rows
    (present=False) so history reflects the membership *as of that day* —
    students who join the class later don't retroactively appear absent.
    `closed_at` marks "点名完成" but is informational: committee members may
    keep editing records afterwards (fix-ups are a requirement).
    """

    __tablename__ = "roll_call_sessions"

    # uuid hex (no dashes) PK — same convention as Note/MaterialResource.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    class_id: Mapped[int] = mapped_column(
        ForeignKey("classes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_by_sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RollCallRecord(Base):
    """Per-student presence flag inside a roll-call session.

    Composite PK (session_id, sid) — the Like pattern. Each checkbox click is
    a single-row upsert (PUT), never a bulk sheet save, so two committee
    members checking concurrently can't overwrite each other and SQLite write
    transactions stay tiny.
    """

    __tablename__ = "roll_call_records"

    session_id: Mapped[str] = mapped_column(
        ForeignKey("roll_call_sessions.id", ondelete="CASCADE"), primary_key=True
    )
    sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), primary_key=True
    )
    present: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Which committee member last toggled this record (audit only; nullable).
    checked_by_sid: Mapped[str | None] = mapped_column(String(11), nullable=True)


class Group(Base):
    """A 小组 (student group) inside a class.

    `leader_sid` (组长) is denormalized for fast permission checks; the leader
    also has a `GroupMember` row with role='leader' (kept consistent in the
    service). `deleted` is a soft-delete flag (materials pattern); physical
    files under uploads/groups/<gid>/ are unlinked at delete time.

    Name uniqueness among *live* groups of a class is enforced in the service
    (not a DB constraint — soft-deleted rows must not block name reuse).
    """

    __tablename__ = "groups"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    class_id: Mapped[int] = mapped_column(
        ForeignKey("classes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Group logo — original + server-generated 160px thumbnail (avatar pattern).
    logo: Mapped[str | None] = mapped_column(String(512), nullable=True)
    logo_thumb: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # 简要介绍 shown in the group space; editable by leader/班委.
    intro: Mapped[str] = mapped_column(Text, nullable=False, default="")
    leader_sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), nullable=False
    )
    deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class GroupMember(Base):
    """Membership row — composite PK (group_id, sid).

    A user may be in at most one *live* group per class (course-project team
    semantics; enforced in the service, relaxable by deleting one check).
    """

    __tablename__ = "group_members"

    group_id: Mapped[str] = mapped_column(
        ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True
    )
    sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), primary_key=True, index=True
    )
    # 'leader' | 'member' — mirrors Group.leader_sid for the leader row.
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="member")
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class GroupJoinRequest(Base):
    """申请加入 — pending until the 组长 or a 班委 decides.

    At most one *pending* request per (group, sid) (service-enforced).
    Approval adds the member and auto-rejects the applicant's other pending
    requests in the same class, in the same transaction.
    """

    __tablename__ = "group_join_requests"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    group_id: Mapped[str] = mapped_column(
        ForeignKey("groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), nullable=False, index=True
    )
    message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # 'pending' | 'approved' | 'rejected'
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    decided_by_sid: Mapped[str | None] = mapped_column(String(11), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class GroupFile(Base):
    """A file uploaded into a group space — flat list (no folder tree).

    MaterialFile minus the tree columns: a ~5-person group space doesn't need
    folders, and dropping them removes the whole rename/reorder/cycle-guard
    endpoint surface. Disk layout: uploads/groups/<gid>/<ts>-<rand>.<ext>.
    """

    __tablename__ = "group_files"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    group_id: Mapped[str] = mapped_column(
        ForeignKey("groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    ext: Mapped[str | None] = mapped_column(String(32), nullable=True)
    mime: Mapped[str | None] = mapped_column(String(128), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    storage_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    uploaded_by_sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), nullable=False
    )
    deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class GroupTask(Base):
    """A Gantt-chart task inside a group space.

    Date-only start/end (inclusive); assignees live in `GroupTaskAssignee`
    (association table, not a JSON list — clean "my tasks" queries + FK
    integrity on SQLite).
    """

    __tablename__ = "group_tasks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    group_id: Mapped[str] = mapped_column(
        ForeignKey("groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    # Inclusive — a one-day task has start_date == end_date.
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    # 'todo' | 'doing' | 'done'
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="todo")
    # 0-100 (validated in the schema layer).
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by_sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class GroupTaskAssignee(Base):
    """Task ↔ member assignment — composite PK (task_id, sid)."""

    __tablename__ = "group_task_assignees"

    task_id: Mapped[str] = mapped_column(
        ForeignKey("group_tasks.id", ondelete="CASCADE"), primary_key=True
    )
    sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), primary_key=True
    )


class ClassMission(Base):
    """A 分组任务 (grouping mission) at the top of the /class space.

    A class runs one *active* mission at a time (设为进行中); over a term it may
    have several in sequence (a fresh round of grouping each time). Missions are
    class-scoped labels — groups are NOT partitioned per mission yet, so switching
    the active mission only re-frames the UI, it doesn't re-shuffle groups. At most
    one row per class has ``is_active=True`` (service-enforced, mirrors the roll-call
    single-writer ethos). 学委/班委 manage them; every member reads them.
    """

    __tablename__ = "class_missions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    class_id: Mapped[int] = mapped_column(
        ForeignKey("classes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # 进行中 flag — at most one True per class (unset the old one when setting a new).
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("0"), default=False, index=True
    )
    created_by_sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Homework(Base):
    """Class-wide individual assignment, independent of groups and missions."""

    __tablename__ = "homeworks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    class_id: Mapped[int] = mapped_column(
        ForeignKey("classes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    course: Mapped[str] = mapped_column(String(120), nullable=False)
    experiment_no: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    naming_class: Mapped[str] = mapped_column(String(80), nullable=False)
    naming_order: Mapped[str] = mapped_column(String(24), nullable=False)
    created_by_sid: Mapped[str | None] = mapped_column(
        ForeignKey("users.sid", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class HomeworkSubmission(Base):
    """One current file per student; storage paths are private, server-generated."""

    __tablename__ = "homework_submissions"

    homework_id: Mapped[str] = mapped_column(
        ForeignKey("homeworks.id", ondelete="CASCADE"), primary_key=True
    )
    sid: Mapped[str] = mapped_column(
        ForeignKey("users.sid", ondelete="CASCADE"), primary_key=True
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(160), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
