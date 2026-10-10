"""Админка: список учеников и управление доступом к курсам."""

from uuid import UUID

from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import require_admin
from core.templating import CsrfTemplates
from db import models
from db.database import get_db
from services.course_access import grant_course_access, revoke_course_access

router = APIRouter(prefix="/admin/students", tags=["Админ: ученики"])
templates = CsrfTemplates(directory="templates")


@router.get("/", response_class=HTMLResponse)
async def students_list_page(
    request: Request,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """Полный список учеников сразу; поиск фильтрует на странице."""
    students = list(
        (
            await db.execute(
                select(models.User)
                .where(
                    models.User.is_admin.is_(False),
                    models.User.role != models.UserRole.admin,
                )
                .order_by(models.User.created_at.desc())
            )
        )
        .scalars()
        .all()
    )

    access_counts: dict[UUID, int] = {}
    if students:
        rows = await db.execute(
            select(
                models.UserCourseAccess.user_id,
                func.count(models.UserCourseAccess.id),
            )
            .where(models.UserCourseAccess.user_id.in_([s.id for s in students]))
            .group_by(models.UserCourseAccess.user_id)
        )
        access_counts = {row[0]: int(row[1]) for row in rows.fetchall()}

    return templates.TemplateResponse(
        "admin/students_list.html",
        {
            "request": request,
            "user": current_user,
            "students": students,
            "access_counts": access_counts,
            "q": (q or "").strip(),
        },
    )


@router.get("/{student_id}", response_class=HTMLResponse)
async def student_detail_page(
    student_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    student = (
        await db.execute(select(models.User).where(models.User.id == student_id))
    ).scalars().first()
    if not student or student.is_admin:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Ученик не найден")

    courses = (
        await db.execute(select(models.Course).order_by(models.Course.title.asc()))
    ).scalars().all()
    grants = (
        await db.execute(
            select(models.UserCourseAccess).where(
                models.UserCourseAccess.user_id == student.id
            )
        )
    ).scalars().all()
    granted_ids = {g.course_id for g in grants}
    grant_by_course = {g.course_id: g for g in grants}

    return templates.TemplateResponse(
        "admin/student_detail.html",
        {
            "request": request,
            "user": current_user,
            "student": student,
            "courses": courses,
            "granted_ids": granted_ids,
            "grant_by_course": grant_by_course,
        },
    )


@router.post("/{student_id}/access/grant")
async def grant_access_form(
    student_id: UUID,
    course_id: UUID = Form(...),
    note: str = Form(""),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    student = (
        await db.execute(select(models.User).where(models.User.id == student_id))
    ).scalars().first()
    if not student or student.is_admin:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Ученик не найден")

    course = (
        await db.execute(select(models.Course).where(models.Course.id == course_id))
    ).scalars().first()
    if not course:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Курс не найден")

    await grant_course_access(
        db,
        user_id=student.id,
        course_id=course.id,
        granted_by_id=current_user.id,
        note=(note or "").strip() or None,
    )
    return RedirectResponse(
        f"/admin/students/{student_id}",
        status_code=status.HTTP_303_SEE_OTHER,
    )


@router.post("/{student_id}/access/revoke")
async def revoke_access_form(
    student_id: UUID,
    course_id: UUID = Form(...),
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    student = (
        await db.execute(select(models.User).where(models.User.id == student_id))
    ).scalars().first()
    if not student or student.is_admin:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Ученик не найден")

    await revoke_course_access(db, user_id=student.id, course_id=course_id)
    return RedirectResponse(
        f"/admin/students/{student_id}",
        status_code=status.HTTP_303_SEE_OTHER,
    )
