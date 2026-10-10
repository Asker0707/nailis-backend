"""add profile settings fields

Revision ID: 9a1c4b6d2e10
Revises: 20cfd9cf16af
Create Date: 2026-03-08 22:40:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "9a1c4b6d2e10"
down_revision: Union[str, Sequence[str], None] = "20cfd9cf16af"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("avatar_path", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("bio", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("telegram", sa.String(length=64), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("telegram")
        batch_op.drop_column("bio")
        batch_op.drop_column("avatar_path")
