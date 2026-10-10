#!/usr/bin/env bash
# Сборка рекламной главной и выкладка на сервер.
#
#   SITE_URL=https://nailis.ru DEPLOY_TARGET=deploy@203.0.113.10 ./deploy/landing/deploy.sh
#
# Нужно: запущенный docker compose проекта (сборка идёт в контейнере web) и
# SSH-доступ к серверу по ключу. REMOTE_DIR — папка сайта на сервере.
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${SITE_URL:?Укажите SITE_URL, например https://nailis.ru}"
: "${DEPLOY_TARGET:?Укажите DEPLOY_TARGET, например deploy@203.0.113.10}"
REMOTE_DIR="${REMOTE_DIR:-/var/www/nailis/landing}"

echo "→ Сборка для $SITE_URL"
docker compose exec -T web python deploy/landing/build_landing.py --site-url "$SITE_URL"

echo "→ Выкладка в $DEPLOY_TARGET:$REMOTE_DIR"
# --delete удаляет на сервере файлы, которых больше нет в сборке (только внутри REMOTE_DIR)
rsync -az --delete --chmod=D755,F644 dist/landing/ "$DEPLOY_TARGET:$REMOTE_DIR/"

echo "✓ Готово: $SITE_URL"
