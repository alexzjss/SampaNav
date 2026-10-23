# SampaNav — Arquitetura (reescrita)

Roteamento a pé e de carro na cidade de São Paulo que equilibra tempo e
exposição a ocorrências criminais registradas (SSP-SP). Este documento é o
contrato entre as partes do sistema: pipeline de dados, motor de rotas/API e
frontend.

## Estrutura do repositório

```
pyproject.toml          # projeto Python único, gerenciado com uv
pipeline/               # scripts offline (download, risco, grafo)
  download_ssp.py
  build_risk.py
  build_graph.py
  config.py             # pesos, períodos, caminhos — fonte única de constantes
backend/
  app/main.py           # FastAPI; também serve frontend/ como estático em /
  app/routing.py        # carga do grafo + cálculo de rotas
  app/geocode.py        # proxy para Photon (komoot) com bbox de SP
  tests/
frontend/               # HTML/CSS/JS estático, sem build
  index.html
  css/
  js/
data/
  raw/                  # xlsx da SSP, PBF/graphml do OSM (gitignored)
  processed/            # saídas do pipeline (gitignored)
docs/
```

## 1. Fonte de dados criminais (verificado em 23/10/2026)

SSP-SP › Transparência › Consultas › "Dados criminais":
`https://www.ssp.sp.gov.br/assets/estatistica/transparencia/spDados/SPDadosCriminais_{ANO}.xlsx`
(2022–2026; ~126–196 MB cada). Planilhas: `Campos da Tabela_SPDADOS` (dicionário),
`JAN-JUN_{ANO}`, `JUL-DEZ_{ANO}`.

Colunas relevantes: `NOME_MUNICIPIO_CIRCUNSCRICAO` (cidade = `S.PAULO`),
`COD IBGE` (3550308), `DATA_OCORRENCIA_BO`, `HORA_OCORRENCIA_BO`,
`DESC_PERIODO`, `DESCR_TIPOLOCAL`, `DESCR_SUBTIPOLOCAL`, `LATITUDE`,
`LONGITUDE`, `RUBRICA`, `DESCR_CONDUTA`, `NATUREZA_APURADA`, `NUM_BO`, `ANO_BO`.

Observações:
- ~90% dos registros da capital têm lat/lon; ausentes vêm como `0`
  (ex.: crimes sexuais, com `LOGRADOURO = 'VEDAÇÃO DA DIVULGAÇÃO…'`). Descartar
  `0` e pontos fora da bbox de SP (lat −24.01…−23.35, lon −46.83…−46.36).
- Um BO pode gerar várias linhas; deduplicar por (`NUM_BO`, `ANO_BO`,
  `NOME_DELEGACIA`, `RUBRICA`).
- Usar a planilha com `openpyxl` em modo `read_only` (streaming); arquivos são
  grandes. Cachear como parquet em `data/processed/occurrences.parquet`.
- Bases auxiliares (opcional, fase 2): `CelularesSubtraidos_{ANO}.xlsx`,
  `VeiculosSubtraidos_{ANO}.xlsx` em `.../transparencia/baseDados/...`.

Fonte complementar: dadoscrimesp.com.br (agregado por DP; contexto, não usado
no roteamento).

## 2. Modelo de risco

### Categorias e pesos

Classificar por `RUBRICA` + `DESCR_CONDUTA` + `DESCR_TIPOLOCAL` em categorias
(definidas em `pipeline/config.py`):

| categoria | regra | peso pedestre | peso carro |
|---|---|---|---|
| `roubo_pessoa` | Roubo (157) que não é de veículo/carga | 3 | 1 |
| `furto_pessoa` | Furto (155) que não é de veículo/residência | 1 | 0.3 |
| `roubo_veiculo` | Roubo com conduta de veículo | 1 | 4 |
| `furto_veiculo` | Furto com conduta de veículo | 0 | 1.5 |
| `lesao` | Lesão corporal dolosa (129) | 2 | 0.5 |
| `letal` | Homicídio doloso (inclusive tentativa), latrocínio, feminicídio | 10 | 5 |

