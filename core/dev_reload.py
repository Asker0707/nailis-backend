"""Временный live-reload и cache-bust для правок главной."""

from __future__ import annotations

import time
from pathlib import Path

from core.config import settings

WATCH_PATHS = (
    "templates/index.html",
    "templates/base.html",
    "static/css/index-page.css",
    "static/css/home-scroll.css",
    "static/css/base.css",
    "static/css/app.css",
    "static/js/index-page.js",
    "static/css/home-motion.css",
    "static/css/home-tariffs.css",
    "static/css/home-reviews.css",
    "static/js/home-motion.js",
    "static/js/home-scroll.js",
)


def _file_mtime(rel_path: str) -> int:
    path = Path(settings.BASE_DIR) / rel_path
    try:
        return int(path.stat().st_mtime)
    except OSError:
        return 0


def watched_assets_version() -> str:
    """Максимальный mtime отслеживаемых файлов — меняется при любом сохранении."""
    latest = max((_file_mtime(path) for path in WATCH_PATHS), default=0)
    return str(latest or int(time.time()))
