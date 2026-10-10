from celery_app import celery
from services.email_service import send_email_sync


@celery.task(
    bind=True,
    name="tasks.email_task.send_email_task",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_jitter=True,
    max_retries=3,
)
def send_email_task(self, to: str, subject: str, body: str):
    """
    Синхронная Celery задача для отправки email.
    """
    send_email_sync(to, subject, body)
