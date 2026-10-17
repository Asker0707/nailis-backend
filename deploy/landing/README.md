# Публикация рекламной главной Nailis.hub

Публикуется только главная и страница 404 («Политика ПДн» и «Оферта» временно отключены, см. `PAGES` в `build_landing.py`) —
как **статический сайт**: готовый HTML, CSS, JS, фото и видео. Бэкенд курса,
база, Redis и Celery на сервере не нужны — только nginx.

**Порядок выкладки:** сначала тестовая копия на GitHub Pages
(https://asker0707.github.io/nailis-backend/, раздел 6 — она собирается с
`noindex`, поисковики её не видят), владелец проверяет, и только потом боевой
сайт https://olesia-nails.ru через `deploy.sh` (раздел 5).

Формы «Перезвоните мне» в этой версии нет (она требует сервер). На странице
остаются кнопки Telegram и Instagram. В локальном приложении форма по-прежнему
есть — её показывает шаблон, когда `static_site` не задан.

```
deploy/landing/
├── build_landing.py        сборка сайта в dist/landing/
├── deploy.sh               сборка + выкладка на сервер через rsync
├── publish_github.sh       сборка + публикация на GitHub Pages
└── nginx/
    ├── nailis.conf         конфиг сайта (https, редиректы)
    ├── nailis-bootstrap.conf  временный конфиг для первого сертификата
    ├── nailis-site.conf    общие правила: кэш, gzip, 404
    ├── nailis-headers.conf заголовки безопасности (CSP и др.)
    └── local-test.conf     проверка сборки у себя в Docker
```

---

## 1. Что подготовить

| Что | Зачем | Комментарий |
|---|---|---|
| Домен, лучше `.ru` | адрес сайта | у регистратора (REG.RU, RU-CENTER и т. п.) |
| VPS в России, Ubuntu 24.04, 1 CPU / 1 ГБ | на нём работает nginx | Timeweb, Selectel, Beget и др., ~200–400 ₽/мес |
| SSH-ключ | выкладка без пароля | `ssh-keygen -t ed25519`, если ключа ещё нет |

**Почему не VDS, на котором VPN:** адреса VPN-серверов блокируют в РФ — вместе
с ними перестанет открываться и сайт; порт 443 обычно занят VPN, и разделять
их хрупко; публичный сайт привлекает сканеры на сервер с VPN. Если всё же нужно
именно так — см. раздел 9.

---

## 2. Проверить сборку у себя

Из корня проекта, при запущенном `docker compose up`:

```bash
docker compose exec web python deploy/landing/build_landing.py --site-url https://example.ru
```

Скрипт печатает, сколько файлов собрано, и падает с ошибкой, если страница
ссылается на несуществующий файл. Посмотреть результат через тот же nginx,
что будет на сервере:

```bash
docker run --rm -p 8090:80 \
  -v "$PWD/dist/landing:/usr/share/nginx/html:ro" \
  -v "$PWD/deploy/landing/nginx/nailis-site.conf:/etc/nginx/snippets/nailis-site.conf:ro" \
  -v "$PWD/deploy/landing/nginx/nailis-headers.conf:/etc/nginx/snippets/nailis-headers.conf:ro" \
  -v "$PWD/deploy/landing/nginx/local-test.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:1.27-alpine
```

Открыть http://localhost:8090.

---

## 3. DNS

У регистратора домена создайте две A-записи на IP сервера:

```
example.ru      A   203.0.113.10
www.example.ru  A   203.0.113.10
```

Записи расходятся от нескольких минут до суток. Проверка: `ping example.ru`.

---

## 4. Первая настройка сервера

Подключитесь: `ssh root@203.0.113.10`. Дальше — на сервере.

