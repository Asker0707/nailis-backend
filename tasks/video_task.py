import os
import subprocess
import logging
import asyncio
from uuid import UUID
from db.database import async_session_factory
from db import models
from services.lesson_service import invalidate_lesson_cache
from celery_app import celery

from core.config import settings

BASE_DIR = getattr(settings, "BASE_DIR", os.getcwd())
VIDEO_DIR = os.path.join(BASE_DIR, "static", "videos")
THUMB_DIR = os.path.join(BASE_DIR, "static", "images", "video_thumbs")

logger = logging.getLogger(__name__)


def _run_ffmpeg(input_path: str, output_path: str, scale: int, crf: int = 23):
    """Transcode to H.264 MP4 with faststart for streaming."""
    cmd = [
        "ffmpeg", "-y", "-i", input_path,
        "-vf", f"scale=-2:{scale}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1",
        "-map", "0:v:0",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", str(crf),
        "-pix_fmt", "yuv420p",
        "-metadata:s:v:0", "rotate=0",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        output_path,
    ]
    result = subprocess.run(cmd, check=False, capture_output=True, text=True)
    if result.returncode != 0:
        logger.error(
            "ffmpeg failed for %s -> %s (code=%s): %s",
            input_path,
            output_path,
            result.returncode,
            (result.stderr or "").strip()[-1200:],
        )
        raise subprocess.CalledProcessError(
            result.returncode, cmd, output=result.stdout, stderr=result.stderr
        )


def _run_thumbnail(input_path: str, output_path: str) -> bool:
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    cmd = [
        "ffmpeg", "-y", "-ss", "1", "-i", input_path,
        "-vframes", "1",
        "-vf", "scale=720:-2:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
        output_path,
    ]
    result = subprocess.run(cmd, check=False, capture_output=True, text=True)
    if result.returncode != 0:
        logger.warning(
            "thumbnail failed for %s: %s",
            input_path,
            (result.stderr or "").strip()[-600:],
        )
        return False
    return os.path.exists(output_path) and os.path.getsize(output_path) > 0


async def _save_to_db(
    lesson_id: UUID,
    url_720: str,
    url_1080: str,
    thumb_url: str | None = None,
) -> bool:
    async with async_session_factory() as session:
        lesson = await session.get(models.Lesson, lesson_id)
        if not lesson:
            logger.warning("Lesson %s not found while saving converted video", lesson_id)
            return False

        lesson.video_path_720 = url_720
        lesson.video_path_1080 = url_1080
        if thumb_url:
            lesson.thumbnail_path = thumb_url
        session.add(lesson)
        await session.commit()

        await invalidate_lesson_cache(lesson_id)
        return True


@celery.task(
    bind=True,
    name="tasks.video_task.process_video_task",
    autoretry_for=(subprocess.CalledProcessError, OSError, RuntimeError),
    retry_backoff=True,
    retry_jitter=True,
    max_retries=3,
)
def process_video_task(self, lesson_id: str, input_path: str, base_name: str):
    """
    Always produce optimized 720p + 1080p MP4 variants (including when source is already mp4),
    plus a JPEG thumbnail for posters/previews.
    """
    os.makedirs(VIDEO_DIR, exist_ok=True)
    os.makedirs(THUMB_DIR, exist_ok=True)

    if not os.path.exists(input_path):
        logger.warning("Input video not found, skip task: %s", input_path)
        return {"skipped": True, "reason": "input_not_found"}

    out_720 = os.path.join(VIDEO_DIR, f"{base_name}_720p.mp4")
    out_1080 = os.path.join(VIDEO_DIR, f"{base_name}_1080p.mp4")
    out_thumb = os.path.join(THUMB_DIR, f"{base_name}.jpg")

    try:
        # 720p for lesson playback / course card previews (lighter)
        _run_ffmpeg(input_path, out_720, 720, crf=23)
        # 1080p for high-quality playback
        _run_ffmpeg(input_path, out_1080, 1080, crf=21)

        thumb_ok = _run_thumbnail(input_path, out_thumb)

        url_720 = f"static/videos/{base_name}_720p.mp4"
        url_1080 = f"static/videos/{base_name}_1080p.mp4"
        thumb_url = f"static/images/video_thumbs/{base_name}.jpg" if thumb_ok else None

        saved = asyncio.run(_save_to_db(UUID(lesson_id), url_720, url_1080, thumb_url))
        if not saved:
            for path in (out_720, out_1080, out_thumb, input_path):
                if path and os.path.exists(path):
                    os.remove(path)
            return {"skipped": True, "reason": "lesson_not_found"}

        # Remove original upload after successful transcode (avoids serving huge camera files)
        if os.path.exists(input_path):
            # Don't delete if somehow input is one of the outputs
            if os.path.abspath(input_path) not in {
                os.path.abspath(out_720),
                os.path.abspath(out_1080),
            }:
                os.remove(input_path)

        return {"720": out_720, "1080": out_1080, "thumb": out_thumb if thumb_ok else None}
    except Exception:
        for path in (out_720, out_1080, out_thumb):
            try:
                if os.path.exists(path):
                    os.remove(path)
            except OSError:
                logger.warning("Failed to remove partial output: %s", path)
        raise
