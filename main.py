"""
Основной модуль FastAPI приложения для онлайн-платформы по маникюру.

Содержит конфигурацию приложения, обработчики маршрутов
и подключение всех компонентов:
- Настройка FastAPI приложения с шаблонами Jinja2
- Подключение статических файлов
- Обработчики исключений
- Главная страница
- Подключенные роутеры:
  * frontend - фронтенд маршруты
  * notes - работа с заметками
  * user_profile - профили пользователей
  * lessons - управление уроками
  * course_admin - админка курсов
  * lesson_admin - админка уроков
  * auth.routes - маршруты аутентификации
  * media - защищённые видео уроков
  * assessment - тест и ДЗ
"""

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from prometheus_fastapi_instrumentator import Instrumentator

from auth import routes
from auth.cookies import create_flash_error_redirect
from auth.csrf import CsrfMiddleware
from auth.dependencies import get_optional_current_user
from auth.utils import AuthRedirectException
from core.config import settings
from core.dev_reload import watched_assets_version
from core.static_files import GatedStaticFiles
from core.templating import CsrfTemplates
from logging_config import setup_logging
from routers import assessment, frontend, leads, lessons, notes, user_profile
from routers import media as media_router
from routers.admin import course_admin, lesson_admin, students_admin
from services.course_access import INSTAGRAM_URL, TELEGRAM_BUY_URL
from services.lenta_service import list_lenta_clips
from services.testimonials import list_testimonials


templates = CsrfTemplates(directory="templates")
setup_logging()

# Live-reload вкладки и отключение кэша — только для локальной разработки.
# В проде каждый посетитель иначе опрашивал бы сервер раз в 800 мс.
IS_DEV = settings.ENV != "production"


app = FastAPI(
    title="Онлайн платформа по маникюру",
)

app.add_middleware(CsrfMiddleware)

instrumentator = Instrumentator(
    should_group_status_codes=True,
    should_ignore_untemplated=True
)
instrumentator.instrument(app).expose(app)

app.mount("/static", GatedStaticFiles(directory="static"), name="static")


@app.middleware("http")
async def disable_dev_cache(request: Request, call_next):
    """В разработке отключает браузерный кэш HTML/CSS/JS при правках главной."""
    response = await call_next(request)
    if not IS_DEV:
        return response
    path = request.url.path
    if (
        path == "/"
        or path.endswith(".html")
        or path.startswith("/static/css/")
        or path.startswith("/static/js/")
    ):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


def _friendly_validation_message(errors: list) -> str:
    fields = []
    for err in errors:
        loc = err.get("loc") or ()
        name = str(loc[-1]) if loc else ""
        if name in {"full_name", "username"}:
            fields.append("имя" if name == "full_name" else "email")
        elif name == "email":
            fields.append("email")
        elif name == "password":
            fields.append("пароль")
    if "email" in fields and "пароль" in fields:
        return "Проверьте email и пароль"
    if "email" in fields:
        return "Проверьте email"
    if "пароль" in fields:
        return "Проверьте пароль"
    if "имя" in fields:
        return "Укажите имя"
    return "Проверьте введённые данные и попробуйте снова"


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Для HTML-форм auth/admin — flash на ту же страницу, не сырой JSON."""
    path = request.url.path
    content_type = (request.headers.get("content-type") or "").lower()
    is_form = (
        "application/x-www-form-urlencoded" in content_type
        or "multipart/form-data" in content_type
    )
    if request.method == "POST" and is_form and (
        path.startswith("/auth/") or path.startswith("/admin/")
    ):
        message = _friendly_validation_message(exc.errors())
        redirect_to = path
        if path == "/auth/login" or path.endswith("/login"):
            redirect_to = "/auth/login"
        elif path == "/auth/register" or path.endswith("/register"):
            redirect_to = "/auth/register"
        elif path == "/auth/admin_login":
            redirect_to = "/"
        return create_flash_error_redirect(redirect_to, message)

    return JSONResponse(status_code=422, content={"detail": exc.errors()})


@app.exception_handler(AuthRedirectException)
async def auth_redirect_exception_handler(request: Request, exc: AuthRedirectException):
    """Обработчик для перенаправления при ошибках аутентификации"""
    return RedirectResponse(url=exc.redirect_url, status_code=exc.status_code)



@app.get("/", response_class=HTMLResponse)
async def read_root(
    request: Request,
    current_user=Depends(get_optional_current_user),
):
    """
    Главная страница приложения.
    """
    asset_v = watched_assets_version()
    testimonials = list_testimonials(include_samples=IS_DEV)
    return templates.TemplateResponse(
        "index.html",
        {
            "testimonials": testimonials,
            "testimonials_demo": any(item["sample"] for item in testimonials),
            "request": request,
            "user": current_user,
            "csrf_token": getattr(request.state, "csrf_token", ""),
            "hero_clips": list_lenta_clips(),
            "asset_v": asset_v,
            "dev_live_reload": IS_DEV,
            "telegram_url": TELEGRAM_BUY_URL,
            "instagram_url": INSTAGRAM_URL,
        }
    )


@app.get("/privacy", response_class=HTMLResponse)
async def privacy_page(
    request: Request,
    current_user=Depends(get_optional_current_user),
):
    """Политика обработки персональных данных."""
    return templates.TemplateResponse(
        "legal/privacy.html",
        {
            "request": request,
            "user": current_user,
            "asset_v": watched_assets_version(),
        },
    )


@app.get("/offer", response_class=HTMLResponse)
async def offer_page(
    request: Request,
    current_user=Depends(get_optional_current_user),
):
    """Публичная оферта."""
    return templates.TemplateResponse(
        "legal/offer.html",
        {
            "request": request,
            "user": current_user,
            "asset_v": watched_assets_version(),
        },
    )


@app.get("/__dev__/reload-version", include_in_schema=False)
async def dev_reload_version():
    """Версия файлов главной для автообновления вкладки (только в разработке)."""
    if not IS_DEV:
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    return JSONResponse(
        {"v": watched_assets_version()},
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


app.include_router(frontend.router)
app.include_router(notes.router)
app.include_router(user_profile.router)
app.include_router(lessons.router)
app.include_router(assessment.router)
app.include_router(leads.router)
app.include_router(media_router.router)
app.include_router(course_admin.router)
app.include_router(lesson_admin.router)
app.include_router(students_admin.router)
app.include_router(routes.router)
