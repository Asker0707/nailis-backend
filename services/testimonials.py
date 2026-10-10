"""Переписки с ученицами для блока отзывов на главной (content/testimonials.json).

Каждая запись — отдельный чат. Записи с "sample": true — демо для проверки
дизайна, в продакшене не показываются, чтобы на сайт не попали выдуманные отзывы.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from core.config import settings

logger = logging.getLogger(__name__)

_PATH = Path(settings.BASE_DIR) / "content" / "testimonials.json"
_cache: dict[str, object] = {"mtime": None, "items": []}


def _clean(value: object, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _static_path(value: object) -> str:
    """Только локальные файлы из /static — внешние ссылки в отзывах не нужны."""
    path = _clean(value, 300)
    return path if path.startswith("/static/") and ".." not in path else ""


def _messages(entry: dict) -> list[dict]:
    messages = []
    for msg in entry.get("messages") or []:
        if not isinstance(msg, dict):
            continue
        text = _clean(msg.get("text"), 1500)
        image = _static_path(msg.get("image"))
        if not text and not image:
            continue
        messages.append({
            "from": "teacher" if msg.get("from") == "teacher" else "student",
            "text": text,
            "image": image,
            "alt": _clean(msg.get("alt"), 200),
            "time": _clean(msg.get("time"), 5),
            "edited": bool(msg.get("edited")),
        })
    # старый формат: одно сообщение text + ответ reply
    if not messages and entry.get("text"):
        base = {"image": "", "alt": "", "edited": False}
        messages.append({**base, "from": "student", "text": _clean(entry["text"], 1500), "time": _clean(entry.get("time"), 5)})
        if entry.get("reply"):
            messages.append({**base, "from": "teacher", "text": _clean(entry["reply"], 1500), "time": ""})
    return messages


def _load() -> list[dict]:
    try:
        mtime = _PATH.stat().st_mtime
    except OSError:
        return []
    if _cache["mtime"] == mtime:
        return _cache["items"]  # type: ignore[return-value]
    try:
        raw = json.loads(_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        logger.exception("Не удалось прочитать %s", _PATH)
        return []
    items = []
    for entry in raw.get("items", []):
        if not isinstance(entry, dict):
            continue
        name = _clean(entry.get("name"), 60)
        messages = _messages(entry)
        if not name or not messages:
            continue
        last = messages[-1]
        items.append({
            "sample": bool(entry.get("sample")),
            "name": name,
            "course": _clean(entry.get("course"), 30),
            "avatar": _static_path(entry.get("avatar")),
            "original": _static_path(entry.get("original")),
            "original_thumb": _static_path(entry.get("original_thumb")) or _static_path(entry.get("original")),
            "messages": messages,
            "preview": last["text"] or "📷 Фото",
            "preview_from_teacher": last["from"] == "teacher",
            "time": next((m["time"] for m in reversed(messages) if m["time"]), ""),
        })
    _cache.update(mtime=mtime, items=items)
    return items


def list_testimonials(include_samples: bool) -> list[dict]:
    """Переписки для показа. Демо (sample) — только если include_samples."""
    return [item for item in _load() if include_samples or not item["sample"]]
