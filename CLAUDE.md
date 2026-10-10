# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Nailis Hub — a Russian-language manicure course platform (FastAPI + Jinja2 server-rendered pages, async SQLAlchemy/PostgreSQL, Redis, Celery/RabbitMQ). UI text, docstrings and comments are in Russian; match that.

## Commands

Everything is designed to run under Docker Compose (the `web` service is exposed on http://localhost:8001; Postgres on host port 5433).

```bash
cp .env.example .env            # Settings has many required fields; the app won't import without them
docker compose up --build       # web, db, redis, rabbitmq, celery_main/email/videos, flower
docker compose exec web python create_admin.py   # uses ADMIN_EMAIL / ADMIN_PASSWORD from .env
docker compose exec web poetry run alembic upgrade head
docker compose exec web poetry run alembic revision --autogenerate -m "msg"
docker compose --profile monitoring up   # adds prometheus + grafana
```

`entrypoint.sh` dispatches on its first arg (`web`, `celery_main`, `celery_email`, `celery_videos`, `flower`). `web` waits for Postgres, runs `alembic upgrade head`, then starts uvicorn (`--reload` unless `ENV=production`).

- Tests: `pytest.ini` sets `asyncio_mode = auto`, but the `tests/` directory is currently deleted in the working tree (see git status) — there is no test suite to run.
- Lint: `flake8` (config in `.flake8`, max line 120, migrations excluded). `mypy` cache exists but there is no config.
- `scripts/` (backup, fresh-start, load-dump) is git-ignored helper tooling; `fresh-start.sh` runs `docker compose down -v` (wipes the DB volume).

## Architecture

**Entry point:** `main.py` creates the app, installs `CsrfMiddleware`, Prometheus instrumentator, a `GatedStaticFiles` mount at `/static`, a dev no-cache middleware, validation/auth-redirect exception handlers, the landing/legal pages, and includes all routers. `core/config.py` (`settings`, pydantic-settings reading `.env`) is imported nearly everywhere and **requires** most env vars with no default.

**Layers:** `routers/` (HTTP, HTML + JSON) → `services/` (business logic: course access, lesson cache, assessment, email, telegram, lenta clips) → `db/` (`models.py`, async `database.py`; `sync_database.py` is the sync engine used by Celery/Alembic via `DATABASE_URL_SYNC`). `schemas/` holds Pydantic models. Admin routers live in `routers/admin/` (courses, lessons, students).

**Auth (`auth/`):** JWT access + refresh tokens in HTTP-only cookies (`cookies.py`), Redis-backed token blacklist on logout and login-attempt rate limiting, bcrypt hashing. `dependencies.py` provides `get_current_user` / `get_optional_current_user`; failures on page routes raise `AuthRedirectException` (handled in `main.py` as a redirect). Form validation errors on `/auth/*` and `/admin/*` are turned into flash-message redirects rather than 422 JSON.

**CSRF:** `auth/csrf.py` is a pure-ASGI double-submit-cookie middleware (not `BaseHTTPMiddleware`, so it doesn't consume form bodies). Unsafe requests need an `X-CSRF-Token` header or a `csrf_token` form field. Templates must use `core.templating.CsrfTemplates` (not plain `Jinja2Templates`) so the token is injected; forms need the hidden field.

**Course access model:** courses are paid; `UserCourseAccess` grants access (admins bypass via `is_admin_user`). Purchase is handled manually through Telegram (`services/course_access.py`, `/courses/{id}/pay`). Each course has an assessment (test) and homework submission (`routers/assessment.py`, `services/assessment_service.py`).

**Video:** lesson videos must not be publicly served. `core/static_files.py` (`GatedStaticFiles`) blocks lesson video paths under `/static/videos` (on the normalized path — keep `_normalized_static_path`, raw-path checks were bypassable via `//`, `..`, `%2e%2e`), and `routers/media.py` streams them at `/media/lessons/...` after an access check, with quality variants (`video_path_720`, etc.). Uploading a video enqueues `tasks/video_task.py` (ffmpeg transcode to H.264 + thumbnails in `static/images/video_thumbs`) on the `videos` Celery queue; lesson cache is invalidated afterwards (`services/lesson_service.py`, Redis, TTLs from `LESSON_CACHE_TTL`/`COMPLETION_CACHE_TTL`).

**Celery (`celery_app.py`):** three queues — `default`, `emails` (`tasks/email_task.py`, SMTP + `EmailLog`), `videos`. Telegram notifications (`tasks/telegram_task.py`, `services/telegram_service.py`) are used for leads (`routers/leads.py`, also emailed to `LEADS_NOTIFY_EMAIL`).

**Frontend:** Jinja2 templates in `templates/` (admin under `templates/admin/`), static assets in `static/`. `docs/` is a separate static HTML copy of the landing page. `core/dev_reload.py` computes an mtime-based `asset_v` for a short list of landing-page files and powers `/__dev__/reload-version` (auto-reload in dev); `main.py` also forces `no-store` on HTML/CSS/JS — both are marked temporary. If you rename or add landing-page assets, update `WATCH_PATHS`.

**Landing-page motion:** `static/js/home-motion.js` + `static/css/home-motion.css` layer GSAP/ScrollTrigger/Lenis (self-hosted in `static/vendor/`, not CDN) on top of `index-page.js`. Everything is skipped under `prefers-reduced-motion`; styles that hide content apply only under `html.nh-motion`. Use the local `from()` helper (explicit end values) instead of `gsap.from()` — page height changes as media loads, and a `ScrollTrigger.refresh` mid-tween otherwise freezes elements at `opacity: 0`. Avoid CSS `transition` on `transform` for GSAP-driven elements. FAQ sibling-closing in `index-page.js` delegates to `window.nhFaqClose`. Testimonials (a messenger: one conversation per student, `messages[]` with `from: student|teacher`) come from `content/testimonials.json` via `services/testimonials.py`; tab switching lives in `index-page.js`, the typing animation in `home-motion.js` (`nh:msgr-open` event); entries with `"sample": true` are demo data shown only when `ENV != production`, and the section is omitted when there are no entries to show. Tariff cards and the tariff dialog (`.tdialog`, bottom sheet on mobile, `?tariff=junior|middle` deep link) are styled in `static/css/home-tariffs.css`; dialog tabs are built in `index-page.js` from each card's `<template data-tariff-detail>` sections (`data-tab` = tab label). The works gallery waits for the `nh:works-lock` event (iPhone lock screen in `home-motion.js`) before autoplay. The final CTA photo is two layers (`cta-cat-bg.jpg` + `cta-cat-layer.webp`, same 1920×1080 geometry) animated in CSS. Dev-only behaviour (live reload, no-cache headers, `/__dev__/reload-version`) is gated on `ENV != production`. A pre-redesign copy of the page lives in `backups/index_*`.

**Migrations:** Alembic in `migrations/versions/`; `migrations/env.py` uses the sync URL. New models must be imported in `db/models.py` so autogenerate sees them.

## Notes

- `.cursor/skills/` contains design skills (frontend-design, scroll-craft, web-design-guidelines) used for the landing-page redesign; `scrollcraft/` and `design-baseline/` are related working dirs.
- The working tree is mid-refactor with many uncommitted changes and deletions; check `git status` before assuming a file exists.

# Автоматическое использование скиллов

Перед тем как начать задачу, проверь список доступных скиллов. Если задача подходит под описание скилла, сначала загрузи его через Skill tool (прочитай SKILL.md), и только потом пиши код. Не жди, пока я назову скилл по имени. Если подходят несколько, используй все нужные. Если ни один не подходит, работай обычным способом и не упоминай скиллы.

## Backend
- Любой новый эндпоинт, воркер, консьюмер, cron, CLI или интеграция: сначала `think-before-coding`, затем `design`.
- Схема БД или модель данных: `data-modeling-discipline`. Миграции: `migration-safety` и `review-migration`.
- SQL или ORM-запросы: `query-discipline`; если подозрение на N+1, то `hunt-n-plus-one`.
- Авторизация, роли, сессии, токены: `auth-and-authorization`.
- Операции с побочными эффектами (платежи, письма, вебхуки, события): `idempotency-and-side-effects`.
- Обработка ошибок: `error-handling-as-design`. Логи и метрики: `observability-by-default`.
- Каждый диф и каждый новый эндпоинт проверять через `security-discipline`.
- Что-то сломалось, тормозит или падает: `debugging-discipline` до предложения фикса.
- Выбор технологии или инфраструктуры: `boring-by-default`. Нагрузка и масштаб: `performance-and-scaling`.
- Тесты: `testing-with-discernment`.

## Frontend
- Новый UI, страница или компонент: `frontend-design`, затем `design-elevation`.
- Структура компонентов: `component-architecture`, `compound-components`, `atomic-design`, `hooks`.
- Типы TypeScript: `type-safety`. Стили на Tailwind: `tailwind`.
- Next.js (роутинг, layouts, server/client компоненты): `nextjs-routing`.
- Производительность рендера: `performance`. Длинные списки: `lists`.
- Текст интерфейса (кнопки, ошибки, пустые состояния): `ux-writing` или `ux-copy`.
- Доступность: `accessibility-audit` или `accessibility-review`.

## Анимации, параллакс, скролл, 3D
- Простые переходы, hover, появление элементов: `css-animations`, `ui-motion`, `ui-interactions`.
- Таймлайны и последовательности: `gsap-timelines`. GSAP в React: `gsap-react`.
- Параллакс и скролл-эффекты: `gsap-scroll-trigger`. Анимация текста: `gsap-text`.
- Производительность анимаций: `gsap-performance`.
- Three.js и GLSL (отладка сцены, шейдеры, визуальные регрессии): скиллы плагина parallax-threejs.

## Дизайн
- Критика макета: `design-critique`. Дизайн-система: `design-systems` или `design-system`.
- Передача в разработку: `design-handoff`.
- Исследования и UX-стратегия: `ux-research`, `user-research`, `ux-strategy`.
- Макет по ссылке на Figma: сначала `figma-design-to-code`.

## Общие правила
- Код ревью и перед мержем: `code-review`, `clean-review`.
- Текст README, коммитов, PR: `unslop`, `documentation`.
- Нужного скилла нет, но задача повторяется: предложи его создать через `skill-creator`.

## Publishing the landing page

`deploy/landing/` builds the home page (+ privacy, offer, 404) into a fully static site in `dist/landing/` (`build_landing.py`, run inside the `web` container) and ships it with nginx (`deploy/landing/nginx/`, `deploy.sh`, step-by-step `README.md`). The build renders templates with `static_site=True`, which hides the callback form (needs `/api/callback`) and app-only scripts; keep new landing features working without a backend or wrap server-dependent parts in `{% if not static_site %}`. Only files referenced from the rendered HTML/CSS are copied, so new assets must be referenced as `/static/...`. External CDNs are not allowed by the nginx CSP — vendor libraries and fonts live in `static/vendor/`.
