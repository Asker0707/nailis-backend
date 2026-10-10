"""
Модуль маршрутов веб-интерфейса FastAPI.

Отвечает за рендер HTML-страниц:
- кабинет и профиль
- список курсов
- детальную страницу курса
- страницу урока
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from auth.dependencies import get_current_user, get_optional_current_user
from core.templating import CsrfTemplates
from db import models
from db.database import get_db
from services.assessment_service import (
    build_assessment_questions,
    pass_score_for,
    public_assessment_questions,
)
from services.course_access import (
    TELEGRAM_BUY_URL,
    course_access_map,
    payment_path,
    user_has_course_access,
)
from services.lesson_service import get_lesson_data, lesson_media_url

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Получение html страниц"])
templates = CsrfTemplates(directory="templates")


def _public_static_path(path: str | None) -> str | None:
    if not path:
        return None
    normalized = str(path).strip().lstrip("/")
    return f"/{normalized}" if normalized else None


async def _course_lessons_with_progress(
    course_id: UUID,
    user_id: UUID,
    db: AsyncSession,
    *,
    include_media: bool = True,
) -> tuple[models.Course, list[dict], bool]:
    course_result = await db.execute(
        select(models.Course).filter(models.Course.id == course_id)
    )
    course = course_result.scalars().first()
    if not course:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Курс не найден")

    lessons_result = await db.execute(
        select(models.Lesson)
        .filter(models.Lesson.course_id == course_id)
        .order_by(models.Lesson.title.asc())
    )
    lesson_objects = lessons_result.scalars().all()

    completion_result = await db.execute(
        select(models.LessonCompletion.lesson_id)
        .join(models.Lesson, models.LessonCompletion.lesson_id == models.Lesson.id)
        .filter(
            models.Lesson.course_id == course_id,
            models.LessonCompletion.user_id == user_id,
        )
    )
    completed_ids = {row[0] for row in completion_result.fetchall()}

    lessons = []
    for lesson in lesson_objects:
        completed = lesson.id in completed_ids
        preview_quality = None
        preview_url = None
        poster_url = None
        if include_media:
            preview_quality = "720p" if lesson.video_path_720 else ("1080p" if lesson.video_path_1080 else None)
            preview_url = (
                lesson_media_url(lesson.id, preview_quality)
                if preview_quality
                else None
            )
            poster_url = _public_static_path(lesson.thumbnail_path)
        lessons.append(
            {
                "id": lesson.id,
                "title": lesson.title,
                "video_path_720": lesson.video_path_720 if include_media else None,
                "video_path_1080": lesson.video_path_1080 if include_media else None,
                "preview_url": preview_url,
                "poster_url": poster_url,
                "completed": completed if include_media else False,
                "progress": 100 if (include_media and completed) else 0,
            }
        )

    course_completed = bool(lessons) and include_media and all(item["completed"] for item in lessons)
    return course, lessons, course_completed


@router.get("/user/dashboard", response_class=HTMLResponse)
async def dashboard_page(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    stmt = (
        select(models.Note, models.Lesson)
        .join(models.Lesson, models.Note.lesson_id == models.Lesson.id)
        .filter(models.Note.user_id == current_user.id)
        .order_by(models.Note.created_at.desc())
    )
    result = await db.execute(stmt)
    notes = result.all()

    note_data = []
    note_groups_map: dict[str, dict] = {}
    for note, lesson in notes:
        item = {
            "note_id": note.id,
            "lesson_id": lesson.id,
            "lesson_title": lesson.title,
            "content": note.content,
            "created_at": note.created_at,
        }
        note_data.append(item)

        lesson_key = str(lesson.id)
        if lesson_key not in note_groups_map:
            note_groups_map[lesson_key] = {
                "lesson_id": lesson.id,
                "lesson_title": lesson.title,
                "latest_created_at": note.created_at,
                "items": [],
            }
        note_groups_map[lesson_key]["items"].append(item)

    note_groups = list(note_groups_map.values())
    notes_count = len(note_data)

    completed_stmt = select(models.LessonCompletion.lesson_id).filter(
        models.LessonCompletion.user_id == current_user.id
    )
    completed_result = await db.execute(completed_stmt)
    completed_lessons = {row[0] for row in completed_result.fetchall()}
    lessons_completed = len(completed_lessons)

    lesson_stmt = select(models.Lesson).order_by(models.Lesson.title.asc())
    lesson_result = await db.execute(lesson_stmt)
    all_lessons = lesson_result.scalars().all()
    lessons_total = len(all_lessons)
    progress_percent = (
        int(round((lessons_completed / lessons_total) * 100)) if lessons_total else 0
    )

    current_lesson = None
    for lesson in all_lessons:
        if lesson.id not in completed_lessons:
            current_lesson = lesson
            break

    assessments = (
        await db.execute(
            select(models.CourseAssessmentAttempt).where(
                models.CourseAssessmentAttempt.user_id == current_user.id
            )
        )
    ).scalars().all()
    assessments_passed = sum(1 for item in assessments if item.passed)
    best_attempt = max(
        assessments,
        key=lambda item: (item.score, item.total_questions),
        default=None,
    )
    best_assessment_score = best_attempt.score if best_attempt else 0
    best_assessment_total = best_attempt.total_questions if best_attempt else 0

    homework_count = (
        await db.execute(
            select(func.count())
            .select_from(models.HomeworkSubmission)
            .where(models.HomeworkSubmission.user_id == current_user.id)
        )
    ).scalar_one()

    metrics = {
        "lessons_completed": lessons_completed,
        "lessons_total": lessons_total,
        "progress_percent": progress_percent,
        "notes_count": notes_count,
        "note_lessons": len(note_groups),
        "assessments_passed": assessments_passed,
        "homework_count": int(homework_count or 0),
        "best_assessment_score": best_assessment_score,
        "best_assessment_total": best_assessment_total,
    }

    achievement_defs = [
        {
            "id": "first_note",
            "title": "Первая заметка",
            "desc": "Сохранили конспект по уроку",
            "icon": "bi-journal-text",
            "unlocked": notes_count >= 1,
        },
        {
            "id": "note_taker",
            "title": "Конспектист",
            "desc": "5 и более заметок",
            "icon": "bi-journals",
            "unlocked": notes_count >= 5,
        },
        {
            "id": "first_lesson",
            "title": "Первый урок",
            "desc": "Завершили первый урок",
            "icon": "bi-play-circle",
            "unlocked": lessons_completed >= 1,
        },
        {
            "id": "on_track",
            "title": "В темпе",
            "desc": "3 завершённых урока",
            "icon": "bi-lightning-charge",
            "unlocked": lessons_completed >= 3,
        },
        {
            "id": "halfway",
            "title": "Середина пути",
            "desc": "Прогресс курса от 50%",
            "icon": "bi-flag",
            "unlocked": progress_percent >= 50,
        },
        {
            "id": "almost_done",
            "title": "Почти финиш",
            "desc": "Прогресс курса от 80%",
            "icon": "bi-trophy",
            "unlocked": progress_percent >= 80,
        },
        {
            "id": "test_passed",
            "title": "Тест сдан",
            "desc": "Успешно прошли проверку",
            "icon": "bi-patch-check",
            "unlocked": assessments_passed >= 1,
        },
        {
            "id": "homework_sent",
            "title": "Домашка сдана",
            "desc": "Отправили работу на проверку",
            "icon": "bi-upload",
            "unlocked": int(homework_count or 0) >= 1,
        },
    ]
    achievements_unlocked = sum(1 for item in achievement_defs if item["unlocked"])

    course_rows = (
        await db.execute(select(models.Course).order_by(models.Course.title.asc()))
    ).scalars().all()
    access_by_id = await course_access_map(current_user, list(course_rows), db)

    totals_rows = (
        await db.execute(
            select(models.Lesson.course_id, func.count(models.Lesson.id)).group_by(
                models.Lesson.course_id
            )
        )
    ).all()
    total_by_course = {course_id: int(count or 0) for course_id, count in totals_rows}

    completed_by_course_rows = (
        await db.execute(
            select(models.Lesson.course_id, func.count(models.LessonCompletion.id))
            .join(
                models.LessonCompletion,
                models.LessonCompletion.lesson_id == models.Lesson.id,
            )
            .where(models.LessonCompletion.user_id == current_user.id)
            .group_by(models.Lesson.course_id)
        )
    ).all()
    completed_by_course = {
        course_id: int(count or 0) for course_id, count in completed_by_course_rows
    }

    my_courses = []
    for course in course_rows:
        if not access_by_id.get(course.id):
            continue
        total = total_by_course.get(course.id, 0)
        done = completed_by_course.get(course.id, 0)
        progress = int(round((done / total) * 100)) if total else 0
        my_courses.append(
            {
                "id": course.id,
                "title": course.title,
                "cover_path": course.cover_path,
                "is_free": course.is_free,
                "lessons_total": total,
                "lessons_completed": done,
                "progress_percent": progress,
            }
        )

    return templates.TemplateResponse(
        "dashboard.html",
        {
            "request": request,
            "user": current_user,
            "notes": note_data,
            "note_groups": note_groups,
            "notes_count": notes_count,
            "current_lesson": current_lesson,
            "metrics": metrics,
            "achievements": achievement_defs,
            "achievements_unlocked": achievements_unlocked,
            "my_courses": my_courses,
        },
    )


@router.get("/courses", response_class=HTMLResponse)
async def courses_page(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.User | None = Depends(get_optional_current_user),
):
    result = await db.execute(select(models.Course).order_by(models.Course.title.asc()))
    courses = result.scalars().all()
    if current_user:
        access_by_id = await course_access_map(current_user, list(courses), db)
    else:
        access_by_id = {course.id: bool(course.is_free) for course in courses}

    return templates.TemplateResponse(
        "courses.html",
        {
            "request": request,
            "user": current_user,
            "courses": courses,
            "access_by_id": access_by_id,
            "telegram_buy_url": TELEGRAM_BUY_URL,
        },
    )


@router.get("/courses/{course_id}/pay", response_class=HTMLResponse)
async def course_pay_page(
    request: Request,
    course_id: UUID = Path(..., description="UUID курса"),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    course = (
        await db.execute(select(models.Course).filter(models.Course.id == course_id))
    ).scalars().first()
    if not course:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Курс не найден")

    if await user_has_course_access(current_user, course, db):
        return RedirectResponse(f"/courses/{course.id}", status_code=status.HTTP_303_SEE_OTHER)

    from urllib.parse import quote
    from core.templating import format_price_rub

    price_text = format_price_rub(course.price)
    buy_text = (
        f"Здравствуйте! Хочу купить курс «{course.title}»"
        + (f" за {price_text}" if price_text else "")
        + f". Мой email: {current_user.email}"
    )
    telegram_url = f"{TELEGRAM_BUY_URL}?text=" + quote(buy_text)

    return templates.TemplateResponse(
        "course_pay.html",
        {
            "request": request,
            "user": current_user,
            "course": course,
            "telegram_url": telegram_url,
        },
    )


@router.get("/courses/{course_id}", response_class=HTMLResponse)
async def course_page(
    request: Request,
    course_id: UUID = Path(..., description="UUID курса"),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    course_probe = (
        await db.execute(select(models.Course).filter(models.Course.id == course_id))
    ).scalars().first()
    if not course_probe:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Курс не найден")

    has_access = await user_has_course_access(current_user, course_probe, db)
    course, lessons, course_completed = await _course_lessons_with_progress(
        course_id, current_user.id, db, include_media=True
    )
    if not has_access:
        course_completed = False
        for lesson in lessons:
            lesson["completed"] = False
            lesson["progress"] = 0

    full_questions = build_assessment_questions(
        course.id, [lesson["title"] for lesson in lessons]
    ) if has_access else []
    assessment_questions = public_assessment_questions(full_questions) if has_access else []
    assessment_total = len(assessment_questions)

    latest_attempt = None
    latest_submission = None
    if has_access:
        latest_attempt = (
            await db.execute(
                select(models.CourseAssessmentAttempt)
                .where(
                    models.CourseAssessmentAttempt.course_id == course_id,
                    models.CourseAssessmentAttempt.user_id == current_user.id,
                )
                .order_by(models.CourseAssessmentAttempt.created_at.desc())
                .limit(1)
            )
        ).scalars().first()

        latest_submission = (
            await db.execute(
                select(models.HomeworkSubmission)
                .where(
                    models.HomeworkSubmission.course_id == course_id,
                    models.HomeworkSubmission.user_id == current_user.id,
                )
                .order_by(models.HomeworkSubmission.created_at.desc())
                .limit(1)
            )
        ).scalars().first()

    return templates.TemplateResponse(
        "course_detail.html",
        {
            "request": request,
            "user": current_user,
            "is_admin": current_user.is_admin,
            "course": course,
            "lessons": lessons,
            "has_access": has_access,
            "payment_url": payment_path(course.id),
            "telegram_buy_url": TELEGRAM_BUY_URL,
            "course_completed": course_completed,
            "assessment_questions": assessment_questions,
            "assessment_payload": assessment_questions,
            "assessment_total": assessment_total,
            "assessment_pass_score": pass_score_for(assessment_total) if assessment_total else 0,
            "latest_attempt": latest_attempt,
            "latest_submission": latest_submission,
        },
    )


@router.get("/user/profile", response_class=HTMLResponse)
async def profile_page(
    request: Request,
    current_user: models.User = Depends(get_current_user),
):
    return templates.TemplateResponse(
        "profile.html", {"request": request, "user": current_user}
    )


@router.get("/lessons/{lesson_id}", response_class=HTMLResponse)
async def lesson_page(
    request: Request,
    lesson_id: UUID = Path(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    lesson, course, text_html = await get_lesson_data(lesson_id, db)

    if not lesson:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Урок не найден")

    course_id = UUID(str(lesson["course_id"]))
    course_obj = (
        await db.execute(select(models.Course).filter(models.Course.id == course_id))
    ).scalars().first()
    if not course_obj:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Курс не найден")

    if not await user_has_course_access(current_user, course_obj, db):
        return RedirectResponse(
            payment_path(course_obj.id),
            status_code=status.HTTP_303_SEE_OTHER,
        )

    course_lessons_result = await db.execute(
        select(models.Lesson)
        .filter(models.Lesson.course_id == course_id)
        .order_by(models.Lesson.title.asc())
    )
    course_lessons = course_lessons_result.scalars().all()
    next_lesson = None
    prev_lesson = None
    lesson_index = None
    for index, item in enumerate(course_lessons):
        if str(item.id) == str(lesson["id"]):
            lesson_index = index
            if index > 0:
                prev_lesson = course_lessons[index - 1]
            if index + 1 < len(course_lessons):
                next_lesson = course_lessons[index + 1]
            break

    completed_ids = {
        row[0]
        for row in (
            await db.execute(
                select(models.LessonCompletion.lesson_id).where(
                    models.LessonCompletion.user_id == current_user.id,
                    models.LessonCompletion.lesson_id.in_([item.id for item in course_lessons]),
                )
            )
        ).fetchall()
    } if course_lessons else set()

    lesson_completed = lesson_id in completed_ids
    course_outline = [
        {
            "id": item.id,
            "title": item.title,
            "is_current": str(item.id) == str(lesson["id"]),
            "completed": item.id in completed_ids,
        }
        for item in course_lessons
    ]
    lessons_total = len(course_lessons)
    lessons_done = len(completed_ids)
    progress_percent = int(round((lessons_done / lessons_total) * 100)) if lessons_total else 0

    note_result = await db.execute(
        select(models.Note).filter_by(
            user_id=current_user.id,
            lesson_id=lesson_id,
        )
    )
    note = note_result.scalars().first()
    note_content = note.content if note else ""

    return templates.TemplateResponse(
        "lesson/lesson_detail.html",
        {
            "request": request,
            "user": current_user,
            "lesson": lesson,
            "lesson_text_html": text_html,
            "course": course,
            "note_content": note_content,
            "prev_lesson": prev_lesson,
            "next_lesson": next_lesson,
            "lesson_position": (lesson_index + 1) if lesson_index is not None else None,
            "course_lessons_total": lessons_total,
            "course_outline": course_outline,
            "lesson_completed": lesson_completed,
            "progress_percent": progress_percent,
            "lessons_done": lessons_done,
        },
    )
