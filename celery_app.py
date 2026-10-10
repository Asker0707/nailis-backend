from celery import Celery
from kombu import Queue

from core.config import settings


celery = Celery(
    "nailis_hub",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["tasks.email_task", "tasks.video_task"],
)

celery.conf.update(
    task_default_queue="default",
    task_queues=(
        Queue("default"),
        Queue("emails"),
        Queue("videos"),
    ),
    task_routes={
        "tasks.email_task.send_email_task": {"queue": "emails"},
        "tasks.video_task.process_video_task": {"queue": "videos"},
    },
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
)
