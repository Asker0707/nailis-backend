"""
Модуль административных маршрутов для управления курсами.

Предоставляет администратору интерфейс для:
- Просмотра списка всех курсов
- Создания новых курсов
- Редактирования существующих курсов
- Удаления курсов

Основные функции:
- admin_courses_page: Отображение списка курсов
- new_course_page: Форма создания нового курса
- create_course_form: Обработка создания курса
- edit_course_page: Форма редактирования курса
- update_course: Обработка обновления курса
- delete_course: Удаление курса
"""

from __future__ import annotations

import os
import uuid
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from auth.dependencies import require_admin
from core.config import settings
from core.templating import CsrfTemplates
from db import models
from db.database import get_db
from routers.admin.file_utils import delete_file_async, save_upload_file_streaming
from services.lesson_service import invalidate_lesson_cache

router = APIRouter(prefix="/admin/courses", tags=["Админские маршруты для курсов"])

templates = CsrfTemplates(directory="templates")

_DEFAULT_COVER_URL = "/static/images/nail-polish-bottle.png"
_ALLOWED_COVER_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
_ALLOWED_COVER_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/jpg",
}
_MAX_COVER_BYTES = 5 * 1024 * 1024


def _parse_price(raw: str | None) -> int | None:
    if raw is None:
        return None
    cleaned = (
        str(raw)
        .strip()
        .replace(" ", "")
        .replace("\u00a0", "")
        .replace("₽", "")
        .replace(",", "")
    )
    if not cleaned:
        return None
    try:
        value = int(cleaned)
    except ValueError:
        return None
    return value if value >= 0 else None


def cover_public_url(cover_path: str | None) -> str:
    if not cover_path:
        return _DEFAULT_COVER_URL
    normalized = str(cover_path).strip().lstrip("/")
    return f"/{normalized}"


async def _save_course_cover(upload: UploadFile, course_id: UUID) -> str:
    filename = upload.filename or ""
    extension = os.path.splitext(filename)[1].lower()
    content_type = (upload.content_type or "").lower()

    if extension not in _ALLOWED_COVER_EXT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Допустимы JPG, PNG, WEBP или GIF",
        )
    if content_type and content_type not in _ALLOWED_COVER_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неверный тип файла обложки",
        )

    covers_dir = os.path.join(settings.BASE_DIR, "static", "course_covers")
    os.makedirs(covers_dir, exist_ok=True)
    stored_name = f"{course_id}_{uuid.uuid4().hex[:8]}{extension}"
    absolute_path = os.path.join(covers_dir, stored_name)
    await save_upload_file_streaming(upload, absolute_path, max_bytes=_MAX_COVER_BYTES)
    return f"static/course_covers/{stored_name}"


@router.get("/", response_class=HTMLResponse)
async def admin_courses_page(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    result = await db.execute(select(models.Course))
    courses = result.scalars().all()

    return templates.TemplateResponse(
        "admin/course_list.html",
        {
            "request": request,
            "courses": courses,
            "user": current_user,
            "is_admin": current_user.is_admin,
        },
    )


@router.get("/new", response_class=HTMLResponse)
async def new_course_page(
    request: Request, current_user: models.User = Depends(require_admin)
):
    return templates.TemplateResponse(
        "admin/course_form.html",
        {
            "request": request,
            "course": None,
            "user": current_user,
            "cover_preview": _DEFAULT_COVER_URL,
        },
    )


@router.post("/create")
async def create_course_form(
    title: str = Form(...),
    description: str = Form(""),
    price: str = Form(""),
    is_free: str | None = Form(None),
    cover: UploadFile | None = File(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    free = is_free in {"1", "on", "true", "True"}
    course = models.Course(
        title=title.strip(),
        description=(description or "").strip() or None,
        is_free=free,
        price=None if free else _parse_price(price),
    )
    db.add(course)
    await db.flush()

    if cover and cover.filename:
        course.cover_path = await _save_course_cover(cover, course.id)

    await db.commit()
    return RedirectResponse("/admin/courses", status_code=status.HTTP_303_SEE_OTHER)


@router.get("/{course_id}/edit", response_class=HTMLResponse)
async def edit_course_page(
    course_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    result = await db.execute(
        select(models.Course).filter(models.Course.id == course_id)
    )
    course = result.scalars().first()

    if not course:
        raise HTTPException(status_code=404, detail="Курс не найден")

    return templates.TemplateResponse(
        "admin/course_edit.html",
        {
            "request": request,
            "course": course,
            "user": current_user,
            "cover_preview": cover_public_url(course.cover_path),
        },
    )


@router.post("/{course_id}/edit")
async def update_course(
    course_id: UUID,
    title: str = Form(...),
    description: str = Form(""),
    price: str = Form(""),
    is_free: str | None = Form(None),
    remove_cover: str | None = Form(None),
    cover: UploadFile | None = File(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    result = await db.execute(
        select(models.Course).filter(models.Course.id == course_id)
    )
    course = result.scalars().first()

    if not course:
        raise HTTPException(status_code=404, detail="Курс не найден")

    free = is_free in {"1", "on", "true", "True"}
    course.title = title.strip()
    course.description = (description or "").strip() or None
    course.is_free = free
    course.price = None if free else _parse_price(price)

    if remove_cover in {"1", "on", "true", "True"} and course.cover_path:
        await delete_file_async(course.cover_path)
        course.cover_path = None

    if cover and cover.filename:
        new_path = await _save_course_cover(cover, course.id)
        if course.cover_path and course.cover_path != new_path:
            await delete_file_async(course.cover_path)
        course.cover_path = new_path

    await db.commit()

    return RedirectResponse(
        url="/admin/courses",
        status_code=status.HTTP_303_SEE_OTHER,
    )


@router.post("/{course_id}/delete")
async def delete_course(
    course_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """Удаляет курс вместе с уроками, связанными данными и медиафайлами."""
    result = await db.execute(
        select(models.Course)
        .options(selectinload(models.Course.lessons))
        .filter(models.Course.id == course_id)
    )
    course = result.scalars().first()

    if not course:
        raise HTTPException(status_code=404, detail="Курс не найден")

    lesson_ids = [lesson.id for lesson in course.lessons]

    if course.cover_path:
        await delete_file_async(course.cover_path)

    for lesson in course.lessons:
        for attr in ("video_path_720", "video_path_1080", "thumbnail_path"):
            val = getattr(lesson, attr, None)
            if val:
                await delete_file_async(val)

    if lesson_ids:
        await db.execute(delete(models.Note).where(models.Note.lesson_id.in_(lesson_ids)))
        await db.execute(
            delete(models.LessonCompletion).where(
                models.LessonCompletion.lesson_id.in_(lesson_ids)
            )
        )

    await db.execute(
        delete(models.CourseAssessmentAttempt).where(
            models.CourseAssessmentAttempt.course_id == course_id
        )
    )
    homework_rows = (
        await db.execute(
            select(models.HomeworkSubmission).where(
                models.HomeworkSubmission.course_id == course_id
            )
        )
    ).scalars().all()
    for row in homework_rows:
        if row.submission_path:
            await delete_file_async(row.submission_path)
    await db.execute(
        delete(models.HomeworkSubmission).where(
            models.HomeworkSubmission.course_id == course_id
        )
    )
    await db.execute(
        delete(models.UserCourseAccess).where(
            models.UserCourseAccess.course_id == course_id
        )
    )

    await db.delete(course)
    await db.commit()

    for lesson_id in lesson_ids:
        await invalidate_lesson_cache(lesson_id)

    return RedirectResponse(
        url="/admin/courses",
        status_code=status.HTTP_303_SEE_OTHER,
    )
