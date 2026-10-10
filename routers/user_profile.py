"""
Модуль для работы с профилем пользователя.

Содержит API endpoints для:
- получения статистики и данных профиля
- обновления пользовательских настроек (имя, bio, telegram, аватар)
"""

from __future__ import annotations

import os
import re
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from auth.dependencies import get_current_user
from auth.security import get_password_hash, verify_password
from core.config import settings
from db import models
from db.database import get_db
from schemas.user_profile import (
    BadgeItem,
    LastLessonItem,
    ProfileDataResponse,
    ProfileUpdateResponse,
)


router = APIRouter(tags=["Данные профиля"])

_ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
_ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
_MAX_AVATAR_BYTES = 5 * 1024 * 1024
_TELEGRAM_RE = re.compile(r"^@[A-Za-z0-9_]{5,32}$")


def _build_badges(progress: float, completed: int, notes_count: int) -> list[BadgeItem]:
    badges: list[BadgeItem] = []
    if completed >= 1:
        badges.append(BadgeItem(name="Старт", icon="bi bi-lightning-charge-fill"))
    if completed >= 5:
        badges.append(BadgeItem(name="Стабильность", icon="bi bi-check2-circle"))
    if progress >= 50:
        badges.append(BadgeItem(name="Половина пути", icon="bi bi-compass"))
    if notes_count >= 5:
        badges.append(BadgeItem(name="Конспект-мастер", icon="bi bi-journal-richtext"))
    if progress >= 100:
        badges.append(BadgeItem(name="Финиш", icon="bi bi-trophy-fill"))
    return badges


def _avatar_abs_path(relative_path: str) -> str:
    return os.path.join(settings.BASE_DIR, relative_path)


def _safe_remove_avatar(relative_path: str | None) -> None:
    if not relative_path:
        return
    normalized = relative_path.replace("\\", "/")
    if not normalized.startswith("static/avatars/"):
        return
    abs_path = _avatar_abs_path(normalized)
    if os.path.exists(abs_path):
        try:
            os.remove(abs_path)
        except OSError:
            pass


def _normalize_telegram(raw: str | None) -> str | None:
    if raw is None:
        return None
    value = raw.strip()
    if not value:
        return None

    value = value.replace("https://t.me/", "").replace("http://t.me/", "").replace("t.me/", "")
    if not value.startswith("@"):
        value = f"@{value}"
    if not _TELEGRAM_RE.match(value):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Некорректный Telegram username",
        )
    return value


