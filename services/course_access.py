"""Проверка и управление доступом пользователей к курсам."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from db import models

TELEGRAM_BUY_URL = "https://t.me/Dyshekova_Olesia"
INSTAGRAM_URL = "https://www.instagram.com/nailis.hub/"


def payment_path(course_id: UUID) -> str:
    return f"/courses/{course_id}/pay"


def is_admin_user(user: models.User) -> bool:
    return bool(getattr(user, "is_admin", False) or getattr(user, "role", None) == models.UserRole.admin)


async def user_has_course_access(
    user: models.User,
    course: models.Course,
    db: AsyncSession,
) -> bool:
    if is_admin_user(user):
        return True
    if bool(getattr(course, "is_free", False)):
        return True
    granted = await db.scalar(
        select(
            exists().where(
                models.UserCourseAccess.user_id == user.id,
                models.UserCourseAccess.course_id == course.id,
            )
        )
    )
    return bool(granted)


async def course_access_map(
    user: models.User,
    courses: list[models.Course],
    db: AsyncSession,
) -> dict[UUID, bool]:
    if not courses:
        return {}
    if is_admin_user(user):
        return {course.id: True for course in courses}

    free_ids = {course.id for course in courses if course.is_free}
    course_ids = [course.id for course in courses]
    granted_rows = await db.execute(
        select(models.UserCourseAccess.course_id).where(
            models.UserCourseAccess.user_id == user.id,
            models.UserCourseAccess.course_id.in_(course_ids),
        )
    )
    granted_ids = {row[0] for row in granted_rows.fetchall()}
    return {
        course.id: (course.id in free_ids or course.id in granted_ids)
        for course in courses
    }


async def grant_course_access(
    db: AsyncSession,
    *,
    user_id: UUID,
    course_id: UUID,
    granted_by_id: UUID | None = None,
    note: str | None = None,
) -> models.UserCourseAccess:
    existing = (
        await db.execute(
            select(models.UserCourseAccess).where(
                models.UserCourseAccess.user_id == user_id,
                models.UserCourseAccess.course_id == course_id,
            )
        )
    ).scalars().first()
    if existing:
        return existing

    grant = models.UserCourseAccess(
        user_id=user_id,
        course_id=course_id,
        granted_by_id=granted_by_id,
        note=(note or None),
    )
    db.add(grant)
    await db.commit()
    await db.refresh(grant)
    return grant


async def revoke_course_access(
    db: AsyncSession,
    *,
    user_id: UUID,
    course_id: UUID,
) -> bool:
    result = await db.execute(
        delete(models.UserCourseAccess).where(
            models.UserCourseAccess.user_id == user_id,
            models.UserCourseAccess.course_id == course_id,
        )
    )
    await db.commit()
    return bool(result.rowcount)


async def require_course_access(
    user: models.User,
    course: models.Course,
    db: AsyncSession,
) -> bool:
    return await user_has_course_access(user, course, db)


async def get_course_for_lesson(
    lesson_id: UUID,
    db: AsyncSession,
) -> tuple[models.Lesson | None, models.Course | None]:
    lesson = (
        await db.execute(select(models.Lesson).where(models.Lesson.id == lesson_id))
    ).scalars().first()
    if not lesson:
        return None, None
    course = (
        await db.execute(select(models.Course).where(models.Course.id == lesson.course_id))
    ).scalars().first()
    return lesson, course
