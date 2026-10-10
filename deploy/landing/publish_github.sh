#!/usr/bin/env bash
# Публикация рекламной главной на GitHub Pages.
#
# Публикуется ТОЛЬКО готовый сайт (dist/github-pages) — в отдельный публичный
# репозиторий, ветку gh-pages. Код проекта туда не попадает.
#
#   Адрес <user>.github.io/<repo>:
#     GH_REPO=git@github.com:USER/nailis-site.git SITE_URL=https://USER.github.io/nailis-site \
#       ./deploy/landing/publish_github.sh
#
#   Свой домен:
#     GH_REPO=git@github.com:USER/nailis-site.git SITE_URL=https://nailis.ru CNAME=nailis.ru \
#       ./deploy/landing/publish_github.sh
#
# Ветка BRANCH (по умолчанию gh-pages) в GH_REPO каждый раз перезаписывается
# целиком (force push): в ней хранится только сгенерированный сайт.
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${GH_REPO:?Укажите GH_REPO, например git@github.com:USER/nailis-site.git}"
: "${SITE_URL:?Укажите SITE_URL, например https://USER.github.io/nailis-site}"
BRANCH="${BRANCH:-gh-pages}"
CNAME="${CNAME:-}"

SITE_URL="${SITE_URL%/}"
args=(--site-url "$SITE_URL" --github-pages --out dist/github-pages)
if [[ -n "$CNAME" ]]; then
  args+=(--cname "$CNAME")
else
  # https://user.github.io/repo → сайт живёт в подпапке /repo
  host_and_path="${SITE_URL#https://}"
  if [[ "$host_and_path" == */* ]]; then
    args+=(--base-path "/${host_and_path#*/}")
  fi
fi

echo "→ Сборка для $SITE_URL"
docker compose exec -T web python deploy/landing/build_landing.py "${args[@]}"

echo "→ Публикация в $GH_REPO ($BRANCH)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp -r dist/github-pages/. "$tmp/"
git -C "$tmp" init -q -b "$BRANCH"
git -C "$tmp" add -A
git -C "$tmp" commit -q -m "Публикация сайта $(date '+%Y-%m-%d %H:%M')"
git -C "$tmp" push -q -f "$GH_REPO" "$BRANCH"

echo "✓ Готово. Через 1–2 минуты сайт обновится: $SITE_URL"
