"""
Модуль для работы с уроками и их кешированием (оптимизированный).

Функции:
- fetch_lesson_from_db  — получение урока + сбор video_sources (HLS, 1080p, 720p, original)
- get_lesson_data        — чтение + кэширование (Redis)
- cache_lesson_data      — запись в Redis
- invalidate_lesson_cache- удаление ключей кеша для всех качеств
- is_lesson_completed    — проверка статуса завершения (с кешем)
- mark_lesson_completed  — пометка как завершённый + инвалидация

Технические улучшения:
- дедупликация логики выбора источников
- неблокирующий рендер markdown (run_in_executor)
- корректная работа с байтовыми ответами Redis
- инвалидация всех ключей качества при изменениях
"""

import json
import logging
import asyncio
import functools
from typing import OrderedDict, Tuple, Optional, Dict, Any, List
from uuid import UUID

import markdown
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import joinedload

from core.config import settings
from db import models
from redis_client import redis

logger = logging.getLogger(__name__)

CACHE_VERSION = "v2"
CACHE_LESSON_EXPIRE_SECONDS = int(getattr(settings, "LESSON_CACHE_TTL", 300))
CACHE_COMPLETION_EXPIRE_SECONDS = int(getattr(settings, "COMPLETION_CACHE_TTL", 300))

# qualities we maintain in cache / UI
SUPPORTED_QUALITIES = ("1080p", "720p", "original")
DEFAULT_QUALITY = "720p"


def lesson_media_url(lesson_id: UUID | str, quality: str) -> str:
    q = _normalize_quality(quality)
    if q == "original":
        q = "720p"
    return f"/media/lessons/{lesson_id}/{q}"


def _normalize_quality(q: str) -> str:
    """Нормализует вход (720, '720p', 'original', 'orig', '1080') -> '720p'|'1080p'|'original'"""
    if not q:
        return DEFAULT_QUALITY
    q = str(q).lower()
    if q in ("1080", "1080p"):
        return "1080p"
    if q in ("720", "720p"):
        return "720p"
    if q in ("orig", "original"):
        return "original"
    return DEFAULT_QUALITY


def get_lesson_cache_key(lesson_id: UUID, video_quality: str = DEFAULT_QUALITY) -> str:
    q = _normalize_quality(video_quality)
    return f"{CACHE_VERSION}:lesson:{lesson_id}:q{q}"


def get_completion_cache_key(user_id: UUID, lesson_id: UUID) -> str:
    return f"{CACHE_VERSION}:user:{user_id}:lesson:{lesson_id}:completed"


async def _render_markdown_async(md_text: str) -> str:
    """
    Рендер markdown в отдельном executor, чтобы не блокировать event loop.
    """
    if not md_text:
        return ""
    loop = asyncio.get_running_loop()
    func = functools.partial(markdown.markdown, md_text)
    try:
        return await loop.run_in_executor(None, func)
    except Exception as e:
        logger.warning("Markdown render failed: %s", e)
        return md_text


async def fetch_lesson_from_db(
    lesson_id: UUID, db: AsyncSession, default_quality: str = DEFAULT_QUALITY
) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]], Optional[str]]:
    """
    Загружает урок из БД и формирует структуру lesson + course + text_html.

    Возвращает (lesson_dict | None, course_dict | None, text_html | None)
    lesson_dict содержит: id, title, text_content, video_url, video_sources, course_id
    """
    try:
        stmt = (
            select(models.Lesson)
            .options(joinedload(models.Lesson.course))
            .filter(models.Lesson.id == lesson_id)
        )
        result = await db.execute(stmt)
        lesson_obj = result.scalars().first()
    except Exception as e:
        logger.exception("DB error fetching lesson %s: %s", lesson_id, e)
        return None, None, None

    if not lesson_obj:
        logger.info("Lesson %s not found", lesson_id)
        return None, None, None

    # Собираем источники в упорядоченный словарь
    video_sources: "OrderedDict[str, str]" = OrderedDict()

    # candidate fields ordered by quality → auth-gated media URLs
    candidates = [
        ("1080p", "video_path_1080"),
        ("720p", "video_path_720"),
    ]

    for label, attr in candidates:
        try:
            path = getattr(lesson_obj, attr, None)
            if path:
                video_sources[label] = lesson_media_url(lesson_obj.id, label)
        except Exception:
            logger.debug("Skipped attribute %s for lesson %s", attr, lesson_id)
            continue

    logger.info("Lesson %s: video sources found: %s", lesson_id, list(video_sources.keys()))

    # determine selected video_url (requested quality, else first available)
    video_url = None
    if video_sources:
        q = _normalize_quality(default_quality)
        video_url = video_sources.get(q) or next(iter(video_sources.values()))
    else:
        for label, attr in candidates:
            if getattr(lesson_obj, attr, None):
                video_url = lesson_media_url(lesson_obj.id, label)
                break

    lesson = {
        "id": str(lesson_obj.id),
        "title": lesson_obj.title,
        "text_content": lesson_obj.text_content or "",
        "video_url": video_url,
        "video_sources": dict(video_sources),
        "course_id": str(lesson_obj.course_id),
    }

    course = None
    try:
        if getattr(lesson_obj, "course", None):
            course = {"id": str(lesson_obj.course.id), "title": lesson_obj.course.title}
    except Exception:
        course = {"id": str(lesson_obj.course_id), "title": ""}

    # render markdown in executor
    try:
        text_html = await _render_markdown_async(lesson["text_content"])
    except Exception as e:
        logger.warning("Markdown render error for lesson %s: %s", lesson_id, e)
        text_html = lesson["text_content"]

    return lesson, course, text_html


