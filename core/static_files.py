"""StaticFiles с запретом публичной раздачи lesson-видео."""

from __future__ import annotations

import os
import posixpath
import re
from typing import Union

from starlette.datastructures import Headers
from starlette.responses import JSONResponse, Response
from starlette.staticfiles import StaticFiles
from starlette.types import Receive, Scope, Send

from core.config import settings

PathLike = Union[str, "os.PathLike[str]"]


def _static_relative_path(scope: Scope) -> str:
    """
    Возвращает путь внутри /static.
    В зависимости от версии Starlette path может быть:
    - /videos/foo.mp4
    - /static/videos/foo.mp4
    """
    path = scope.get("path") or ""
    if path.startswith("/static/"):
        path = path[len("/static") :]
    elif path == "/static":
        path = "/"
    if not path.startswith("/"):
        path = f"/{path}"
    return path


def _normalized_static_path(scope: Scope) -> str:
    """
    Путь внутри /static после схлопывания //, . и .. — ровно тот файл,
    который в итоге отдаст StaticFiles. Без этого проверка доступа
    обходилась через /static//videos/…, /static/videos/hero/../… и %2e%2e.
    """
    rel = _static_relative_path(scope).replace("\\", "/")
    # normpath по POSIX сохраняет ведущий «//», поэтому слэши схлопываем сами
    normalized = posixpath.normpath(re.sub(r"/+", "/", rel))
    if not normalized.startswith("/"):
        normalized = f"/{normalized}"
    # регистр игнорируем: на case-insensitive ФС /VIDEOS/ — тот же каталог
    return normalized.lower()


_PUBLIC_VIDEO_DIRS = ("/videos/hero/", "/videos/lenta/", "/videos/scroll/")


def _is_forbidden(path: str) -> bool:
    if path == "/videos" or path.startswith("/videos/"):
        return not path.startswith(_PUBLIC_VIDEO_DIRS)
    return path == "/homework" or path.startswith("/homework/")


def _is_dev_uncached_asset(rel: str) -> bool:
    return (
        rel.startswith("/css/")
        or rel.startswith("/js/")
        or rel.endswith(".css")
        or rel.endswith(".js")
    )


class GatedStaticFiles(StaticFiles):
    """
    Публичный /static, но:
    - /static/videos/* закрыт (кроме hero/, lenta/ и scroll/)
    - /static/homework/* закрыт
    """

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            if _is_forbidden(_normalized_static_path(scope)):
                response = JSONResponse({"detail": "Forbidden"}, status_code=403)
                await response(scope, receive, send)
                return
        await super().__call__(scope, receive, send)

    def is_not_modified(
        self, response_headers: Headers, request_headers: Headers
    ) -> bool:
        # В разработке не отдаём 304 — иначе правки css/js не видны
        if settings.ENV != "production":
            return False
        return super().is_not_modified(response_headers, request_headers)

    def file_response(
        self,
        full_path: PathLike,
        stat_result: os.stat_result,
        scope: Scope,
        status_code: int = 200,
    ) -> Response:
        response = super().file_response(
            full_path, stat_result, scope, status_code=status_code
        )
        rel = _static_relative_path(scope)
        if settings.ENV != "production" and _is_dev_uncached_asset(rel):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
            if "etag" in response.headers:
                del response.headers["etag"]
            if "last-modified" in response.headers:
                del response.headers["last-modified"]
        return response
