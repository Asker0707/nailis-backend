"""add course assessment and homework tables

Revision ID: b8f9e7a1c2d4
Revises: 9a1c4b6d2e10
Create Date: 2026-03-13 12:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b8f9e7a1c2d4"
down_revision: Union[str, Sequence[str], None] = "9a1c4b6d2e10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "course_assessment_attempts",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("course_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("total_questions", sa.Integer(), nullable=False),
        sa.Column("passed", sa.Boolean(), nullable=False),
        sa.Column("answers_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("course_assessment_attempts", schema=None) as batch_op:
        batch_op.create_index(
            "ix_course_assessment_attempts_course_user",
            ["course_id", "user_id"],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f("ix_course_assessment_attempts_course_id"),
            ["course_id"],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f("ix_course_assessment_attempts_user_id"),
            ["user_id"],
            unique=False,
        )

    op.create_table(
        "homework_submissions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("course_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("resource_url", sa.String(), nullable=True),
        sa.Column("submission_path", sa.String(), nullable=True),
        sa.Column("delivery_channel", sa.String(length=32), nullable=False),
        sa.Column("delivery_status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("homework_submissions", schema=None) as batch_op:
        batch_op.create_index(
            "ix_homework_submissions_course_user",
            ["course_id", "user_id"],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f("ix_homework_submissions_course_id"),
            ["course_id"],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f("ix_homework_submissions_user_id"),
            ["user_id"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("homework_submissions", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_homework_submissions_user_id"))
        batch_op.drop_index(batch_op.f("ix_homework_submissions_course_id"))
        batch_op.drop_index("ix_homework_submissions_course_user")
    op.drop_table("homework_submissions")

    with op.batch_alter_table("course_assessment_attempts", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_course_assessment_attempts_user_id"))
        batch_op.drop_index(batch_op.f("ix_course_assessment_attempts_course_id"))
        batch_op.drop_index("ix_course_assessment_attempts_course_user")
    op.drop_table("course_assessment_attempts")
