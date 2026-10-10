"""add course price

Revision ID: d4b2e9f5c013
Revises: c3a1f8e4b902
Create Date: 2026-08-09 17:25:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d4b2e9f5c013"
down_revision: Union[str, Sequence[str], None] = "c3a1f8e4b902"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("courses", sa.Column("price", sa.Integer(), nullable=True))
    op.execute(
        sa.text(
            "UPDATE courses SET price = 15000 "
            "WHERE lower(title) LIKE '%повышен%квалиф%'"
        )
    )


def downgrade() -> None:
    op.drop_column("courses", "price")
