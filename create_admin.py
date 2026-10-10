import asyncio
import sys

from sqlalchemy import select

from auth.security import get_password_hash
from core.config import settings
from db.database import async_session_factory
from db.models import User, UserRole


WEAK_PASSWORDS = {"admin", "password", "123456", "qwerty"}


async def create_admin():
    admin_email = (settings.ADMIN_EMAIL or "").strip().lower()
    admin_password = settings.ADMIN_PASSWORD or ""

    if not admin_email or not admin_password:
        print("Укажите ADMIN_EMAIL и ADMIN_PASSWORD в .env")
        sys.exit(1)

    if len(admin_password) < 8 or admin_password.lower() in WEAK_PASSWORDS:
        print("ADMIN_PASSWORD слишком слабый (минимум 8 символов, не используйте типовые пароли).")
        sys.exit(1)

    async with async_session_factory() as session:
        result = await session.execute(
            select(User).where(User.email == admin_email)
        )
        existing = result.scalars().first()

        if existing:
            print(f"Администратор уже существует: {existing.email}")
            return

        admin = User(
            full_name="Администратор",
            email=admin_email,
            hashed_password=get_password_hash(admin_password),
            is_admin=True,
            role=UserRole.admin,
        )

        session.add(admin)
        await session.commit()
        await session.refresh(admin)
        print(f"Администратор создан: {admin.email}")


if __name__ == "__main__":
    asyncio.run(create_admin())
