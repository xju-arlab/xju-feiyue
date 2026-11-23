"""Add optional per-question homework rules and batch file metadata."""

import sqlalchemy as sa

from alembic import op

revision = "0016_homework_batches"
down_revision = "0015_homeworks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("homeworks", sa.Column("required_questions", sa.JSON(), nullable=True))
    op.add_column("homework_submissions", sa.Column("files", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("homework_submissions", "files")
    op.drop_column("homeworks", "required_questions")
