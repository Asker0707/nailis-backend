from pydantic import BaseModel
from typing import List


class LastLessonItem(BaseModel):
    title: str
    date: str


class BadgeItem(BaseModel):
    name: str
    icon: str


class ProfileDataResponse(BaseModel):
    full_name: str | None = None
    email: str
    progress_percent: float
    completed_lessons: int
    total_lessons: int
    last_lessons: List[LastLessonItem]
    badges: List[BadgeItem] = []
    avatar_url: str | None = None
    bio: str | None = None
    telegram: str | None = None
    notes_count: int = 0
    joined_at: str | None = None


class ProfileUpdateResponse(BaseModel):
    detail: str
