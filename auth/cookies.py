"""
Модуль для работы с cookie в FastAPI.

Функции:
- set_auth_cookie: Устанавливает JWT токен в cookie для аутентификации
- clear_auth_cookie: Удаляет cookie аутентификации
- create_flash_error_redirect: Создает редирект с flash-сообщением об ошибке
- set_refresh_cookie: Устанавливает refresh токен в cookie на длительный срок
- clear_refresh_cookie: Удаляет cookie refresh токена

Используется в маршрутах аутентификации для управления сессиями и отображением ошибок.
"""

import logging
from urllib.parse import quote

from fastapi.responses import RedirectResponse
from core.config import settings

logger = logging.getLogger(__name__)
FLASH_ERROR_EXPIRE_SECONDS = 300


def set_auth_cookie(response: RedirectResponse, token: str) -> RedirectResponse:
    """
    Устанавливает JWT токен в cookie для аутентификации пользователя.

    Args:
        response (RedirectResponse): HTTP ответ с редиректом.
        token (str): JWT токен для аутентификации.

    Returns:
        RedirectResponse: Обновленный ответ с установленной cookie.
    """
    try:
        response.set_cookie(
            key="access_token",
            value=token,
            httponly=True,
            max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            expires=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            secure=settings.COOKIE_SECURE,
            samesite=settings.SAMESITE,
            path="/",
        )
        logger.debug("Установлен cookie access_token для аутентификации.")
    except Exception as e:
        logger.error("Ошибка при установке cookie access_token: %s", e)
    return response


def clear_auth_cookie(response: RedirectResponse) -> RedirectResponse:
    """
    Очищает cookie аутентификации (удаляет access_token).

    Args:
        response (RedirectResponse): HTTP ответ с редиректом.

    Returns:
        RedirectResponse: Обновленный ответ с удаленной cookie.
    """
    try:
        response.delete_cookie(
            key="access_token",
            path="/",
            secure=settings.COOKIE_SECURE,
            samesite=settings.SAMESITE,
        )
        logger.debug("Удален cookie access_token.")
    except Exception as e:
        logger.error("Ошибка при удалении cookie access_token: %s", e)
    return response


def create_flash_error_redirect(url: str, message: str) -> RedirectResponse:
    """
    Создает RedirectResponse с flash-сообщением об ошибке в cookie.
    """
    try:
        response = RedirectResponse(url=url, status_code=303)
        response.set_cookie(
            key="flash_error",
            value=quote(message),
            max_age=FLASH_ERROR_EXPIRE_SECONDS,
            httponly=False,
            secure=settings.COOKIE_SECURE,
            samesite=settings.SAMESITE,
            path="/",
        )
        logger.debug("Установлено flash-сообщение в cookie: %s", message)
    except Exception as e:
        logger.error("Ошибка при установке flash-сообщения в cookie: %s", e)
        response = RedirectResponse(url=url, status_code=303)
    return response


def create_flash_success_redirect(url: str, message: str) -> RedirectResponse:
    """Редирект с flash-сообщением об успехе (читается toast.js)."""
    try:
        response = RedirectResponse(url=url, status_code=303)
        response.set_cookie(
            key="flash_success",
            value=quote(message),
            max_age=FLASH_ERROR_EXPIRE_SECONDS,
            httponly=False,
            secure=settings.COOKIE_SECURE,
            samesite=settings.SAMESITE,
            path="/",
        )
    except Exception as e:
        logger.error("Ошибка при установке flash_success: %s", e)
        response = RedirectResponse(url=url, status_code=303)
    return response


def set_refresh_cookie(response: RedirectResponse, token: str) -> RedirectResponse:
    """
    Устанавливает refresh токен в cookie на длительный срок (по умолчанию 30 дней).

    Args:
        response (RedirectResponse): HTTP ответ с редиректом.
        token (str): JWT refresh токен.

    Returns:
        RedirectResponse: Обновленный ответ с установленной refresh cookie.
    """
    try:
        response.set_cookie(
            key="refresh_token",
            value=token,
            httponly=True,
            max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
            expires=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
            secure=settings.COOKIE_SECURE,
            samesite=settings.SAMESITE,
            path="/",
        )
        logger.debug("Установлен refresh_token в cookie на %s дней.",
                     settings.REFRESH_TOKEN_EXPIRE_DAYS)
    except Exception as e:
        logger.error("Ошибка при установке cookie refresh_token: %s", e)
    return response


def clear_refresh_cookie(response: RedirectResponse) -> RedirectResponse:
    """
    Удаляет refresh_token из cookie.

    Args:
        response (RedirectResponse): HTTP ответ с редиректом.

    Returns:
        RedirectResponse: Обновленный ответ с удаленной refresh cookie.
    """
    try:
        response.delete_cookie(
            key="refresh_token",
            path="/",
            secure=settings.COOKIE_SECURE,
            samesite=settings.SAMESITE,
        )
        logger.debug("Удален cookie refresh_token.")
    except Exception as e:
        logger.error("Ошибка при удалении cookie refresh_token: %s", e)
    return response
