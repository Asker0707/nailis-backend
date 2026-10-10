"""CSRF: double-submit cookie.

Чистый ASGI-middleware (не BaseHTTPMiddleware), чтобы не ломать body Form().
Принимает X-CSRF-Token или поле csrf_token в form-urlencoded/multipart.
"""

from __future__ import annotations

import logging
import re
import secrets
from urllib.parse import parse_qs

from fastapi import HTTPException, Request, status
from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from core.config import settings

logger = logging.getLogger(__name__)

CSRF_COOKIE = "csrf_token"
CSRF_HEADER = "X-CSRF-Token"
CSRF_FORM_FIELD = "csrf_token"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}


def generate_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def set_csrf_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=CSRF_COOKIE,
        value=token,
        httponly=False,
        max_age=60 * 60 * 24 * 7,
        secure=settings.COOKIE_SECURE,
        samesite=settings.SAMESITE,
        path="/",
    )


def get_request_csrf_token(request: Request) -> str:
    token = getattr(request.state, "csrf_token", None)
    if token:
        return str(token)
    return request.cookies.get(CSRF_COOKIE, "") or ""


def _tokens_match(expected: str, provided: str | None) -> bool:
    if not expected or not provided:
        return False
    return secrets.compare_digest(str(expected), str(provided))


def _cookie_header_value(token: str) -> str:
    secure = "; Secure" if settings.COOKIE_SECURE else ""
    return (
        f"{CSRF_COOKIE}={token}; Path=/; Max-Age={60 * 60 * 24 * 7}; "
        f"SameSite={settings.SAMESITE}{secure}"
    )


# Сколько тела готовы держать в памяти, пока ищем csrf_token в форме.
# csrf.js и шаблоны кладут поле первым, так что в multipart оно приходит
# в первых байтах; urlencoded-формы на сайте маленькие.
_MAX_BUFFERED_BODY = 1024 * 1024


async def _read_until_token(
    receive: Receive, content_type: str
) -> tuple[str | None, list[Message], bool]:
    """
    Читает тело чанками, пока не найдём csrf_token (или не упрёмся в лимит).
    Возвращает (токен, прочитанные сообщения, тело закончилось ли).
    Остаток тела не читаем — его дочитает приложение через passthrough.
    """
    messages: list[Message] = []
    buffer = b""
    is_multipart = "multipart/form-data" in content_type
    while True:
        message = await receive()
        messages.append(message)
        if message["type"] != "http.request":
            return None, messages, True
        buffer += message.get("body", b"")
        finished = not message.get("more_body")
        if is_multipart:
            token = _extract_csrf_from_multipart(buffer, content_type)
            if token:
                return token, messages, finished
        if finished:
            if "application/x-www-form-urlencoded" in content_type:
                return _extract_csrf_from_urlencoded(buffer), messages, True
            return None, messages, True
        if len(buffer) > _MAX_BUFFERED_BODY:
            return None, messages, False


def _replay_receive(messages: list[Message], receive: Receive) -> Receive:
    """Сначала отдаёт уже прочитанные сообщения, потом — живой поток."""
    pending = list(messages)

    async def replay() -> Message:
        if pending:
            return pending.pop(0)
        return await receive()

    return replay


def _extract_csrf_from_urlencoded(body: bytes) -> str | None:
    try:
        parsed = parse_qs(body.decode("utf-8"), keep_blank_values=True)
    except UnicodeDecodeError:
        return None
    values = parsed.get(CSRF_FORM_FIELD) or []
    return values[0] if values else None


def _extract_csrf_from_multipart(body: bytes, content_type: str) -> str | None:
    marker = b'name="csrf_token"'
    idx = body.find(marker)
    if idx < 0:
        return None
    slice_ = body[idx: idx + 500]
    parts = slice_.split(b"\r\n\r\n", 1)
    if len(parts) < 2:
        return None
    value_and_rest = parts[1].split(b"\r\n", 1)
    if len(value_and_rest) < 2:
        # значение ещё не пришло целиком (тело читается чанками)
        return None
    value = value_and_rest[0]
    try:
        return value.decode("utf-8").strip()
    except UnicodeDecodeError:
        return None


class CsrfMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        cookies: dict[str, str] = {}
        cookie_header = headers.get("cookie") or ""
        for part in cookie_header.split(";"):
            if "=" in part:
                key, value = part.strip().split("=", 1)
                cookies[key] = value

        token = cookies.get(CSRF_COOKIE) or generate_csrf_token()
        issued_new = CSRF_COOKIE not in cookies

        state = scope.setdefault("state", {})
        if isinstance(state, dict):
            state["csrf_token"] = token

        method = scope.get("method", "GET").upper()
        receive_to_use = receive

        if method not in SAFE_METHODS:
            provided = headers.get(CSRF_HEADER)
            content_type = (headers.get("content-type") or "").lower()

            if not provided and (
                "application/x-www-form-urlencoded" in content_type
                or "multipart/form-data" in content_type
            ):
                provided, consumed, _ = await _read_until_token(receive, content_type)
                receive_to_use = _replay_receive(consumed, receive)

            if not _tokens_match(token, provided):
                logger.warning("CSRF rejected %s %s", method, scope.get("path"))
                response = JSONResponse(
                    {"detail": "CSRF token missing or invalid"},
                    status_code=status.HTTP_403_FORBIDDEN,
                )
                await response(scope, receive_to_use, send)
                return

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start" and issued_new:
                mutable = MutableHeaders(scope=message)
                mutable.append("set-cookie", _cookie_header_value(token))
            await send(message)

        await self.app(scope, receive_to_use, send_wrapper)


async def require_csrf(request: Request) -> None:
    token = get_request_csrf_token(request)
    provided = request.headers.get(CSRF_HEADER)
    if not _tokens_match(token, provided):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF token missing or invalid",
        )
