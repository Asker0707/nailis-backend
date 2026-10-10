# 🎨 Nailis Hub — Онлайн-платформа обучения маникюру
![FastAPI](https://img.shields.io/badge/FastAPI-009485?style=flat&logo=fastapi&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-336791?style=flat&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat&logo=redis&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)
---

## 📖 Описание

**Nailis Hub** — это онлайн-платформа для обучения маникюру и сайт визитка мастера маникюра. Поддерживает функцию регистрации, авторизации и аутентификации пользователя. Есть возможность создать администратора для работы с данными курсов и уроков.

**Функционал:**
- 📚 Курсы и уроки
- 👩‍🎓 Личный кабинет с заметками
- 👤 Профиль с информацией о прогрессе, количеством уроков и завершенных уроков
- 🛠 Админ-панель для управления контентом 
- 🔒 Авторизация через JWT + HTTP-only cookies
- 📱 Адаптивный дизайн на HTML/CSS/Bootstrap

---

## 🛠 Технологии

- **Backend:** [FastAPI](https://fastapi.tiangolo.com/), [SQLAlchemy](https://www.sqlalchemy.org/), [Alembic](https://alembic.sqlalchemy.org/)
- **Frontend:** [Jinja2](https://jinja.palletsprojects.com/), [Bootstrap 5](https://getbootstrap.com/)
- **Database:** PostgreSQL
- **Cache & Sessions:** Redis
- **Auth:** JWT + bcrypt
- **Containerization:** Docker & Docker Compose
- **Tests:** pytest + pytest-asyncio + httpx
- **Background jobs:** Celery + RabbitMQ

---

## 🚀 Установка и запуск

### 1. Клонировать репозиторий
```bash
git clone git@github.com:Asker0707/FastApi_Nail_Project.git
```

### 2. Настроить переменные окружения
Создайте `.env` в корне проекта и заполните все необходимые переменные.

### 🚀 Запуск с Docker Compose
Убедитесь, что у вас установлен **Docker** и **Docker Compose**

Запуск:
```bash
docker compose up --build
```

### Приложение будет доступно на:

http://localhost:8001 — сайт

http://localhost:8001/docs — Swagger UI

### Создать админа для тестирования добавления, редактирования и удаления курсов и уроков
Добавьте в `.env`:
```bash
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=strong-password
```
После этого выполните:
```bash
docker compose exec web python create_admin.py
```

## 🔒 Модуль аутентификации

Модуль `auth` отвечает за регистрацию, вход, выход и аутентификацию администраторов и пользователей.  
Он работает через веб-формы, поддерживает flash-сообщения об ошибках и интегрирован с Jinja2-шаблонами.

### Возможности
- Регистрация пользователей с проверкой на уникальность email
- Вход через форму (`/auth/login`) и API
- Админ-вход (`/auth/admin_login`) с проверкой прав
- Выход с добавлением токена в blacklist
- Flash-сообщения об ошибках

### Роуты

| Метод | Путь | Описание | Доступ |
|-------|------|----------|--------|
| GET   | `/auth/register`      | Страница регистрации | Все |
| POST  | `/auth/register`      | Регистрация нового пользователя | Все |
| GET   | `/auth/login`         | Страница входа | Все |
| POST  | `/auth/login`         | Вход пользователя | Все |
| POST  | `/auth/admin_login`   | Вход администратора | Только админ |
| POST  | `/auth/logout`        | Выход пользователя | Авторизованные |




## 📜 Лицензия

#### MIT © Asker

## 📬 Контакты

#### Автор: Dyshekov Asker

#### 📧 Почта: asker_original@mail.ru

#### 🐙 GitHub: @Asker0707
