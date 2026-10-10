"""
Админ маршруты для уроков.
- Видео сохраняются в static/videos/
- Допустимый формат → Celery transcode в 720/1080 + thumbnail
"""

import os
import logging
from uuid import UUID, uuid4

from fastapi import (
    APIRouter, Depends, File, Form, HTTPException,
    Path, Request, UploadFile, status
)
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete
from sqlalchemy.orm import selectinload

from auth.dependencies import require_admin
from core.config import settings
from core.templating import CsrfTemplates
from db import models
from db.database import get_db
from services.lesson_service import invalidate_lesson_cache
from tasks.video_task import process_video_task

from routers.admin.file_utils import (
    BASE_DIR,
    safe_filename,
    save_upload_file_streaming,
    create_dir,
    delete_file_async,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin lessons"])

templates = CsrfTemplates(directory="templates/")

VIDEO_DIR = os.path.join(BASE_DIR, "static", "videos")

ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv", ".m4v"}
ALLOWED_VIDEO_CONTENT_TYPES = {
    "video/mp4",
    "video/quicktime",
    "video/webm",
    "video/x-matroska",
    "application/octet-stream",
    "",
}


def _max_video_bytes() -> int:
    mb = getattr(settings, "MAX_VIDEO_UPLOAD_MB", 10000)
    return int(mb) * 1024 * 1024


def make_unique_filename(name: str) -> str:
    name = safe_filename(name or "video")
    base, ext = os.path.splitext(name)
    if not ext:
        ext = ".mp4"
    return f"{base}-{uuid4().hex}{ext}"


async def _validate_video_upload(upload: UploadFile) -> str:
    filename = upload.filename or ""
    _, ext = os.path.splitext(filename)
    ext = ext.lower()
    if ext not in ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Допустимы видео: MP4, MOV, WEBM, MKV",
        )
    content_type = (upload.content_type or "").lower()
    if content_type and content_type not in ALLOWED_VIDEO_CONTENT_TYPES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Недопустимый тип видеофайла",
        )
    return ext


async def _store_lesson_video(lesson: models.Lesson, video_file: UploadFile, db: AsyncSession) -> None:
    await _validate_video_upload(video_file)
    await create_dir(VIDEO_DIR)
    filename = make_unique_filename(video_file.filename or "video.mp4")
    fs_path = os.path.join(VIDEO_DIR, filename)
    await save_upload_file_streaming(video_file, fs_path, max_bytes=_max_video_bytes())
    base_name, _ = os.path.splitext(filename)

    lesson.video_path_720 = None
    lesson.video_path_1080 = None
    lesson.thumbnail_path = None
    db.add(lesson)
    await db.commit()

    process_video_task.apply_async(
        args=[str(lesson.id), fs_path, base_name],
        queue="videos",
    )


@router.get("/courses/{course_id}/lessons", response_class=HTMLResponse)
async def admin_lessons_list(
    request: Request,
    course_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    stmt = (
        select(models.Course)
        .options(selectinload(models.Course.lessons))
        .filter(models.Course.id == course_id)
    )
    result = await db.execute(stmt)
    course = result.scalars().first()

    if not course:
        raise HTTPException(404, "Курс не найден")

    return templates.TemplateResponse(
        "admin/lessons_list.html",
        {
            "request": request,
            "course": course,
            "lessons": course.lessons,
            "user": current_user,
        },
    )


@router.get("/courses/{course_id}/lessons/new", response_class=HTMLResponse)
async def new_lesson_page(
    request: Request,
    course_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    # получаем курс
    stmt = select(models.Course).filter(models.Course.id == course_id)
    result = await db.execute(stmt)
    course = result.scalars().first()

    if not course:
        raise HTTPException(404, "Курс не найден")

    # render формы
    return templates.TemplateResponse(
        "admin/lesson_form.html",
        {
            "request": request,
            "course": course,
            "lesson": None,
            "user": current_user,
        },
    )


@router.get("/lessons/{lesson_id}/edit", response_class=HTMLResponse)
async def edit_lesson_page(
    request: Request,
    lesson_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    stmt = (
        select(models.Lesson)
        .options(selectinload(models.Lesson.course))
        .filter(models.Lesson.id == lesson_id)
    )
    result = await db.execute(stmt)
    lesson = result.scalars().first()

    if not lesson:
        raise HTTPException(404, "Урок не найден")

    return templates.TemplateResponse(
        "admin/lesson_form.html",
        {
            "request": request,
            "course": lesson.course,
            "lesson": lesson,
            "user": current_user,
        },
    )

# ================================
# CREATE
# ================================
@router.post("/courses/{course_id}/lessons/create")
async def create_lesson(
    course_id: UUID = Path(...),
    title: str = Form(...),
    text_content: str = Form(""),
    video_file: UploadFile = File(None),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    q = select(models.Course).filter(models.Course.id == course_id)
    course = (await db.execute(q)).scalars().first()
    if not course:
        raise HTTPException(404, "Курс не найден")

    lesson = models.Lesson(
        course_id=course.id,
        title=title,
        text_content=text_content,
    )
    db.add(lesson)
    await db.commit()
    await db.refresh(lesson)

    if video_file and video_file.filename:
        await _store_lesson_video(lesson, video_file, db)

    await invalidate_lesson_cache(lesson.id)
    return RedirectResponse(
        f"/admin/courses/{course_id}/lessons",
        status_code=status.HTTP_303_SEE_OTHER,
    )


# ================================
# UPDATE
# ================================
@router.post("/lessons/{lesson_id}/update")
async def update_lesson(
    lesson_id: UUID = Path(...),
    title: str = Form(...),
    text_content: str = Form(""),
    video_file: UploadFile = File(None),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    q = select(models.Lesson).filter(models.Lesson.id == lesson_id)
    lesson = (await db.execute(q)).scalars().first()
    if not lesson:
        raise HTTPException(404, "Урок не найден")

    lesson.title = title
    lesson.text_content = text_content

    if video_file and video_file.filename:
        for attr in ("video_path_720", "video_path_1080", "thumbnail_path"):
            val = getattr(lesson, attr, None)
            if val:
                await delete_file_async(val)
        await _store_lesson_video(lesson, video_file, db)

    db.add(lesson)
    await db.commit()
    await invalidate_lesson_cache(lesson.id)

    return RedirectResponse(
        f"/admin/courses/{lesson.course_id}/lessons",
        status_code=status.HTTP_303_SEE_OTHER,
    )


# ================================
# DELETE
# ================================
@router.post("/lessons/{lesson_id}/delete")
async def delete_lesson(
    lesson_id: UUID = Path(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    q = select(models.Lesson).filter(models.Lesson.id == lesson_id)
    lesson = (await db.execute(q)).scalars().first()

    if not lesson:
        raise HTTPException(404, "Урок не найден")

    course_id = lesson.course_id

    # удаляем видео и превью
    for attr in ("video_path_720", "video_path_1080", "thumbnail_path"):
        val = getattr(lesson, attr, None)
        if val:
            await delete_file_async(val)

    # удаляем заметки и completion
    await db.execute(delete(models.Note).where(models.Note.lesson_id == lesson_id))
    await db.execute(delete(models.LessonCompletion).where(models.LessonCompletion.lesson_id == lesson_id))

    await db.delete(lesson)
    await db.commit()

    await invalidate_lesson_cache(lesson.id)

    return RedirectResponse(
        f"/admin/courses/{course_id}/lessons",
        status_code=status.HTTP_303_SEE_OTHER,
    )
