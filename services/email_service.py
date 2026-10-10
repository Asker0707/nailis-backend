"""
Сервис для синхронной отправки email и логирования в базу данных.
"""

import smtplib
import logging
from email.message import EmailMessage
from core.config import settings
from db.sync_database import SessionLocal
from db.models import EmailLog

logger = logging.getLogger(__name__)


def send_email_sync(to: str, subject: str, body: str, raise_on_fail: bool = True) -> bool:
    """
    Отправляет email синхронно через SMTP и логирует результат.

    Args:
        to (str): Email получателя.
        subject (str): Тема письма.
        body (str): Текст письма.
    """
    sent = False
    try:
        # Формируем сообщение
        msg = EmailMessage()
        msg["From"] = settings.EMAIL_FROM
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body)

        # Отправка через SMTP
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            if settings.SMTP_TLS:
                server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.send_message(msg)
        sent = True

    except Exception as e:
        logger.exception("Ошибка при отправке email на %s: %s", to, e)
        err = str(e)
        if "parol prilozheniya" in err.lower() or "application password" in err.lower():
            logger.error(
                "Mail.ru требует пароль приложения в SMTP_PASSWORD "
                "(не обычный пароль аккаунта): "
                "https://help.mail.ru/mail/security/protection/external"
            )

    # Логируем результат в базу
    log_email(to, subject, body, sent)
    if raise_on_fail and not sent:
        raise RuntimeError(f"Email send failed for {to}")
    return sent


def log_email(to: str, subject: str, body: str, sent: bool):
    """
    Сохраняет информацию об отправленном email в базу данных.

    Args:
        to (str): Email получателя.
        subject (str): Тема письма.
        body (str): Текст письма.
        sent (bool): Успешно ли отправлено письмо.
    """
    try:
        with SessionLocal() as session:
            email_log = EmailLog(
                recipient=to,
                subject=subject,
                body=body,
                sent=sent
            )
            session.add(email_log)
            session.commit()
    except Exception as e:
        logger.exception("Не удалось сохранить лог письма: %s", e)
