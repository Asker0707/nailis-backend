"""add course cover_path

Revision ID: e5c3f0a6d124
Revises: d4b2e9f5c013
Create Date: 2026-08-09 17:57:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e5c3f0a6d124"
down_revision: Union[str, Sequence[str], None] = "d4b2e9f5c013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("courses", sa.Column("cover_path", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("courses", "cover_path")
