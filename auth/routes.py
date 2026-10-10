"""
Модуль аутентификации FastAPI.

Обеспечивает:
- Регистрацию новых пользователей через веб-форму
- Аутентификацию пользователей (обычных и администраторов)
- Выход из системы
- Обновление access и refresh токенов
- Отображение страниц входа/регистрации с flash-сообщениями
- Обработку ошибок аутентификации

Основные улучшения:
- Унифицированная обработка flash-сообщений
- Вынесенные функции для рендеринга шаблонов и генерации RedirectResponse с токенами
- Расширенное логирование ошибок и неудачных попыток входа
- Централизованное создание и обновление токенов
"""

import logging
from urllib.parse import unquote

from fastapi import APIRouter, Depends, Form, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import SQLAlchemyError

from auth.cookies import (
    clear_auth_cookie,
    clear_refresh_cookie,
    create_flash_error_redirect,
    set_auth_cookie,
    set_refresh_cookie
)
from auth.security import (
    add_to_blacklist,
    decode_token,
    get_password_hash,
    is_token_blacklisted,
    create_access_token,
    create_refresh_token,
    check_login_rate_limit,
    register_failed_login,
    clear_failed_logins,
)
from auth.utils import common_login_flow
from core.config import settings
from core.templating import CsrfTemplates
from db import models
from db.database import get_db
from tasks.email_task import send_email_task
# from tasks.telegram_task import send_telegram_message_task

router = APIRouter(prefix="/auth", tags=["Аутентификация"])
templates = CsrfTemplates(directory="templates")
logger = logging.getLogger(__name__)


MIN_PASSWORD_LENGTH = getattr(settings, "MIN_PASSWORD_LENGTH", 8)


def _validate_password(password: str) -> str | None:
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Пароль должен быть не короче {MIN_PASSWORD_LENGTH} символов"
    return None


def render_template_with_flash(
    request: Request,
    template_name: str,
    context: dict | None = None,
) -> HTMLResponse:
    """Рендерит шаблон Jinja2 и извлекает flash_error из cookie."""
    flash_error = request.cookies.get("flash_error")
    if flash_error:
        flash_error = unquote(flash_error)
    template_context = context.copy() if context else {}
    template_context.update({
        "request": request,
        "flash_error": flash_error,
        "csrf_token": getattr(request.state, "csrf_token", "") or request.cookies.get("csrf_token", ""),
    })
    response = templates.TemplateResponse(template_name, template_context)
    if flash_error:
        response.delete_cookie("flash_error")
    return response


async def perform_logout(request: Request) -> RedirectResponse:
    """
    Выход пользователя из системы:
    - Добавляет access и refresh токены в черный список
    - Очищает cookie access_token и refresh_token
    """
    access_token = request.cookies.get("access_token")
    if access_token and not await is_token_blacklisted(access_token):
        await add_to_blacklist(access_token)
        logger.info("Access token добавлен в черный список при logout")

    refresh_token = request.cookies.get("refresh_token")
    if refresh_token and not await is_token_blacklisted(refresh_token):
        await add_to_blacklist(refresh_token)
        logger.info("Refresh token добавлен в черный список при logout")

    response = RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)
    response = clear_auth_cookie(response)
    response = clear_refresh_cookie(response)
    return response


def create_auth_response(user: models.User, redirect_url: str) -> RedirectResponse:
    """
    Создает RedirectResponse с установкой access и refresh токенов для пользователя.

    Args:
        user (models.User): Пользователь, которому выдаются токены.
        redirect_url (str): URL для редиректа после аутентификации.

    Returns:
        RedirectResponse: Редирект с установленными cookie токенами.
    """
    access_token = create_access_token({"sub": user.email})
    refresh_token = create_refresh_token({"sub": user.email})

    response = RedirectResponse(
        url=redirect_url, status_code=status.HTTP_303_SEE_OTHER)
    response = set_auth_cookie(response, access_token)
    response = set_refresh_cookie(response, refresh_token)
    return response


