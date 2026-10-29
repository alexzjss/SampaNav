#!/usr/bin/env bash
# Regenera todas as imagens do README (docs/img/*) contra a UI atual.
# Uso: tools/screenshots/run.sh <data_dir> [vendor_dir]
#   data_dir    pasta processed com graph_walk.npz, graph_drive.npz, risk_hex.parquet, risk_meta.json
#   vendor_dir  (opcional) pasta com maplibre-gl-4.7.1/package e h3-js-4.1.0/package, para quem não
#               alcança o unpkg.com; sem ela o navegador usa a CDN real.
# Env opcional: BASEMAP=real (usa os tiles reais do OpenFreeMap em vez do mapa de ruas local),
#               ONLY=hero,dark (só algumas cenas), HERO_PERIOD=noite.
set -euo pipefail
DATA_DIR="${1:?uso: run.sh <data_dir> [vendor_dir]}"
export VENDOR_DIR="${2:-}"
[ -n "$VENDOR_DIR" ] || unset VENDOR_DIR
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"

PORT="${PORT:-$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')}"
LOG="$HERE/.cache/api.log"
mkdir -p "$HERE/.cache"

if [ "${BASEMAP:-}" != "real" ]; then
  uv run python "$HERE/basemap.py" "$DATA_DIR" "$HERE/.cache/streets.geojson"
fi

# limites de taxa desligados: a captura faz dezenas de chamadas em poucos segundos
SAMPANAV_DATA_DIR="$DATA_DIR" SAMPANAV_RATE_ROUTES=0 SAMPANAV_RATE_RISK=0 SAMPANAV_RATE_GEOCODE=0 \
  uv run uvicorn backend.app.main:app --host 127.0.0.1 --port "$PORT" >"$LOG" 2>&1 &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true; wait "$API_PID" 2>/dev/null || true' EXIT

echo "aguardando a API em :$PORT ..."
for _ in $(seq 120); do
  if curl -fs "http://127.0.0.1:$PORT/api/health" | grep -q '"status":"ok"'; then break; fi
  kill -0 "$API_PID" 2>/dev/null || { echo "API terminou; veja $LOG"; exit 1; }
  sleep 2
done

rm -rf "$HERE/.cache/raw"
BASE_URL="http://127.0.0.1:$PORT" node "$HERE/capture.mjs"
"$HERE/optimize.sh"
