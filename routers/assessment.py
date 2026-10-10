"""API финального теста и сдачи домашней работы по курсу."""

from __future__ import annotations

import json
import logging
import os
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from core.config import settings
from db import models
from db.database import get_db
from routers.admin.file_utils import create_dir, safe_filename, save_upload_file_streaming
from services.assessment_service import (
    build_assessment_questions,
    load_lesson_titles,
    score_answers,
)
from services.course_access import user_has_course_access
from tasks.email_task import send_email_task

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/courses", tags=["course assessment"])

HOMEWORK_DIR = os.path.join(settings.BASE_DIR, "static", "homework")
MAX_HOMEWORK_BYTES = 15 * 1024 * 1024
ALLOWED_HOMEWORK_EXT = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".zip"}


class AssessmentSubmitIn(BaseModel):
    answers: dict[str, str] = Field(default_factory=dict)


@router.post("/{course_id}/assessment")
async def submit_assessment(
    course_id: UUID,
    payload: AssessmentSubmitIn,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    course = (
        await db.execute(select(models.Course).where(models.Course.id == course_id))
    ).scalars().first()
    if not course:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Курс не найден")
    if not await user_has_course_access(current_user, course, db):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Нет доступа к курсу")

    titles = await load_lesson_titles(course_id, db)
    questions = build_assessment_questions(course_id, titles)
    if not questions:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Тест пока недоступен для этого курса",
        )

    missing = [q["id"] for q in questions if not str(payload.answers.get(q["id"], "")).strip()]
    if missing:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Ответь на все вопросы теста",
        )

    score, total, passed = score_answers(questions, payload.answers)
    attempt = models.CourseAssessmentAttempt(
        course_id=course_id,
        user_id=current_user.id,
        score=score,
        total_questions=total,
        passed=passed,
        answers_json=json.dumps(payload.answers, ensure_ascii=False),
    )
    db.add(attempt)
    await db.commit()
    await db.refresh(attempt)

    return {
        "id": str(attempt.id),
        "score": score,
        "total_questions": total,
        "passed": passed,
        "created_at": attempt.created_at.isoformat() if attempt.created_at else None,
    }


@router.post("/{course_id}/homework")
async def submit_homework(
    course_id: UUID,
    message: str = Form(""),
    resource_url: str = Form(""),
    delivery_channel: str = Form("email"),
    homework_file: UploadFile | None = File(None),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    course = (
        await db.execute(select(models.Course).where(models.Course.id == course_id))
    ).scalars().first()
    if not course:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Курс не найден")
    if not await user_has_course_access(current_user, course, db):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Нет доступа к курсу")

    channel = (delivery_channel or "email").strip().lower()
    if channel not in {"email", "telegram"}:
        channel = "email"

    message = (message or "").strip()
    resource_url = (resource_url or "").strip()
    submission_path: str | None = None

    if homework_file and homework_file.filename:
        _, ext = os.path.splitext(homework_file.filename)
        ext = ext.lower()
        if ext not in ALLOWED_HOMEWORK_EXT:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Допустимы файлы: PDF, PNG, JPG, WEBP, ZIP",
            )
        await create_dir(HOMEWORK_DIR)
        filename = f"{uuid4().hex}-{safe_filename(homework_file.filename)}"
        fs_path = os.path.join(HOMEWORK_DIR, filename)
        await save_upload_file_streaming(
            homework_file,
            fs_path,
            max_bytes=MAX_HOMEWORK_BYTES,
        )
        submission_path = f"static/homework/{filename}"

    if not message and not resource_url and not submission_path:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Добавь ссылку, описание или файл домашней работы",
        )

    submission = models.HomeworkSubmission(
        course_id=course_id,
        user_id=current_user.id,
        message=message or None,
        resource_url=resource_url or None,
        submission_path=submission_path,
        delivery_channel=channel,
        delivery_status="queued",
    )
    db.add(submission)
    await db.commit()
    await db.refresh(submission)

    if channel == "email":
        body_parts = [
            f"Домашняя работа по курсу «{course.title}»",
            f"Студент: {current_user.full_name or current_user.email}",
            f"Email: {current_user.email}",
        ]
        if message:
            body_parts.append(f"Сообщение:\n{message}")
        if resource_url:
            body_parts.append(f"Ссылка: {resource_url}")
        if submission_path:
            body_parts.append(f"Файл: /{submission_path}")
        try:
            send_email_task.apply_async(
                args=[
                    settings.EMAIL_FROM,
                    f"ДЗ: {course.title}",
                    "\n\n".join(body_parts),
                ],
                queue="emails",
            )
            submission.delivery_status = "sent"
        except Exception:
            logger.exception("Не удалось поставить email-задачу для ДЗ")
            submission.delivery_status = "failed"
        await db.commit()
    else:
        submission.delivery_status = "queued"
        await db.commit()

    return {
        "id": str(submission.id),
        "delivery_channel": submission.delivery_channel,
        "delivery_status": submission.delivery_status,
        "created_at": submission.created_at.isoformat() if submission.created_at else None,
        "resource_url": submission.resource_url,
        "file_name": os.path.basename(submission_path) if submission_path else None,
    }
