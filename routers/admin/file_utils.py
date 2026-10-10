"""
Утилиты для работы с файлами:
- безопасное имя
- асинхронная потоковая запись UploadFile с лимитом размера
- создание директории
- удаление файла по URL или FS-пути
"""

from __future__ import annotations

import asyncio
import os
import re

import aiofiles
from fastapi import HTTPException, UploadFile, status

try:
    from core.config import settings
    BASE_DIR = getattr(settings, "BASE_DIR", os.getcwd())
except Exception:
    BASE_DIR = os.getcwd()

CHUNK_SIZE = 1024 * 1024


def safe_filename(name: str) -> str:
    """Очистка имени файла от опасных символов."""
    if not name:
        return "file"
    name = os.path.basename(name)
    name = re.sub(r"[^\w\-.() ]+", "", name)
    name = name.strip().replace(" ", "_")
    if len(name) > 200:
        base, ext = os.path.splitext(name)
        name = base[:180] + ext
    return name or "file"


def resolve_fs_path(path_or_url: str) -> str:
    """Преобразует URL/относительный путь в абсолютный FS-путь внутри BASE_DIR."""
    if not path_or_url:
        return ""
    normalized = str(path_or_url).strip()
    if os.path.isabs(normalized) and not normalized.startswith("/static"):
        return normalized
    normalized = normalized.lstrip("/")
    return os.path.join(BASE_DIR, normalized)


async def save_upload_file_streaming(
    upload_file: UploadFile,
    destination: str,
    max_bytes: int | None = None,
) -> int:
    """Асинхронная запись файла чанками. Возвращает число записанных байт."""
    dirpath = os.path.dirname(destination)
    await create_dir(dirpath)

    written = 0
    try:
        async with aiofiles.open(destination, "wb") as out:
            while True:
                chunk = await upload_file.read(CHUNK_SIZE)
                if not chunk:
                    break
                written += len(chunk)
                if max_bytes is not None and written > max_bytes:
                    await out.close()
                    try:
                        await asyncio.to_thread(os.remove, destination)
                    except OSError:
                        pass
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"Файл превышает лимит {max_bytes // (1024 * 1024)} МБ",
                    )
                await out.write(chunk)
    finally:
        await upload_file.close()

    return written


async def create_dir(path: str) -> None:
    await asyncio.to_thread(os.makedirs, path, exist_ok=True)


async def delete_file_async(path_or_url: str) -> bool:
    """
    Удаляет файл по абсолютному пути или по URL (/static/videos/...).
    """
    if not path_or_url:
        return False

    fs_path = resolve_fs_path(path_or_url)
    if not fs_path or not os.path.exists(fs_path):
        return False

    try:
        await asyncio.to_thread(os.remove, fs_path)
        return True
    except Exception:
        return False
