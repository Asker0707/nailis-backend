from uuid import UUID

from pydantic import BaseModel


class LessonResponse(BaseModel):
    id: UUID
    title: str
    video_path_720: str | None = None
    video_path_1080: str | None = None
    text_content: str | None = None

    model_config = {"from_attributes": True}
