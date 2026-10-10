"""
Модуль моделей базы данных приложения.

Содержит SQLAlchemy модели для работы с базой данных:
- Пользователи системы (User)
- Курсы (Course)
- Уроки (Lesson)
- Доступы пользователей к курсам (UserCourseAccess)
- Завершения уроков (LessonCompletion)
- Заметки пользователей (Note)
- Попытки финального теста по курсу (CourseAssessmentAttempt)
- Сдачи домашних работ (HomeworkSubmission)
"""

import enum
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, String, Text, UniqueConstraint, Index, Integer
from sqlalchemy.dialects.postgresql import UUID
try:
    from sqlalchemy.orm import Mapped, mapped_column, relationship, validates
except ImportError:  # SQLAlchemy < 2.0
    from sqlalchemy.orm import relationship, validates
    Mapped = Any  # type: ignore
    mapped_column = Column  # type: ignore

from db.database import Base


class UserRole(str, enum.Enum):
    """Роли пользователей в системе."""

    student = "student"
    admin = "admin"


class User(Base):
    """Модель пользователя системы."""
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(
        String, unique=True, index=True, nullable=False
    )
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    full_name: Mapped[Optional[str]] = mapped_column(String)
    avatar_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    bio: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    telegram: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole), default=UserRole.student
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    @validates("role")
    def _sync_is_admin_from_role(self, key: str, value: UserRole) -> UserRole:
        self.__dict__["is_admin"] = value == UserRole.admin
        return value

    @validates("is_admin")
    def _sync_role_from_is_admin(self, key: str, value: bool) -> bool:
        self.__dict__["role"] = UserRole.admin if value else UserRole.student
        return value


class Course(Base):
    """Модель курса."""
    __tablename__ = "courses"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    is_free: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    price: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cover_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    lessons: Mapped[list["Lesson"]] = relationship(
        "Lesson", back_populates="course", cascade="all, delete-orphan"
    )
    access_grants: Mapped[list["UserCourseAccess"]] = relationship(
        "UserCourseAccess",
        back_populates="course",
        cascade="all, delete-orphan",
    )


class UserCourseAccess(Base):
    """Ручной доступ пользователя к платному курсу."""
    __tablename__ = "user_course_access"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    granted_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    note: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])
    course: Mapped["Course"] = relationship("Course", back_populates="access_grants")
    granted_by: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[granted_by_id]
    )

    __table_args__ = (
        UniqueConstraint("user_id", "course_id", name="uix_user_course_access"),
    )


class Lesson(Base):
    """Модель урока."""
    __tablename__ = "lessons"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id"), index=True
    )
    title: Mapped[str] = mapped_column(String, nullable=False)
    video_path_720: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    video_path_1080: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    thumbnail_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    text_content: Mapped[Optional[str]] = mapped_column(Text)

    course: Mapped["Course"] = relationship("Course", back_populates="lessons")



class LessonCompletion(Base):
    """Модель завершения урока пользователем."""
    __tablename__ = "lesson_completions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    lesson_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lessons.id"))
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"))
    completed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        UniqueConstraint("user_id", "lesson_id", name="uix_user_lesson"),
    )

class Note(Base):
    """Модель заметки пользователя к уроку."""
    __tablename__ = "notes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    lesson_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lessons.id"), nullable=False)
    content: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    user: Mapped["User"] = relationship("User")
    lesson: Mapped["Lesson"] = relationship("Lesson")

    __table_args__ = (
        Index("ix_notes_user_lesson", "user_id", "lesson_id"),
    )
    
    
class EmailLog(Base):
    """Модель логирования отправленных email-сообщений."""
    __tablename__ = "email_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    recipient: Mapped[str] = mapped_column(String, index=True, nullable=False)
    subject: Mapped[str] = mapped_column(String, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    sent: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class CourseAssessmentAttempt(Base):
    """Попытка прохождения финального теста по курсу."""
    __tablename__ = "course_assessment_attempts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_questions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    answers_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        Index("ix_course_assessment_attempts_course_user", "course_id", "user_id"),
    )


class HomeworkSubmission(Base):
    """Сдача домашней работы пользователем по курсу."""
    __tablename__ = "homework_submissions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    resource_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    submission_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    delivery_channel: Mapped[str] = mapped_column(String(32), nullable=False, default="email")
    delivery_status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        Index("ix_homework_submissions_course_user", "course_id", "user_id"),
    )