@router.get("/api/profile_data", response_model=ProfileDataResponse)
async def get_profile_data_api(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> ProfileDataResponse:
    """Возвращает статистику профиля текущего пользователя."""
    total_lessons = (await db.execute(select(func.count(models.Lesson.id)))).scalar() or 0

    completed = (
        await db.execute(
            select(func.count(models.LessonCompletion.id)).filter(
                models.LessonCompletion.user_id == current_user.id
            )
        )
    ).scalar() or 0

    notes_count = (
        await db.execute(
            select(func.count(models.Note.id)).filter(models.Note.user_id == current_user.id)
        )
    ).scalar() or 0

    progress = round((completed / total_lessons) * 100, 2) if total_lessons else 0.0

    last_items = (
        await db.execute(
            select(models.LessonCompletion, models.Lesson)
            .join(models.Lesson, models.Lesson.id == models.LessonCompletion.lesson_id)
            .filter(models.LessonCompletion.user_id == current_user.id)
            .order_by(models.LessonCompletion.completed_at.desc())
            .limit(5)
        )
    ).all()

    return ProfileDataResponse(
        full_name=current_user.full_name,
        email=current_user.email,
        progress_percent=progress,
        completed_lessons=completed,
        total_lessons=total_lessons,
        last_lessons=[
            LastLessonItem(
                title=lesson.title,
                date=completion.completed_at.strftime("%d.%m.%Y") if completion.completed_at else "",
            )
            for completion, lesson in last_items
        ],
        badges=_build_badges(progress=progress, completed=completed, notes_count=notes_count),
        avatar_url=f"/{current_user.avatar_path}" if current_user.avatar_path else None,
        bio=current_user.bio,
        telegram=current_user.telegram,
        notes_count=notes_count,
        joined_at=current_user.created_at.strftime("%d.%m.%Y") if current_user.created_at else None,
    )


@router.put("/api/profile/settings", response_model=ProfileUpdateResponse)
async def update_profile_settings(
    full_name: str | None = Form(default=None),
    bio: str | None = Form(default=None),
    telegram: str | None = Form(default=None),
    remove_avatar: bool = Form(default=False),
    avatar: UploadFile | None = File(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> ProfileUpdateResponse:
    """
    Обновляет настройки профиля текущего пользователя.
    Поддерживает загрузку/замену/удаление аватара.
    """
    user = await db.get(models.User, current_user.id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")

    if full_name is not None:
        normalized_name = " ".join(full_name.strip().split())
        if not normalized_name or len(normalized_name) < 2 or len(normalized_name) > 80:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Имя должно быть от 2 до 80 символов",
            )
        user.full_name = normalized_name

    if bio is not None:
        normalized_bio = bio.strip()
        if len(normalized_bio) > 500:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Описание профиля не должно превышать 500 символов",
            )
        user.bio = normalized_bio or None

    if telegram is not None:
        user.telegram = _normalize_telegram(telegram)

    if remove_avatar and user.avatar_path:
        _safe_remove_avatar(user.avatar_path)
        user.avatar_path = None

    if avatar and avatar.filename:
        extension = os.path.splitext(avatar.filename)[1].lower()
        content_type = (avatar.content_type or "").lower()

        if content_type not in _ALLOWED_IMAGE_TYPES and extension not in _ALLOWED_IMAGE_EXT:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Допустимы только изображения JPG, PNG, WEBP, GIF",
            )

        data = await avatar.read(_MAX_AVATAR_BYTES + 1)
        if len(data) > _MAX_AVATAR_BYTES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Размер аватара не должен превышать 5MB",
            )

        if extension not in _ALLOWED_IMAGE_EXT:
            extension = _ALLOWED_IMAGE_TYPES.get(content_type, ".jpg")
        if extension == ".jpeg":
            extension = ".jpg"

        avatars_dir = os.path.join(settings.BASE_DIR, "static", "avatars")
        os.makedirs(avatars_dir, exist_ok=True)

        filename = f"{uuid.uuid4().hex}{extension}"
        relative_path = f"static/avatars/{filename}"
        absolute_path = os.path.join(avatars_dir, filename)

        with open(absolute_path, "wb") as avatar_file:
            avatar_file.write(data)

        if user.avatar_path and user.avatar_path != relative_path:
            _safe_remove_avatar(user.avatar_path)
        user.avatar_path = relative_path

    await db.commit()
    return ProfileUpdateResponse(detail="Настройки профиля обновлены")


@router.put("/api/profile/password", response_model=ProfileUpdateResponse)
async def change_profile_password(
    current_password: str = Form(...),
    new_password: str = Form(...),
    confirm_password: str = Form(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> ProfileUpdateResponse:
    """Смена пароля текущего пользователя из профиля."""
    user = await db.get(models.User, current_user.id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")

    if not verify_password(current_password, str(user.hashed_password)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Текущий пароль указан неверно",
        )

    min_len = int(getattr(settings, "MIN_PASSWORD_LENGTH", 8) or 8)
    if len(new_password) < min_len:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Новый пароль должен быть не короче {min_len} символов",
        )
    if new_password != confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Подтверждение пароля не совпадает",
        )
    if new_password == current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Новый пароль должен отличаться от текущего",
        )

    user.hashed_password = get_password_hash(new_password)
    await db.commit()
    return ProfileUpdateResponse(detail="Пароль обновлён")