async def cache_lesson_data(cache_key: str, lesson: Dict[str, Any], course: Dict[str, Any], text_html: str) -> None:
    """
    Записывает сериализованный payload в Redis.
    """
    try:
        payload = {"lesson": lesson, "course": course, "text_html": text_html}
        payload_s = json.dumps(payload, ensure_ascii=False)
        logger.debug("Saving lesson cache %s", cache_key)
        await redis.setex(cache_key, CACHE_LESSON_EXPIRE_SECONDS, payload_s)
    except Exception as e:
        logger.warning("Redis write failed for %s: %s", cache_key, e)


async def get_lesson_data(
    lesson_id: UUID, db: AsyncSession, video_quality: str = DEFAULT_QUALITY
) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]], Optional[str]]:
    """
    Читает из кеша, иначе из БД; при успешном получении — записывает в кеш.
    """
    cache_key = get_lesson_cache_key(lesson_id, video_quality)

    try:
        cached = await redis.get(cache_key)
        if cached:
            # redis returns bytes; decode before json.loads
            try:
                if isinstance(cached, (bytes, bytearray)):
                    cached = cached.decode("utf-8")
                data = json.loads(cached)
                if isinstance(data, dict) and "lesson" in data:
                    logger.info("Loaded lesson %s from cache %s", lesson_id, cache_key)
                    return data["lesson"], data["course"], data["text_html"]
                else:
                    logger.warning("Unexpected cache shape for %s", cache_key)
            except Exception as e:
                logger.warning("Failed to parse lesson cache %s: %s", cache_key, e)
    except Exception as e:
        logger.warning("Redis get failed for %s: %s", cache_key, e)

    lesson, course, text_html = await fetch_lesson_from_db(lesson_id, db, video_quality)
    if lesson:
        await cache_lesson_data(cache_key, lesson, course, text_html)
    return lesson, course, text_html


async def invalidate_lesson_cache(lesson_id: UUID) -> None:
    """
    Инвалидация кеша для всех известных качеств + HLS ключа.
    """
    keys: List[str] = []
    for q in SUPPORTED_QUALITIES:
        keys.append(get_lesson_cache_key(lesson_id, q))
    # also alias keys for non-p '720' etc (be defensive)
    keys.extend([get_lesson_cache_key(lesson_id, "720"), get_lesson_cache_key(lesson_id, "1080")])
    # HLS key variants (just in case someone cached by 'HLS' key)
    keys.append(f"{CACHE_VERSION}:lesson:{lesson_id}:qHLS")
    # try to delete all
    try:
        # redis.delete may accept multiple args
        await redis.delete(*keys)
        logger.info("Invalidated lesson cache keys for %s: %s", lesson_id, keys)
    except Exception as e:
        logger.warning("Failed to invalidate cache for lesson %s: %s", lesson_id, e)


async def is_lesson_completed(lesson_id: UUID, user_id: UUID, db: AsyncSession) -> bool:
    cache_key = get_completion_cache_key(user_id, lesson_id)
    try:
        cached_status = await redis.get(cache_key)
        if cached_status is not None:
            try:
                if isinstance(cached_status, (bytes, bytearray)):
                    cached_status = cached_status.decode("utf-8")
                logger.debug("Completion cache hit %s -> %s", cache_key, cached_status)
                return cached_status == "true"
            except Exception:
                logger.exception("Failed to decode completion cache %s", cache_key)
    except Exception:
        logger.exception("Redis error reading completion cache %s", cache_key)

    # DB fallback
    try:
        stmt = select(models.LessonCompletion).filter_by(user_id=user_id, lesson_id=lesson_id)
        result = await db.execute(stmt)
        completed = result.scalars().first() is not None
    except Exception:
        logger.exception("DB error checking completion for %s user %s", lesson_id, user_id)
        completed = False

    try:
        await redis.setex(cache_key, CACHE_COMPLETION_EXPIRE_SECONDS, "true" if completed else "false")
    except Exception:
        logger.exception("Redis error writing completion cache %s", cache_key)

    return completed


async def mark_lesson_completed(lesson_id: UUID, user_id: UUID, db: AsyncSession) -> Optional[bool]:
    """
    Помечает урок как завершённый. Возвращает:
    - None если урок не найден
    - False если уже был помечен
    - True если успешно создана запись completion
    """
    try:
        stmt = select(models.Lesson).filter(models.Lesson.id == lesson_id)
        result = await db.execute(stmt)
        lesson = result.scalars().first()
    except Exception:
        logger.exception("DB error fetching lesson for completion %s", lesson_id)
        return None

    if not lesson:
        return None

    try:
        stmt = select(models.LessonCompletion).filter_by(user_id=user_id, lesson_id=lesson_id)
        result = await db.execute(stmt)
        existing = result.scalars().first()
    except Exception:
        logger.exception("DB error checking existing completion %s %s", lesson_id, user_id)
        existing = None

    if existing:
        return False

    try:
        completion = models.LessonCompletion(lesson_id=lesson_id, user_id=user_id)
        db.add(completion)
        await db.commit()
    except Exception:
        logger.exception("DB error creating completion %s %s", lesson_id, user_id)
        return False

    cache_key = get_completion_cache_key(user_id, lesson_id)
    try:
        await redis.setex(cache_key, CACHE_COMPLETION_EXPIRE_SECONDS, "true")
    except Exception:
        logger.exception("Redis error writing completion cache %s", cache_key)

    # инвалидация кеша урока (все качества)
    try:
        await invalidate_lesson_cache(lesson_id)
    except Exception:
        logger.exception("Failed to invalidate lesson cache after completion %s", lesson_id)

    return True