async def refresh_user_tokens(user: models.User, redirect_url: str = "/courses") -> RedirectResponse:
    """
    Создает новые access и refresh токены для пользователя и возвращает RedirectResponse.

    Args:
        user (models.User): Пользователь.
        redirect_url (str): URL для редиректа.

    Returns:
        RedirectResponse: Редирект с новыми токенами.
    """
    return create_auth_response(user, redirect_url)



@router.post("/register")
async def register_form(
    request: Request,
    full_name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    privacy_consent: str | None = Form(None),
    offer_consent: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """
    Обрабатывает POST-запрос регистрации нового пользователя.

    Args:
        request (Request): Объект HTTP запроса.
        full_name (str): Полное имя пользователя из формы.
        email (str): Email пользователя из формы.
        password (str): Пароль пользователя из формы.
        privacy_consent (str | None): Согласие с политикой ПДн.
        offer_consent (str | None): Согласие с публичной офертой.
        db (AsyncSession): Асинхронная сессия базы данных.

    Returns:
        RedirectResponse: Редирект на страницу курсов при успешной регистрации,
                          или редирект на страницу регистрации с flash-сообщением об ошибке.
    """
    if privacy_consent != "1":
        return create_flash_error_redirect(
            "/auth/register",
            "Нужно согласие на обработку персональных данных",
        )
    if offer_consent != "1":
        return create_flash_error_redirect(
            "/auth/register",
            "Нужно принять условия публичной оферты",
        )

    normalized_email = email.lower().strip()
    full_name_clean = full_name.strip()
    if not full_name_clean:
        return create_flash_error_redirect("/auth/register", "Укажите имя")

    if "@" not in normalized_email or "." not in normalized_email.split("@")[-1]:
        return create_flash_error_redirect("/auth/register", "Проверьте email")

    password_error = _validate_password(password)
    if password_error:
        return create_flash_error_redirect("/auth/register", password_error)

    user_exists = await db.scalar(select(exists().where(models.User.email == normalized_email)))
    if user_exists:
        logger.warning(
            "Попытка регистрации с уже существующим email: %s", normalized_email)
        return create_flash_error_redirect("/auth/register", "Email уже зарегистрирован")

    new_user = models.User(
        email=normalized_email,
        full_name=" ".join(word.capitalize()
                           for word in full_name_clean.split()),
        hashed_password=get_password_hash(password)
    )

    try:
        db.add(new_user)
        await db.commit()
        await db.refresh(new_user)
        logger.info("Новый пользователь зарегистрирован: %s", normalized_email)
    except SQLAlchemyError:
        await db.rollback()
        logger.exception(
            "Ошибка при создании пользователя %s", normalized_email)
        return create_flash_error_redirect("/auth/register", "Ошибка при регистрации пользователя")

    try:
        send_email_task.apply_async(
            args=[
                normalized_email,
                "Добро пожаловать в Nailis Hub",
                f"Привет, {new_user.full_name}!\n\nСпасибо за регистрацию на Nailis Hub.",
            ],
            queue="emails",
        )
    except Exception:
        logger.exception(
            "Пользователь %s создан, но задача отправки email не поставлена",
            normalized_email,
        )

    return create_auth_response(new_user, "/courses")


@router.get("/register", response_class=HTMLResponse)
async def register_page(request: Request):
    """
    Отображает страницу регистрации с возможностью flash-сообщений.

    Args:
        request (Request): Объект HTTP запроса.

    Returns:
        TemplateResponse: HTML страница регистрации.
    """
    return render_template_with_flash(request, "register.html")



@router.post("/login")
async def login_api(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """
    Обрабатывает POST-запрос логина обычного пользователя.
    """
    normalized = username.lower().strip()
    try:
        await check_login_rate_limit(normalized)
        response = await common_login_flow(
            username=normalized,
            password=password,
            db=db,
            redirect_url="/courses",
        )
        if response.headers.get("location") == "/courses":
            await clear_failed_logins(normalized)
        else:
            await register_failed_login(normalized)
        return response
    except Exception as e:
        if getattr(e, "status_code", None) == 429:
            return create_flash_error_redirect(
                "/auth/login",
                getattr(e, "detail", "Слишком много попыток входа"),
            )
        await register_failed_login(normalized)
        logger.warning(
            "Неудачная попытка входа для пользователя: %s", normalized, exc_info=True)
        return create_flash_error_redirect("/auth/login", "Неверный email или пароль")


@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    """
    Отображает страницу логина с возможностью flash-сообщений.
    """
    return render_template_with_flash(request, "login.html")


@router.get("/forgot-password", response_class=HTMLResponse)
async def forgot_password_page(request: Request):
    """Страница помощи при забытом пароле (Telegram + ссылка в профиль)."""
    from urllib.parse import quote

    from services.course_access import TELEGRAM_BUY_URL

    help_text = quote(
        "Здравствуйте! Не могу войти в Nailis.hub, нужна помощь со сбросом пароля."
    )
    return render_template_with_flash(
        request,
        "forgot_password.html",
        {"telegram_url": f"{TELEGRAM_BUY_URL}?text={help_text}"},
    )


@router.post("/admin_login")
async def admin_login_api(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """
    Обрабатывает POST-запрос логина администратора.
    """
    normalized = username.lower().strip()
    try:
        await check_login_rate_limit(normalized)
        response = await common_login_flow(
            username=normalized,
            password=password,
            db=db,
            redirect_url="/admin/courses",
            require_admin=True
        )
        if str(response.headers.get("location", "")).startswith("/admin"):
            await clear_failed_logins(normalized)
            logger.info("Администратор успешно вошел: %s", normalized)
        else:
            await register_failed_login(normalized)
        return response
    except Exception as e:
        if getattr(e, "status_code", None) == 429:
            return create_flash_error_redirect(
                "/",
                getattr(e, "detail", "Слишком много попыток входа"),
            )
        await register_failed_login(normalized)
        error_msg = "Неверный email или пароль"
        if getattr(e, "status_code", None) == 403:
            error_msg = "Нет доступа к админке"
        logger.warning("Неудачная попытка входа администратора %s: %s",
                       normalized, error_msg, exc_info=True)
        return create_flash_error_redirect("/", error_msg)



@router.post("/logout")
async def logout(request: Request) -> RedirectResponse:
    """
    Выход пользователя: удаление cookie и редирект на главную страницу.

    Args:
        request (Request): Объект HTTP запроса.

    Returns:
        RedirectResponse: Редирект после успешного выхода.
    """
    return await perform_logout(request)


@router.post("/refresh")
async def refresh_token(
    request: Request,
    db: AsyncSession = Depends(get_db)
) -> RedirectResponse:
    """
    Обновление JWT токенов пользователя через refresh_token cookie.

    Args:
        request (Request): Объект HTTP запроса.
        db (AsyncSession): Асинхронная сессия базы данных.

    Returns:
        RedirectResponse: Редирект на главную или целевую страницу,
                          либо flash-сообщение при ошибке обновления токена.
    """
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        logger.warning("Попытка обновления токена без refresh token")
        return create_flash_error_redirect("/auth/login", "Отсутствует refresh token")

    email = await decode_token(
        refresh_token,
        raise_exc=False,
        expected_token_type="refresh",
    )
    if not email:
        logger.warning("Некорректный refresh token")
        return create_flash_error_redirect("/auth/login", "Некорректный refresh token")

    result = await db.execute(select(models.User).where(models.User.email == email))
    user = result.scalars().first()
    if not user:
        logger.warning("Пользователь не найден для refresh token: %s", email)
        return create_flash_error_redirect("/auth/login", "Пользователь не найден")

    if not user.is_active:
        await add_to_blacklist(refresh_token)
        return create_flash_error_redirect("/auth/login", "Аккаунт деактивирован")

    await add_to_blacklist(refresh_token)
    return await refresh_user_tokens(user)
