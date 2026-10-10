"""
Модуль для работы с заметками к урокам.

Содержит API endpoints для CRUD-операций с заметками пользователей:
- Получение списка заметок по уроку
- Создание новой заметки
- Обновление существующей заметки
- Удаление заметки

Основные модели:
- NoteIn - входные данные для создания/обновления заметки
- NoteOut - выходные данные заметки
- MessageOut - универсальный ответ для операций создания/обновления/удаления
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from auth.dependencies import get_current_user
from db import models
from db.database import get_db
from schemas.note import NoteIn, NoteOut, MessageOut
from services.course_access import get_course_for_lesson, user_has_course_access


async def _require_lesson_course_access(
    lesson_id: UUID,
    current_user: models.User,
    db: AsyncSession,
) -> models.Lesson:
    lesson, course = await get_course_for_lesson(lesson_id, db)
    if not lesson or not course:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Урок не найден")
    if not await user_has_course_access(current_user, course, db):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Нет доступа к курсу")
    return lesson

router = APIRouter(prefix="/lessons", tags=["Заметки"])


@router.get("/{lesson_id}/notes", response_model=list[NoteOut])
async def read_notes(
    lesson_id: UUID = Path(..., description="UUID урока"),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> list[NoteOut]:
    """
    Получить список заметок пользователя для конкретного урока.

    Args:
        lesson_id (UUID): UUID урока, для которого запрашиваются заметки.
        db (AsyncSession): Асинхронная сессия базы данных (зависимость).
        current_user (models.User): Текущий аутентифицированный
                                    пользователь (зависимость).

    Returns:
        list[NoteOut]: Список заметок, отсортированных по дате создания
                                                       в порядке убывания.

    Raises:
        HTTPException 401: Если пользователь не аутентифицирован
        (обрабатывается зависимостью).
    """
    await _require_lesson_course_access(lesson_id, current_user, db)
    stmt = (
        select(models.Note)
        .where(
            models.Note.lesson_id == lesson_id,
            models.Note.user_id == current_user.id
        )
        .order_by(models.Note.created_at.desc())
    )

    result = await db.execute(stmt)
    notes = result.scalars().all()
    return [NoteOut.model_validate(note) for note in notes]


@router.post(
    "/{lesson_id}/note",
    response_model=MessageOut,
    status_code=status.HTTP_201_CREATED
)
async def create_note(
    lesson_id: UUID,
    note_in: NoteIn,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> MessageOut:
    """
    Создать новую заметку пользователя для указанного урока.

    Args:
        lesson_id (UUID): UUID урока, к которому относится заметка.
        note_in (NoteIn): Входные данные заметки (контент).
        db (AsyncSession): Асинхронная сессия базы данных (зависимость).
        current_user (models.User): Текущий аутентифицированный
                                    пользователь (зависимость).

    Returns:
        MessageOut: Объект с сообщением об успешном добавлении и
                                                    UUID созданной заметки.

    Raises:
        HTTPException 404: Если урок с таким lesson_id не найден.
        HTTPException 401: Если пользователь не аутентифицирован.
    """
    await _require_lesson_course_access(lesson_id, current_user, db)

    note = models.Note(
        user_id=current_user.id,
        lesson_id=lesson_id,
        content=note_in.content,
    )
    db.add(note)
    await db.commit()
    await db.refresh(note)

    return MessageOut(detail="Заметка добавлена", id=str(note.id))


@router.put("/{lesson_id}/note/{note_id}", response_model=MessageOut)
async def update_note(
    lesson_id: UUID,
    note_id: UUID,
    note_in: NoteIn,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> MessageOut:
    """
    Обновить содержимое существующей заметки пользователя
    по note_id и lesson_id.

    Args:
        lesson_id (UUID): UUID урока, к которому относится заметка.
        note_id (UUID): UUID заметки, которую нужно обновить.
        note_in (NoteIn): Входные данные с обновленным контентом заметки.
        db (AsyncSession): Асинхронная сессия базы данных (зависимость).
        current_user (models.User): Текущий аутентифицированный
        пользователь (зависимость).

    Returns:
        MessageOut: Объект с сообщением об успешном обновлении и UUID заметки.

    Raises:
        HTTPException 404: Если заметка с таким note_id и lesson_id
                           для пользователя не найдена.
        HTTPException 401: Если пользователь не аутентифицирован.
    """
    await _require_lesson_course_access(lesson_id, current_user, db)
    stmt = select(models.Note).where(
        models.Note.id == note_id,
        models.Note.lesson_id == lesson_id,
        models.Note.user_id == current_user.id,
    )
    result = await db.execute(stmt)
    note = result.scalars().first()

    if not note:
        raise HTTPException(status_code=404, detail="Заметка не найдена")

    note.content = note_in.content
    await db.commit()
    return MessageOut(detail="Заметка обновлена", id=str(note.id))


@router.delete("/{lesson_id}/note/{note_id}", response_model=MessageOut)
async def delete_note(
    lesson_id: UUID,
    note_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> MessageOut:
    """
    Удалить заметку пользователя по note_id и lesson_id.

    Args:
        lesson_id (UUID): UUID урока, к которому относится заметка.
        note_id (UUID): UUID заметки, которую нужно удалить.
        db (AsyncSession): Асинхронная сессия базы данных (зависимость).
        current_user (models.User): Текущий аутентифицированный
                                    пользователь (зависимость).

    Returns:
        MessageOut: Объект с сообщением об успешном
                    удалении и UUID удалённой заметки.

    Raises:
        HTTPException 404: Если заметка с таким note_id и lesson_id
                           для пользователя не найдена.
        HTTPException 401: Если пользователь не аутентифицирован.
    """
    await _require_lesson_course_access(lesson_id, current_user, db)
    stmt = select(models.Note).where(
        models.Note.id == note_id,
        models.Note.lesson_id == lesson_id,
        models.Note.user_id == current_user.id,
    )
    result = await db.execute(stmt)
    note = result.scalars().first()

    if not note:
        raise HTTPException(status_code=404, detail="Заметка не найдена")

    await db.delete(note)
    await db.commit()
    return MessageOut(detail="Заметка удалена", id=str(note.id))
