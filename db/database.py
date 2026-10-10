"""
Модуль для работы с базой данных.

Обеспечивает:
- Создание и настройку асинхронного движка SQLAlchemy
- Фабрику асинхронных сессий
- Базовый класс для моделей
- Генератор сессий для зависимостей FastAPI
"""

from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import declarative_base

from core.config import settings


DATABASE_URL = settings.DATABASE_URL


engine = create_async_engine(
    DATABASE_URL,
    future=True,
    echo=False,
    pool_size=20,
    max_overflow=0,
    pool_pre_ping=True,
)


async_session_factory = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


Base = declarative_base()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Генератор асинхронных сессий для зависимостей FastAPI.

    Yields:
        AsyncSession: Асинхронная сессия SQLAlchemy

    Примечание:
        При необработанном исключении выполняется rollback.
        Сессия закрывается автоматически.
    """
    async with async_session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
