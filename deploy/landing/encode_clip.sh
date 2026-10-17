#!/usr/bin/env sh
# Готовит ролик для ленты на первом экране: H.264 (играет везде) + AV1 (при том же
# качестве примерно вдвое легче; браузер выбирает сам — см. av1Check в index-page.js).
#
#   docker compose exec web sh deploy/landing/encode_clip.sh ИСХОДНИК static/videos/lenta/otr_uchen7 [CRF_AV1]
#
# Результат: <префикс>_tape.mp4, <префикс>_tape_av1.mp4 и <префикс>_poster.jpg (если его ещё нет).
# ИСХОДНИК — уже обрезанный кусок на 4–8 секунд вертикального видео, лучше из оригинала.
# Не прогоняйте повторно готовый _tape.mp4: каждое пережатие теряет качество.
# CRF_AV1 по умолчанию 43; для роликов с мелкой фактурой (otr_uchen3, otr_uchen6) брали 39.
set -eu

IN="$1"
OUT="$2"
AV1_CRF="${3:-43}"
# 720×1280: на экранах с двойной плотностью колонка ленты ~656×1492 px — меньше нельзя
VF="scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280"

ffmpeg -v error -y -i "$IN" -an -vf "$VF" \
  -c:v libx264 -preset veryslow -crf 24 -pix_fmt yuv420p -movflags +faststart "${OUT}_tape.mp4"
ffmpeg -v error -y -i "$IN" -an -vf "$VF" \
  -c:v libsvtav1 -preset 4 -crf "$AV1_CRF" -g 240 -pix_fmt yuv420p -movflags +faststart "${OUT}_tape_av1.mp4" 2>/dev/null
[ -f "${OUT}_poster.jpg" ] || ffmpeg -v error -y -i "${OUT}_tape.mp4" -frames:v 1 -q:v 3 "${OUT}_poster.jpg"

for f in "${OUT}_tape.mp4" "${OUT}_tape_av1.mp4"; do
  echo "$(du -k "$f" | cut -f1) КБ  $f"
done