```bash
# обновления, nginx, certbot, rsync, файрвол
apt update && apt upgrade -y
apt install -y nginx certbot rsync ufw

# пользователь для выкладки (без root)
adduser --disabled-password --gecos "" deploy
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/   # ваш публичный ключ
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh

# папки сайта и для проверки домена
mkdir -p /var/www/nailis/landing /var/www/letsencrypt
chown -R deploy:deploy /var/www/nailis

# файрвол: только SSH и веб
ufw allow OpenSSH
ufw allow "Nginx Full"
ufw enable
```

Скопируйте конфиги с вашего компьютера (из корня проекта), **заменив
`example.ru` на свой домен** во всех `.conf`:

```bash
scp deploy/landing/nginx/nailis-site.conf deploy/landing/nginx/nailis-headers.conf root@203.0.113.10:/etc/nginx/snippets/
scp deploy/landing/nginx/nailis-bootstrap.conf deploy/landing/nginx/nailis.conf root@203.0.113.10:/etc/nginx/sites-available/
```

На сервере — временный http-конфиг и сертификат Let's Encrypt:

```bash
rm -f /etc/nginx/sites-enabled/default
ln -s /etc/nginx/sites-available/nailis-bootstrap.conf /etc/nginx/sites-enabled/nailis.conf
nginx -t && systemctl reload nginx

certbot certonly --webroot -w /var/www/letsencrypt \
  -d example.ru -d www.example.ru \
  --email you@example.ru --agree-tos --no-eff-email \
  --deploy-hook "systemctl reload nginx"
```

Сертификат получен — включаем настоящий конфиг с https:

```bash
ln -sf /etc/nginx/sites-available/nailis.conf /etc/nginx/sites-enabled/nailis.conf
nginx -t && systemctl reload nginx
```

Сертификат продлевается сам (таймер certbot), после продления nginx
перезагружается хуком. Проверка: `certbot renew --dry-run`.

---

## 5. Выкладка

С вашего компьютера, из корня проекта:

```bash
SITE_URL=https://example.ru DEPLOY_TARGET=deploy@203.0.113.10 ./deploy/landing/deploy.sh
```

Скрипт собирает сайт под ваш домен (canonical, превью для соцсетей, sitemap)
и синхронизирует `dist/landing/` с `/var/www/nailis/landing` на сервере.
Повторяйте после любых правок — посетители сразу видят новую версию
(HTML не кэшируется, у CSS/JS в адресе хэш версии).

Проверить после выкладки:

- https://example.ru открывается, замок в адресной строке;
- http:// и www. переадресуют на https://example.ru;
- https://example.ru/privacy, /offer (сейчас временно не публикуются — см. `PAGES` в `build_landing.py`), несуществующий адрес → своя 404;
- превью ссылки в Telegram (отправьте ссылку себе в «Избранное»);
- https://securityheaders.com — оценка заголовков.

---

## 6. Вариант без сервера: GitHub Pages

Сайт статический, поэтому его можно бесплатно разместить на GitHub Pages.

**Ограничения, о которых стоит знать:**

- По правилам GitHub Pages не предназначен как бесплатный хостинг сайта, который
  в основном служит коммерческим продажам. Рекламная страница курсов — серая
  зона: обычно работает, но GitHub вправе отключить. Для продающего сайта
  надёжнее свой сервер, Cloudflare Pages или Netlify (сборка подходит без изменений).
- Бесплатно Pages работает только из **публичного** репозитория. Поэтому скрипт
  публикует в **отдельный** репозиторий только готовый сайт — код проекта,
  `.env` и шаблоны туда не попадают.
- Свои заголовки сервера задать нельзя: CSP в сборке продублирован тегом
  `<meta>`, кэш GitHub ставит сам (10 минут).
- `github.io` сейчас открывается из России, но гарантий нет.

**Публикация:**

1. На GitHub создайте **пустой публичный** репозиторий, например `nailis-site`
   (без README).
