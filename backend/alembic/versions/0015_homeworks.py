"""Add private individual homework collection without rebuilding existing tables."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0015_homeworks"
down_revision: str | None = "0014_lab_member"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "homeworks",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "class_id",
            sa.Integer(),
            sa.ForeignKey("classes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("course", sa.String(120), nullable=False),
        sa.Column("experiment_no", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("naming_class", sa.String(80), nullable=False),
        sa.Column("naming_order", sa.String(24), nullable=False),
        sa.Column(
            "created_by_sid",
            sa.String(11),
            sa.ForeignKey("users.sid", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_homeworks_class_id", "homeworks", ["class_id"])
    op.create_table(
        "homework_submissions",
        sa.Column(
            "homework_id",
            sa.String(64),
            sa.ForeignKey("homeworks.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "sid", sa.String(11), sa.ForeignKey("users.sid", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("storage_path", sa.String(160), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("homework_submissions")
    op.drop_index("ix_homeworks_class_id", table_name="homeworks")
    op.drop_table("homeworks")
