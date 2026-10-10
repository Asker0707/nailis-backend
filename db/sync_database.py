"""
Модуль синхронного подключения к базе данных для Celery задач.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from core.config import settings

DATABASE_URL_SYNC = settings.DATABASE_URL_SYNC

engine_sync = create_engine(
    DATABASE_URL_SYNC,
    echo=False,
    pool_size=20,
    max_overflow=0,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(
    bind=engine_sync,
    autoflush=False,
    autocommit=False
)

Base = declarative_base()


def get_sync_db():
    """Генератор синхронной сессии."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