2. Из корня проекта (при запущенном `docker compose up`):

   ```bash
   GH_REPO=git@github.com:USER/nailis-site.git SITE_URL=https://USER.github.io/nailis-site ./deploy/landing/publish_github.sh
   ```

   Скрипт сам поймёт, что сайт живёт в подпапке `/nailis-site`, и перепишет
   все пути. Ветка `gh-pages` в этом репозитории перезаписывается целиком при
   каждой публикации.
3. В репозитории: **Settings → Pages → Build and deployment → Source:
   Deploy from a branch → `gh-pages` / `(root)` → Save.**
4. Через 1–2 минуты сайт откроется по адресу `https://USER.github.io/nailis-site/`.

**Свой домен на GitHub Pages:**

```bash
GH_REPO=git@github.com:USER/nailis-site.git SITE_URL=https://nailis.ru CNAME=nailis.ru ./deploy/landing/publish_github.sh
```

У регистратора домена: четыре A-записи на `185.199.108.153`,
`185.199.109.153`, `185.199.110.153`, `185.199.111.153` и CNAME
`www` → `USER.github.io`. В **Settings → Pages** укажите домен и включите
**Enforce HTTPS** (сертификат GitHub выпускает сам).

На адресе `USER.github.io/nailis-site` поисковики не увидят `robots.txt`
(он должен лежать в корне домена) — карту сайта можно отправить в
Яндекс Вебмастер вручную: `https://USER.github.io/nailis-site/sitemap.xml`.

---

## 7. Как обновлять содержимое

| Что | Где |
|---|---|
| Тексты, тарифы, FAQ | `templates/index.html` |
| Отзывы | `content/testimonials.json` (+ скриншоты в `static/images/reviews/`) |
| Политика, оферта | `templates/legal/privacy.html`, `templates/legal/offer.html` |
| Ссылки Telegram / Instagram | `services/course_access.py` |
| Ролики ленты на первом экране | `static/videos/lenta/`: новый ролик — `docker compose exec web sh deploy/landing/encode_clip.sh ИСХОДНИК static/videos/lenta/имя` (H.264 + AV1 + постер) |

После правок — снова `deploy.sh` (или `publish_github.sh`).

---

## 8. После запуска

- **Яндекс Вебмастер** — подтвердить сайт и отправить `https://example.ru/sitemap.xml`,
  чтобы страница появилась в поиске.
- **Политика ПДн** сейчас написана под полную платформу (регистрация, кабинет)
  и содержит пометку «Реквизиты … уточняются». Перед запуском рекламы стоит
  обновить реквизиты и описание под лендинг.
- **Яндекс Метрика** (если подключите): понадобится баннер согласия на cookies
  и правка CSP в `nginx/nailis-headers.conf` — добавить домены Метрики в
  `script-src`, `img-src`, `connect-src` (`https://mc.yandex.ru` и др.),
  иначе браузер её заблокирует.
- Сейчас сайт сам не собирает персональные данные (формы нет). Когда вернёте
  форму заявки — потребуется уведомление в Роскомнадзор как оператор ПДн и
  обработка данных на сервере в РФ (152-ФЗ). Это не юридическая консультация.

---

## 9. Если всё-таки на VDS с VPN

Возможно, если порт 443 свободен или VPN умеет делить его по доменному имени:

- **VPN на другом порту / WireGuard (UDP)** — порт 443/TCP свободен, настройка
  как в разделе 4 без изменений.
- **Xray / VLESS Reality на 443** — либо `fallbacks` в Xray на nginx
  (`127.0.0.1:8443`), либо `nginx stream` с `ssl_preread`: запросы с SNI
  вашего домена → nginx, остальные → Xray. Пришлите конфиг VPN — подготовлю
  точную схему.

Риски из раздела 1 (блокировка IP) при этом остаются.

---

## 10. Вернуть форму «Перезвоните мне»

Форма и обработчик `/api/callback` остались в приложении. Для статического
сайта нужен маленький отдельный сервис заявок и `location /api/callback`
в nginx — это отдельная задача; в шаблоне форма включается, когда
`static_site` не задан.
