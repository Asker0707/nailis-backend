"""
Модуль аутентификации пользователей.

Обеспечивает:
- Проверку учетных данных пользователя
- Создание JWT токенов и установку cookie для сессий
- Основной поток логина с обработкой исключений и редиректом
- Вспомогательные функции для проверки прав администратора
- Вспомогательные исключения для управления редиректом

Улучшения:
- Унификация логирования всех попыток входа
- Централизованное создание RedirectResponse с токенами
- Чистый, переиспользуемый код для всех видов аутентификации
"""

import logging

from fastapi import HTTPException, status
from fastapi.responses import RedirectResponse
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from auth.cookies import (
    create_flash_error_redirect,
    set_auth_cookie,
    set_refresh_cookie
)
from auth.security import (
    create_access_token,
    create_refresh_token,
    verify_password
)
from db import models

logger = logging.getLogger(__name__)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class AuthRedirectException(HTTPException):
    """
    Исключение для редиректа неаутентифицированных пользователей.
    Используется для управления потоком при недостаточной аутентификации.
    """

    def __init__(
        self,
        redirect_url: str,
        status_code: int = status.HTTP_303_SEE_OTHER,
    ):
        super().__init__(
            status_code=status_code,
            detail="Требуется аутентификация",
        )
        self.redirect_url = redirect_url


async def authenticate_user(
    email: str,
    password: str,
    db: AsyncSession,
    require_admin: bool = False
) -> models.User:
    """
    Аутентифицирует пользователя по email и паролю.
    Опционально проверяет права администратора.
    """
    normalized_email = email.lower().strip()
    result = await db.execute(select(models.User).where(models.User.email == normalized_email))
    user = result.scalars().first()

    if not user or not verify_password(password, str(user.hashed_password)):
        logger.warning("Неудачная попытка входа для email: %s",
                       normalized_email)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверные учетные данные"
        )

    if not user.is_active:
        logger.warning("Попытка входа в деактивированный аккаунт: %s", normalized_email)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Аккаунт деактивирован",
        )

    if require_admin and not (user.is_admin or user.role == models.UserRole.admin):
        logger.warning(
            "Пользователь %s попытался зайти в админку без прав", normalized_email)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="У вас нет доступа к админке"
        )

    logger.info("Пользователь %s успешно аутентифицирован", normalized_email)
    return user


def create_auth_response(user: models.User, redirect_url: str) -> RedirectResponse:
    """
    Формирует RedirectResponse с JWT токенами в cookie.

    Args:
        user (models.User): Аутентифицированный пользователь.
        redirect_url (str): URL для редиректа после входа.

    Returns:
        RedirectResponse: Редирект с установленными токенами.
    """
    access_token = create_access_token({"sub": user.email})
    refresh_token = create_refresh_token({"sub": user.email})

    response = RedirectResponse(
        url=redirect_url, status_code=status.HTTP_303_SEE_OTHER)
    response = set_auth_cookie(response, access_token)
    response = set_refresh_cookie(response, refresh_token)
    return response


async def authenticate_and_check_admin(
    email: str,
    password: str,
    db: AsyncSession,
    require_admin: bool = False
) -> models.User:
    """
    Аутентифицирует пользователя и проверяет права администратора при необходимости.

    Args:
        email (str): Email пользователя.
        password (str): Пароль пользователя.
        db (AsyncSession): Асинхронная сессия базы данных.
        require_admin (bool): Требовать права администратора.

    Raises:
        HTTPException: Если аутентификация или проверка прав не удалась.

    Returns:
        models.User: Аутентифицированный пользователь.
    """
    return await authenticate_user(email=email, password=password, db=db, require_admin=require_admin)


async def common_login_flow(
    username: str,
    password: str,
    db: AsyncSession,
    redirect_url: str,
    require_admin: bool = False,
) -> RedirectResponse:
    """
    Основной поток логина: аутентификация и
    формирование RedirectResponse с токенами.
    Обрабатывает исключения и создает flash-сообщения при ошибках.

    Args:
        username (str): Email пользователя.
        password (str): Пароль пользователя.
        db (AsyncSession): Асинхронная сессия базы данных.
        redirect_url (str): URL редиректа при успешной аутентификации.
        require_admin (bool): Требовать права администратора.

    Returns:
        RedirectResponse: Редирект с токенами или flash-сообщением об ошибке.
    """
    try:
        user = await authenticate_and_check_admin(
            username,
            password,
            db,
            require_admin
        )
        return create_auth_response(user, redirect_url)
    except HTTPException as e:
        logger.warning("Ошибка аутентификации пользователя %s: %s",
                       username, e.detail, exc_info=True)
        if e.status_code == 403:
            return create_flash_error_redirect("/auth/login",
                                               "У вас нет доступа к админке")
        return create_flash_error_redirect("/auth/login",
                                           "Неверный email или пароль")
    except Exception as e:
        logger.error("Неожиданная ошибка при входе пользователя %s: %s",
                     username, e, exc_info=True)
        return create_flash_error_redirect("/auth/login",
                                           "Произошла ошибка при входе")
