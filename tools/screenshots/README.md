# Screenshots do README

Gera as imagens de `docs/img/` (capturas da UI real, rodando contra a API com os dados de produção).

## Pré-requisitos

- Dados processados (`graph_walk.npz`, `graph_drive.npz`, `risk_hex.parquet`, `risk_meta.json`).
- `uv` (dependências do backend), Node 18+ com o pacote `playwright` resolvível e o Chromium já instalado
  (`require('playwright')` precisa funcionar; este script não roda `playwright install`).
- `ffmpeg` e ImageMagick (`convert`) no PATH.
- Sem acesso ao unpkg.com: pastas `maplibre-gl-4.7.1/package` e `h3-js-4.1.0/package` (saída do `npm pack`).

## Gerar tudo

```bash
tools/screenshots/run.sh <data_dir> [vendor_dir]
```

O script sobe a API em uma porta livre (com limites de taxa desligados), monta o mapa-base, captura as cenas,
otimiza os PNGs/GIF para `docs/img/` e encerra a API. Variáveis úteis: `ONLY=hero,dark` (só algumas cenas),
`BASEMAP=real` (usa os tiles reais do OpenFreeMap, se a rede permitir), `HERO_PERIOD=noite`.

## Arquivos

| Arquivo | Função |
| --- | --- |
| `basemap.py` | extrai as ruas (por classe viária) dos grafos para `.cache/streets.geojson` |
| `basemap-style.mjs` | estilo MapLibre minimalista (claro/escuro) desenhado a partir desse GeoJSON |
| `capture.mjs` | cenas do Playwright (estado via URL, sem geocoder) |
| `optimize.sh` | PNG 256 cores e GIF (ffmpeg) em `docs/img/` |

## Observações

- O mapa-base é desenhado só com as ruas do grafo (sem rótulos, parques ou água): difere do Positron real em
  produção. O estilo e os tiles do OpenFreeMap são interceptados pelo Playwright.
- Sé → MASP só retorna as três rotas (rápida/equilibrada/segura) no período `madrugada` com os dados atuais;
  por isso as cenas usam esse período (`HERO_PERIOD`).
- O GIF usa o GPS simulado (`?simgps=1`, `window.__simgps`) e grava vídeo do Playwright.
- `.cache/` é temporário (ignorado pelo git).