Descartar: crimes de trânsito culposos, drogas, posse de arma, ocorrências
não criminais e tudo cujo `DESCR_TIPOLOCAL` seja ambiente fechado/privado
(Residência, Condomínio, Comércio interno etc.). Manter Via Pública, Transporte
público/estações, Terminal, Praça, Estacionamento etc. O agente do pipeline deve
inspecionar os valores distintos e documentar a lista final em `config.py`.

### Temporal
- Janela: últimos 24 meses disponíveis. Decaimento exponencial com meia-vida de
  12 meses (`w_t = 0.5 ** (idade_dias / 365)`).
- Períodos (pela hora da ocorrência; se ausente usar `DESC_PERIODO`; se nada,
  conta só em `all`): `madrugada` 0–6h, `manha` 6–12h, `tarde` 12–18h,
  `noite` 18–24h, e `all`.

### Espacial
- Grade H3 resolução 9 (~174 m de aresta). Cada ocorrência soma
  `peso_categoria × w_t` em sua célula; suavização: vizinhos k=1 recebem 0.5×.
- Normalização por modo e período em escala log ancorada na mediana:
  `risk = clip(log1p(score/mediana) / log1p(p99.9/mediana), 0, 1)`. As contagens
  têm cauda longa (Centro ~40× a mediana); com escala linear/p99 todo o Centro
  saturava em 1.0 e o roteador não distinguia ruas ali.

### Saída: `data/processed/risk_hex.parquet`
Colunas: `h3` (str, res 9), `mode` (`walk`|`drive`), `period`
(`all`|`madrugada`|`manha`|`tarde`|`noite`), `score` (float bruto),
`risk` (float 0–1), `n` (int, contagem não ponderada de ocorrências na célula),
e `top_categories` (str JSON `{categoria: contagem}`).
Mais `data/processed/risk_meta.json`: `{generated_at, source_files,
date_min, date_max, n_occurrences, categories, weights}`.

## 3. Grafo viário

- OSM via OSMnx, polígono do município "São Paulo, São Paulo, Brazil".
  `network_type="walk"` e `"drive"`. Cachear graphml em `data/raw/`.
- Para cada aresta: `length_m`; `travel_time_s` (walk: 1.3 m/s; drive:
  `osmnx.add_edge_speeds` + `add_edge_travel_times`); e `risk_<period>` para os
  5 períodos — média dos `risk` das células H3 amostradas ao longo da geometria
  a cada ~25 m (ponderada por comprimento), usando o `mode` correspondente.
- Saída: `data/processed/graph_{walk,drive}.npz` (ou parquet) com arrays:
  `node_id`, `node_lat`, `node_lon`, `edge_u`, `edge_v` (índices), `length_m`,
  `travel_time_s`, `risk_all`, `risk_madrugada`, …, e geometria das arestas
  (lista de coordenadas codificada, p.ex. polyline ou arrays offset+coords).
  Grafo dirigido (drive respeita mão única; walk bidirecional).
- Se `risk_hex.parquet` ainda não existir, `build_graph.py --synthetic-risk`
  gera um risco sintético (ruído espacial) para o backend poder ser
  desenvolvido em paralelo.

## 4. Roteamento

- Backend carrega os grafos na inicialização em `igraph` (Dijkstra em C).
- Custo de aresta: `base × (1 + α × risk_period)`, onde `base = travel_time_s`.
  Arrays de peso cacheados por (mode, period, α) com numpy.
- Perfis padrão: `rapida` (α = 0), `equilibrada` (α = 2), `segura` (α = 6).
  Descartar rota alternativa se > 90% do seu comprimento coincide com uma já
  escolhida; nesse caso tentar α maior (até 15) antes de desistir.
- Snap de origem/destino ao nó mais próximo (KD-tree scipy).
- Exposição de uma rota: `Σ length_m × risk` / 1000 (km "de risco equivalente").
  `avg_risk = exposição / distância_km`. Nível relativo à cidade: limites são os
  quantis 50/75/90% do risco das arestas (ponderados por comprimento) no
  modo/período → baixo / moderado / alto / muito alto.
