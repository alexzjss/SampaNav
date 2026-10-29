#!/usr/bin/env bash
# Converte as capturas brutas (.cache/raw) em docs/img: PNGs com 256 cores + GIF da navegação.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
RAW="${OUT_DIR:-$HERE/.cache/raw}"
DEST="${IMG_DIR:-$HERE/../../docs/img}"
mkdir -p "$DEST"

for f in "$RAW"/*.png; do
  case "$f" in *.tmp.png) continue;; esac
  [ -e "$f" ] || continue
  convert "$f" -strip -colors 256 -define png:compression-level=9 -define png:compression-strategy=1 "$DEST/$(basename "$f")"
done

if [ -f "$RAW/navigation.webm" ]; then
  START="$(cat "$RAW/navigation.start" 2>/dev/null || echo 0)"
  PAL="$RAW/palette.tmp.png"
  FILTERS="fps=6,scale=320:-1:flags=lanczos"
  ffmpeg -v error -y -ss "$START" -t 7.5 -i "$RAW/navigation.webm" -vf "$FILTERS,palettegen=max_colors=64:stats_mode=diff" "$PAL"
  ffmpeg -v error -y -ss "$START" -t 7.5 -i "$RAW/navigation.webm" -i "$PAL" \
    -lavfi "$FILTERS [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -loop 0 "$DEST/navigation.gif"
fi
ls -l "$DEST"
