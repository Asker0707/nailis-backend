"""create email_logs table

Revision ID: 6b754c7bb9b0
Revises: 4d2d470c86cf
Create Date: 2025-09-28 16:29:59.045535

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from alembic import op
import sqlalchemy as sa
import sqlalchemy.dialects.postgresql as pg
import uuid
from datetime import datetime, timezone

# revision identifiers, used by Alembic.
revision: str = '6b754c7bb9b0'
down_revision: Union[str, Sequence[str], None] = '4d2d470c86cf'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "email_logs",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False),
        sa.Column("recipient", sa.String(), nullable=False, index=True),
        sa.Column("subject", sa.String(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("sent", sa.Boolean(), nullable=False, default=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("timezone('utc', now())"),
        ),
    )


def downgrade() -> None:
    op.drop_table("email_logs")