- Uma alternativa só é mostrada se reduzir a exposição em ≥ 5% frente à rota
  menos exposta já escolhida (senão sobe α; se nada servir, mostra só a mais
  rápida e a UI explica que não há desvio relevante).
- Fórmula de custo validada empiricamente: penalidades mais fortes (r², r³)
  geram rotas mais longas sem reduzir a exposição total; a linear é a melhor.

## 5. API (FastAPI, prefixo `/api`)

### `GET /api/health`
`{"status": "ok", "graphs": {"walk": {"nodes": n, "edges": m}, "drive": {...}}}`

### `GET /api/meta`
Conteúdo de `risk_meta.json` + `{"profiles": [...], "periods": [...]}`.

### `GET /api/geocode?q=...`
Proxy para `https://photon.komoot.io/api/?q=...&bbox=-46.83,-24.01,-46.36,-23.35&lang=default&limit=6`.
Resposta: `[{"label": str, "lat": float, "lon": float}]`. Cache LRU em memória.
User-Agent identificando o app.

### `POST /api/routes`
Requisição:
```json
{
  "origin": {"lat": -23.55, "lon": -46.63},
  "destination": {"lat": -23.56, "lon": -46.66},
  "mode": "walk",
  "period": "now"
}
```
`period`: `"now"` (resolve pela hora atual em America/Sao_Paulo) ou um dos períodos.

Resposta:
```json
{
  "mode": "walk",
  "period": "noite",
  "routes": [
    {
      "id": "rapida",
      "label": "Mais rápida",
      "alpha": 0,
      "distance_m": 2310.4,
      "duration_s": 1777,
      "exposure": 0.62,
      "avg_risk": 0.27,
      "risk_level": "moderado",
      "vs_fastest": {"duration_pct": 0, "exposure_pct": 0},
      "categories": {"roubo_pessoa": 41, "furto_pessoa": 120},
      "geometry": {"type": "LineString", "coordinates": [[lon, lat], ...]},
      "segments": [
        {"coordinates": [[lon, lat], ...], "risk": 0.12}
      ]
    }
  ],
  "data": {"date_min": "2024-09-01", "date_max": "2026-08-31", "source": "SSP-SP"}
}
```
`segments`: rota fatiada em trechos contíguos com risco semelhante (para
colorir no mapa). `categories`: soma de `top_categories` das células H3 que a
rota cruza (sem repetir célula). `vs_fastest` em % relativos à rota `rapida`
(negativo = menos). Erros: 400 com `{"detail": "..."}` (fora de SP, sem
caminho).

### `GET /api/risk?bbox=minLon,minLat,maxLon,maxLat&mode=walk&period=noite`
`[{"h3": "89a8100c...", "risk": 0.42}]` — somente células com `risk ≥ 0.05`;
limite de 20 000 células por resposta. Frontend desenha com h3-js.

## 6. Frontend

- HTML/CSS/JS estático (módulos ES), sem build. Bibliotecas por CDN com versão
  fixa: MapLibre GL JS 4.7.1 (unpkg) e h3-js 4.1.0.
- Mapa base: OpenFreeMap (`https://tiles.openfreemap.org/styles/positron`).
- UI em português: campos origem/destino com autocomplete (`/api/geocode`),
  "usar minha localização", clique no mapa para definir pontos, alternância
  A pé / Carro, seletor de período (Agora, Madrugada, Manhã, Tarde, Noite),
  camada de calor H3 ligável.
- Painel com cartões das rotas (tempo, distância, nível de risco, % menos
  exposição vs. mais rápida, categorias predominantes). Selecionar cartão
  destaca a rota; a rota selecionada é colorida por segmento de risco.
- Aviso permanente e discreto: "Baseado em ocorrências registradas pela SSP-SP
  (período X–Y). Registros não refletem todo o risco real e a subnotificação
  varia entre regiões." Nunca rotular bairros como "perigosos".
- Responsivo (painel vira bottom sheet em telas < 768 px).

## 7. Execução

```bash
uv sync
uv run python -m pipeline.download_ssp --years 2025 2026
uv run python -m pipeline.build_risk
uv run python -m pipeline.build_graph
uv run uvicorn backend.app.main:app --reload
```
