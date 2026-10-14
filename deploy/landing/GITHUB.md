# Публикация на GitHub

## Текущая схема (с 10.10.2026)

Один публичный репозиторий **`github.com/Asker0707/nailis-backend`**:

- ветка `master` — весь код проекта (бэкенд, шаблоны, отзывы, скрипты сборки);
- ветка `gh-pages` — только готовый сайт, его раздаёт GitHub Pages:
  **https://asker0707.github.io/nailis-backend/**

Обновить сайт после правок:

```bash
git add -A && git commit -m "Обновление главной" && git push    # код → master
GH_REPO=git@github.com:Asker0707/nailis-backend.git SITE_URL=https://asker0707.github.io/nailis-backend BRANCH=gh-pages ./deploy/landing/publish_github.sh   # сайт → gh-pages
```

Ветка `gh-pages` при каждой публикации перезаписывается целиком — в ней
только сгенерированный сайт. Ветку `master` скрипт не трогает.

Если переименуете репозиторий (Settings → General → Repository name),
например в `nailis`, адрес сайта станет `https://asker0707.github.io/nailis/` —
пересоберите сайт с новыми `GH_REPO` и `SITE_URL`, иначе пути на странице
будут указывать на старую подпапку.

Старый репозиторий `FastApi_Nail_Project` больше не нужен (там старая копия
сайта) — его можно удалить: Settings → Danger Zone → Delete this repository.

---

## Как было устроено переносом (история)


Цель: в `github.com/Asker0707/FastApi_Nail_Project` (публичный) остаётся
**только рекламная главная** на GitHub Pages, а весь код проекта (бэкенд курса,
шаблоны, скрипты сборки) живёт в **приватном** репозитории.

## Почему нельзя просто удалить файлы

Сейчас репозиторий публичный, и в его истории (5 коммитов) лежат:

- весь старый код бэкенда;
- пароль админа открытым текстом (`admin123` в README и `create_admin.py`);
- видеоурок `static/videos/lesson_1.mp4` и исходник `IMG_6224.MP4`.

Коммит «удалил всё» убирает файлы только из текущей версии — история
остаётся открытой, любой может её посмотреть. Поэтому порядок такой:
сначала сохранить проект в приватный репозиторий, потом **пересоздать**
публичный с нуля и залить туда только сайт.

Хорошая новость: `.env` с ключами в историю ни разу не попадал.

---

## Шаг 1. Сохранить весь проект в приватный репозиторий

Сейчас в проекте много незакоммиченной работы (редизайн, безопасность,
сборка сайта) — её нужно сохранить первой.

1. На GitHub: **New repository** → имя `nailis-backend` → **Private** →
   без README, .gitignore и лицензии → **Create repository**.

2. В терминале, в папке проекта:

   ```bash
   cd ~/"Рабочий стол/Мои файлы/FAST_API_1"

   # видео, которые раньше попали в git, — убрать из git (с диска НЕ удаляются)
   git rm --cached -q --ignore-unmatch static/videos/IMG_6224.MP4 static/videos/lesson_1.mp4 static/videos/video5451775810434267095.mp4

   git add -A
   git status
   ```

   Просмотрите список в `git status`: там **не должно быть** `.env`, больших
   видео (`video_urok_*`, исходников из `static/videos/`), папки `dist/`.
   Они исключены в `.gitignore`, но проверить глазами стоит.

3. Коммит и отправка в приватный репозиторий:

   ```bash
   git commit -m "Редизайн главной, безопасность, статическая сборка сайта"

   git remote rename origin old-public
   git remote add origin git@github.com:Asker0707/nailis-backend.git
   git push -u origin master
   ```

4. Откройте `github.com/Asker0707/nailis-backend` и убедитесь, что код на
   месте и замок «Private» у названия.

С этого момента обычный `git push` отправляет код в приватный репозиторий.

---

## Шаг 2. Пересоздать публичный репозиторий без истории

