"""Публичные заявки на обратный звонок / консультацию."""

from __future__ import annotations

import logging
import re

from fastapi import APIRouter, BackgroundTasks, Form, HTTPException, Request, status
from pydantic import BaseModel
from redis.exceptions import RedisError

from core.config import settings
from redis_client import redis
from services.email_service import send_email_sync
from services.telegram_service import send_telegram_message
from tasks.email_task import send_email_task

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["Заявки"])

_PHONE_RE = re.compile(r"^[\d\s+\-()]{10,20}$")
_NAME_RE = re.compile(r"^[A-Za-zА-Яа-яЁё\s\-']{2,80}$")


# Защита от спама: форма публичная, каждая заявка уходит в Telegram и на почту.
_IP_LIMIT, _IP_WINDOW = 10, 10 * 60
_PHONE_LIMIT, _PHONE_WINDOW = 3, 60 * 60
_SUCCESS_DETAIL = "Заявка отправлена. Мы свяжемся с вами."


class CallbackResponse(BaseModel):
    detail: str


async def _hit_limit(key: str, limit: int, window: int) -> bool:
    """True, если лимит превышен. При недоступном Redis заявки не блокируем."""
    try:
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, window)
    except RedisError:
        logger.exception("Не удалось проверить лимит заявок")
        return False
    return count > limit


async def _check_callback_rate_limit(request: Request, phone: str) -> None:
    client_ip = request.client.host if request.client else "unknown"
    phone_digits = re.sub(r"\D", "", phone)
    if await _hit_limit(f"callback:ip:{client_ip}", _IP_LIMIT, _IP_WINDOW) or await _hit_limit(
        f"callback:phone:{phone_digits}", _PHONE_LIMIT, _PHONE_WINDOW
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много заявок. Попробуйте позже или напишите нам в Telegram.",
        )


def _leads_notify_email() -> str:
    """Почта для дубля заявок: LEADS_NOTIFY_EMAIL → ADMIN_EMAIL → EMAIL_FROM."""
    for candidate in (
        getattr(settings, "LEADS_NOTIFY_EMAIL", None),
        settings.ADMIN_EMAIL,
        settings.EMAIL_FROM,
    ):
        value = (candidate or "").strip()
        if value:
            return value
    return ""


def _normalize_phone(raw: str) -> str:
    value = " ".join((raw or "").strip().split())
    digits = re.sub(r"\D", "", value)
    if len(digits) < 10 or len(digits) > 15:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Укажите корректный номер телефона",
        )
    if not _PHONE_RE.match(value):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Укажите корректный номер телефона",
        )
    return value


def _normalize_name(raw: str) -> str:
    value = " ".join((raw or "").strip().split())
    if not _NAME_RE.match(value):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Укажите имя (от 2 до 80 символов)",
        )
    return value


def _normalize_comment(raw: str) -> str:
    value = " ".join((raw or "").strip().split())
    if not value:
        return ""
    if len(value) > 300:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Комментарий слишком длинный (до 300 символов)",
        )
    return value


async def _notify_callback_in_background(text: str) -> None:
    """Telegram + email в фоне после ответа клиенту."""
    telegram_ok = False
    try:
        telegram_ok = await send_telegram_message(text, raise_on_fail=False)
    except Exception:
        logger.exception("Фоновая отправка заявки в Telegram не удалась")

    email_to = _leads_notify_email()
    subject = "Заявка на обратную связь — Nailis.hub"
    email_ok = False

    if not email_to:
        logger.warning("Не задан адрес для заявок (LEADS_NOTIFY_EMAIL / ADMIN_EMAIL / EMAIL_FROM)")
    else:
        try:
            send_email_task.apply_async(args=[email_to, subject, text])
            email_ok = True
        except Exception:
            logger.exception("Не удалось поставить email-задачу по заявке, пробуем SMTP напрямую")
            try:
                email_ok = send_email_sync(email_to, subject, text, raise_on_fail=False)
            except Exception:
                logger.exception("Фоновая отправка заявки на email %s не удалась", email_to)

    if not telegram_ok and not email_ok:
        logger.error("Заявка не доставлена ни в Telegram, ни на email: %s", text)


@router.post("/callback", response_model=CallbackResponse)
async def submit_callback(
    request: Request,
    background_tasks: BackgroundTasks,
    name: str = Form(..., max_length=200),
    phone: str = Form(..., max_length=40),
    source: str = Form("", max_length=200),
    course: str = Form("", max_length=300),
    comment: str = Form("", max_length=1000),
    website: str = Form("", max_length=200),
) -> CallbackResponse:
    """Принимает заявку и ставит уведомления в фон."""
    # website — скрытое поле-ловушка: люди его не видят, боты заполняют.
    # Отвечаем как обычно, чтобы бот не понял, что его отсеяли.
    if website.strip():
        logger.info("Заявка отклонена: заполнено поле-ловушка")
        return CallbackResponse(detail=_SUCCESS_DETAIL)

    full_name = _normalize_name(name)
    phone_number = _normalize_phone(phone)
    await _check_callback_rate_limit(request, phone_number)
    source_label = " ".join((source or "").strip().split())[:120]
    course_label = " ".join((course or "").strip().split())[:160]
    comment_text = _normalize_comment(comment)

    lines = [
        "Новая заявка на обратную связь Nailis.hub",
        f"Имя: {full_name}",
        f"Телефон: {phone_number}",
    ]
    if comment_text:
        lines.append(f"Комментарий: {comment_text}")
    if course_label:
        lines.append(f"Курс / тариф: {course_label}")
    if source_label:
        lines.append(f"Источник: {source_label}")
    text = "\n".join(lines)

    background_tasks.add_task(_notify_callback_in_background, text)
    return CallbackResponse(detail=_SUCCESS_DETAIL)
