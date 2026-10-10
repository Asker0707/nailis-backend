"""
Модуль маршрутов для работы с уроками.

Предоставляет функционал:
- Просмотр страницы урока с содержимым
- Отметка урока как завершенного
- Проверка статуса завершения урока

Зависимости:
- Требуется аутентифицированный пользователь
- Доступ к базе данных через AsyncSession
- Сервисный слой lesson_service для работы с уроками

Особенности:
- Использует шаблоны Jinja2 для рендеринга HTML
- Поддерживает JSON API для операций с завершением уроков
- Интегрируется с системой заметок пользователя
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, status
from fastapi.responses import JSONResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from db import models
from db.database import get_db
from services.course_access import get_course_for_lesson, user_has_course_access
from services.lesson_service import (
    is_lesson_completed,
    mark_lesson_completed,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/lessons", tags=["Уроки"])
templates = Jinja2Templates(directory="templates")


@router.put("/{lesson_id}/complete")
async def complete_lesson(
    lesson_id: UUID = Path(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Отмечает урок как завершенный для текущего пользователя.

    Args:
        lesson_id (UUID): Идентификатор урока
        db (AsyncSession): Асинхронная сессия базы данных
        current_user (models.User): Текущий аутентифицированный пользователь

    Returns:
        JSONResponse: Результат операции в формате JSON

    Raises:
        HTTPException: 404 если урок не найден
    """
    lesson, course = await get_course_for_lesson(lesson_id, db)
    if not lesson or not course:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Урок не найден")
    if not await user_has_course_access(current_user, course, db):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Нет доступа к курсу")

    result = await mark_lesson_completed(lesson_id, current_user.id, db)
    if result is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Урок не найден")
    if not result:
        return JSONResponse(
            
            {"detail": "Урок уже завершён"},
            status_code=status.HTTP_400_BAD_REQUEST
        )
    return JSONResponse(
        {"detail": "Урок завершён"}, status_code=status.HTTP_201_CREATED
    )


@router.get("/{lesson_id}/complete")
async def lesson_completed_status(
    lesson_id: UUID = Path(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Проверяет статус завершения урока для текущего пользователя.

    Args:
        lesson_id (UUID): Идентификатор урока
        db (AsyncSession): Асинхронная сессия базы данных
        current_user (models.User): Текущий аутентифицированный пользователь

    Returns:
        dict: Словарь с ключом 'completed' и булевым значением статуса
    """
    completed = await is_lesson_completed(lesson_id, current_user.id, db)
    return {"completed": completed}
