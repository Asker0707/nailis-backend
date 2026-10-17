#!/usr/bin/env sh
# Добавляет к готовому mp4 его AV1-копию рядом: ролик.mp4 → ролик_av1.mp4.
# Исходный файл не меняется и остаётся запасным вариантом (H.264) для браузеров без AV1.
#
#   docker compose exec web sh deploy/landing/add_av1.sh static/images/result_students/IMG_6178.mp4 [CRF]
#
# Чтобы страница её подхватила, у миниатюры галереи нужен data-src-av1 (см. templates/index.html).
# CRF по умолчанию 42; чем меньше число, тем выше качество и больше файл.
set -eu

IN="$1"
CRF="${2:-42}"
OUT="${IN%.mp4}_av1.mp4"

ffmpeg -v error -y -i "$IN" -an \
  -c:v libsvtav1 -preset 4 -crf "$CRF" -g 240 -pix_fmt yuv420p -movflags +faststart "$OUT" 2>/dev/null
SSIM=$(ffmpeg -v info -i "$OUT" -i "$IN" -lavfi "[0:v][1:v]ssim" -f null - 2>&1 | grep -o "All:[0-9.]*" | cut -d: -f2)
echo "$(du -k "$IN" | cut -f1) КБ → $(du -k "$OUT" | cut -f1) КБ  SSIM $SSIM  $OUT"
