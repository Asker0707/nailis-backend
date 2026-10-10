"""
Сервис отправки сообщений в Telegram через Bot API.
"""

import logging

import httpx

from core.config import settings

logger = logging.getLogger(__name__)


async def send_telegram_message(text: str, raise_on_fail: bool = True) -> bool:
    """
    Отправляет текстовое сообщение в административный Telegram-чат.
    """
    bot_token = (settings.TELEGRAM_BOT_TOKEN or "").strip()
    chat_id = (settings.TELEGRAM_CHAT_ID or "").strip()

    if not bot_token or not chat_id:
        message = "Telegram settings are not configured"
        if raise_on_fail:
            raise RuntimeError(message)
        logger.warning(message)
        return False

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": True,  # ссылки из заявок не разворачиваем в превью
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
        return True
    except Exception:
        logger.exception("Ошибка при отправке сообщения в Telegram")
        if raise_on_fail:
            raise
        return False
