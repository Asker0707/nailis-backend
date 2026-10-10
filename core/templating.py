"""Общий Jinja2 helper с CSRF в контексте шаблона."""

from __future__ import annotations

from fastapi.templating import Jinja2Templates

from auth.csrf import get_request_csrf_token


def format_price_rub(value) -> str:
    """Форматирует цену: 15000 → «15 000 ₽»."""
    if value is None or value == "":
        return ""
    try:
        amount = int(value)
    except (TypeError, ValueError):
        return ""
    if amount < 0:
        return ""
    grouped = f"{amount:,}".replace(",", "\u00a0")
    return f"{grouped} ₽"


DEFAULT_COURSE_COVER = "/static/images/nail-polish-bottle.png"


def format_course_cover(value) -> str:
    """URL обложки курса или дефолтная картинка."""
    if not value:
        return DEFAULT_COURSE_COVER
    normalized = str(value).strip().lstrip("/")
    return f"/{normalized}" if normalized else DEFAULT_COURSE_COVER


class CsrfTemplates(Jinja2Templates):
    """Добавляет csrf_token в context для шаблонов вида (name, {request: ...})."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Временно: сразу подхватывать правки templates/*.html без перезапуска
        self.env.auto_reload = True
        self.env.cache = None
        self.env.filters["rub"] = format_price_rub
        self.env.filters["course_cover"] = format_course_cover

    def TemplateResponse(self, name: str, context: dict, **kwargs):  # noqa: N802
        request = context.get("request")
        if request is not None and "csrf_token" not in context:
            context = {
                **context,
                "csrf_token": get_request_csrf_token(request),
            }
        response = super().TemplateResponse(name, context, **kwargs)
        # Временно: не давать браузеру кешировать HTML
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response