1. `github.com/Asker0707/FastApi_Nail_Project` → **Settings** → внизу
   **Danger Zone** → **Delete this repository** → подтвердить имя.

   Удаляется только копия на GitHub. Весь проект уже лежит в
   `nailis-backend` (шаг 1) и у вас на диске.

2. **New repository** → **Public** → без README → **Create repository**.
   Имя определяет адрес сайта:

   | Имя репозитория | Адрес сайта |
   |---|---|
   | `FastApi_Nail_Project` | `https://asker0707.github.io/FastApi_Nail_Project/` |
   | `nailis` (рекомендую) | `https://asker0707.github.io/nailis/` |
   | `asker0707.github.io` | `https://asker0707.github.io/` (корень) |

   Дальше в командах используется `nailis` — подставьте своё имя.

3. Локальная ссылка на старый репозиторий больше не нужна:

   ```bash
   git remote remove old-public
   ```

> Если удалять репозиторий не хочется (например, на него уже есть ссылки),
> можно перезаписать ветку `master` сайтом через `BRANCH=master` в шаге 3.
> Старые коммиты перестанут быть видны в репозитории, но GitHub ещё какое-то
> время может отдавать их по прямой ссылке на коммит. Полную гарантию даёт
> только удаление.

---

## Шаг 3. Опубликовать сайт

Проект должен быть запущен (`docker compose up -d`) — сборка идёт в
контейнере. Из папки проекта:

```bash
GH_REPO=git@github.com:Asker0707/nailis.git \
SITE_URL=https://asker0707.github.io/nailis \
BRANCH=main \
./deploy/landing/publish_github.sh
```

Скрипт соберёт сайт, перепишет все пути под адрес `/nailis/` и отправит в
репозиторий **только готовый сайт** — без кода, шаблонов и `.env`.

Затем на GitHub в репозитории `nailis`: **Settings → Pages →
Build and deployment → Source: Deploy from a branch → Branch: `main`,
папка `/ (root)` → Save.**

Через 1–2 минуты сайт откроется по адресу `https://asker0707.github.io/nailis/`
(статус — там же, в **Settings → Pages**).

> Адрес — строчными буквами (`asker0707`), а имя репозитория в пути
> чувствительно к регистру: `/nailis/` и `/Nailis/` — разные адреса.

---

## Шаг 4. Проверить

- главная открывается, есть видео, анимации, отзывы, окно тарифа;
- `…/nailis/privacy` и `…/nailis/offer` открываются (сейчас эти страницы временно не публикуются — см. `PAGES` в `build_landing.py`);
- несуществующий адрес → своя страница 404;
- с телефона;
- ссылка, отправленная себе в Telegram («Избранное»), показывает превью с котом.

---

## Шаг 5. Как обновлять сайт

Правите тексты/отзывы в проекте (см. раздел 7 в `README.md`), затем:

```bash
git add -A && git commit -m "Обновление главной" && git push    # код → приватный репозиторий
GH_REPO=git@github.com:Asker0707/nailis.git SITE_URL=https://asker0707.github.io/nailis BRANCH=main ./deploy/landing/publish_github.sh   # сайт → публичный
```

В публичном репозитории при каждой публикации остаётся один коммит с
актуальной версией сайта — история там не нужна (она в приватном).

---

## Шаг 6. Безопасность

- Пароль `admin123` был в открытом доступе. Если он где-то использовался
  (сервер, база, админка) — **смените его**. Сейчас `create_admin.py`
  берёт пароль из `.env` (`ADMIN_PASSWORD`).
- `.env` никогда не коммитьте — он уже в `.gitignore`.

---

## Свой домен (когда появится)

```bash
GH_REPO=git@github.com:Asker0707/nailis.git SITE_URL=https://nailis.ru CNAME=nailis.ru BRANCH=main ./deploy/landing/publish_github.sh
```

DNS у регистратора: четыре A-записи на `185.199.108.153`, `185.199.109.153`,
`185.199.110.153`, `185.199.111.153` и CNAME `www` → `asker0707.github.io`.
В **Settings → Pages** укажите домен и включите **Enforce HTTPS**.
