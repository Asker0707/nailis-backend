"""add course access control

Revision ID: c3a1f8e4b902
Revises: b8f9e7a1c2d4
Create Date: 2026-08-09 17:05:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c3a1f8e4b902"
down_revision: Union[str, Sequence[str], None] = "b8f9e7a1c2d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "courses",
        sa.Column("is_free", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_courses_is_free", "courses", ["is_free"], unique=False)

    op.create_table(
        "user_course_access",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("course_id", sa.UUID(), nullable=False),
        sa.Column("granted_by_id", sa.UUID(), nullable=True),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note", sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["granted_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "course_id", name="uix_user_course_access"),
    )
    op.create_index(
        "ix_user_course_access_user_id", "user_course_access", ["user_id"], unique=False
    )
    op.create_index(
        "ix_user_course_access_course_id",
        "user_course_access",
        ["course_id"],
        unique=False,
    )

    # Стартовый бесплатный курс по текущему названию; дальше — только флаг в админке.
    op.execute(
        sa.text(
            "UPDATE courses SET is_free = true "
            "WHERE lower(title) LIKE '%наращиван%'"
        )
    )


def downgrade() -> None:
    op.drop_index("ix_user_course_access_course_id", table_name="user_course_access")
    op.drop_index("ix_user_course_access_user_id", table_name="user_course_access")
    op.drop_table("user_course_access")
    op.drop_index("ix_courses_is_free", table_name="courses")
    op.drop_column("courses", "is_free")
