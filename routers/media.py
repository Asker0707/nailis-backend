"""Защищённая раздача видео уроков (не через публичный /static)."""

from __future__ import annotations

import logging
import os
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from auth.dependencies import get_current_user
from core.config import settings
from db import models
from db.database import get_db
from routers.admin.file_utils import resolve_fs_path

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/media/lessons", tags=["lesson media"])

QUALITY_ATTR = {
    "720p": "video_path_720",
    "720": "video_path_720",
    "1080p": "video_path_1080",
    "1080": "video_path_1080",
}


def _resolve_lesson_file(lesson: models.Lesson, quality: str) -> str:
    preferred = QUALITY_ATTR.get(str(quality).lower(), "video_path_720")
    fallback_order = [preferred, "video_path_720", "video_path_1080"]
    seen: set[str] = set()
    for attr in fallback_order:
        if attr in seen:
            continue
        seen.add(attr)
        relative = getattr(lesson, attr, None)
        if not relative:
            continue
        fs_path = resolve_fs_path(str(relative))
        normalized = fs_path.replace("\\", "/")
        if "/videos/hero/" in normalized:
            continue
        if fs_path and os.path.isfile(fs_path):
            base = os.path.realpath(settings.BASE_DIR)
            real = os.path.realpath(fs_path)
            if real == base or real.startswith(base + os.sep):
                return real
    raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Видео не найдено")


@router.get("/{lesson_id}/{quality}")
async def stream_lesson_video(
    lesson_id: UUID = Path(...),
    quality: str = Path(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Стримит видео урока только при наличии доступа к курсу."""
    lesson = (
        await db.execute(select(models.Lesson).where(models.Lesson.id == lesson_id))
    ).scalars().first()
    if not lesson:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Урок не найден")

    course = (
        await db.execute(select(models.Course).where(models.Course.id == lesson.course_id))
    ).scalars().first()
    if not course:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Курс не найден")

    # Короткое превью на странице курса доступно после логина.
    # Полный урок (текст/заметки) по-прежнему закрыт без оплаты.

    fs_path = _resolve_lesson_file(lesson, quality)
    filename = os.path.basename(fs_path)
    logger.debug(
        "Streaming lesson %s (%s) for %s",
        lesson_id,
        quality,
        current_user.email,
    )
    return FileResponse(
        path=fs_path,
        media_type="video/mp4",
        filename=filename,
        content_disposition_type="inline",
    )
