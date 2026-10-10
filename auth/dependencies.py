"""
Модуль зависимостей FastAPI для аутентификации и проверки прав администратора.

Содержит:
- get_current_user: Получение текущего пользователя из JWT токена, хранящегося в cookie
- require_admin: Проверка прав администратора

Используется в маршрутах для ограничения доступа к защищённым ресурсам.
"""

import logging

from fastapi import Cookie, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.utils import AuthRedirectException
from db import models
from db.database import get_db
from .security import decode_token

logger = logging.getLogger(__name__)


def _wants_html_redirect(request: Request) -> bool:
    """HTML-страницы → редирект на логин; JSON/API → 401."""
    accept = (request.headers.get("accept") or "").lower()
    if "application/json" in accept and "text/html" not in accept:
        return False
    if request.headers.get("x-requested-with", "").lower() == "xmlhttprequest":
        return False
    path = request.url.path
    if path.startswith("/api/") or path.startswith("/media/"):
        return False
    return True


def _unauthorized(request: Request) -> None:
    if _wants_html_redirect(request):
        raise AuthRedirectException("/auth/login")
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Не авторизован",
    )


async def get_current_user(
    request: Request,
    access_token: str | None = Cookie(default=None, alias="access_token"),
    db: AsyncSession = Depends(get_db),
    raise_exc: bool = True,
) -> models.User | None:
    """
    Получить текущего аутентифицированного пользователя из JWT токена в cookie.

    Использует кеширование в request.state для повторного доступа без
    запроса к базе данных.
    """
    if hasattr(request.state, "current_user") and isinstance(request.state.current_user, models.User):
        logger.debug("Текущий пользователь уже загружен в request.state")
        return request.state.current_user

    if not access_token:
        logger.info("JWT токен (access_token) отсутствует в cookie.")
        if raise_exc:
            _unauthorized(request)
        return None

    email = await decode_token(
        access_token, raise_exc=False, expected_token_type="access"
    )
    if not email:
        logger.warning("Не удалось декодировать access token")
        if raise_exc:
            _unauthorized(request)
        return None

    result = await db.execute(select(models.User).where(models.User.email == email))
    user = result.scalars().first()

    if not user:
        logger.warning(
            "Пользователь с email %s не найден в базе данных.", email)
        if raise_exc:
            _unauthorized(request)
        return None

    if not user.is_active:
        logger.warning("Неактивный пользователь %s пытается получить доступ", email)
        if raise_exc:
            if _wants_html_redirect(request):
                raise AuthRedirectException("/auth/login")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Аккаунт деактивирован",
            )
        return None

    request.state.current_user = user
    logger.debug("Текущий пользователь успешно загружен: %s", email)
    return user


async def get_optional_current_user(
    request: Request,
    access_token: str | None = Cookie(default=None, alias="access_token"),
    db: AsyncSession = Depends(get_db),
) -> models.User | None:
    """Получить текущего пользователя без редиректа при отсутствии авторизации."""
    return await get_current_user(
        request=request,
        access_token=access_token,
        db=db,
        raise_exc=False,
    )


async def require_admin(
    current_user: models.User = Depends(get_current_user)
) -> models.User:
    """
    Проверяет, является ли текущий пользователь администратором.
    """
    is_admin = current_user.is_admin or current_user.role == models.UserRole.admin
    if not is_admin:
        logger.warning(
            "Пользователь %s пытается получить доступ без прав администратора.", current_user.email)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Требуются права администратора"
        )

    logger.debug("Пользователь %s имеет права администратора.",
                 current_user.email)
    return current_user
