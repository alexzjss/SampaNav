# SampaNav

O SampaNav sugere rotas a pé ou de carro pela cidade de São Paulo que equilibram
**tempo de deslocamento** e **exposição a ocorrências criminais** registradas pela
SSP-SP. Para cada trajeto são mostradas até três opções:

- **Mais rápida**: menor tempo, sem considerar risco;
- **Equilibrada**: compromisso entre tempo e exposição;
- **Mais segura**: menor exposição, aceitando desvios maiores.

O mapa também exibe uma camada de calor com o risco por região, que pode ser
filtrado por período do dia (madrugada, manhã, tarde, noite).

## Limitações e uso responsável

Leia antes de usar ou apresentar os resultados.

- **Os dados refletem ocorrências registradas, não o risco real.** Um boletim de
  ocorrência é um indicador imperfeito do que de fato acontece nas ruas.
- **A subnotificação varia entre regiões.** Locais onde as pessoas registram menos
  boletins parecem mais seguros do que são.
- **Áreas movimentadas têm mais registros, em parte por causa do fluxo de
  pessoas.** O Centro, por exemplo, concentra muitas ocorrências também porque
  recebe muito mais gente. Mais registros não significam necessariamente mais
  risco por pessoa.
- **Não use a ferramenta para estigmatizar bairros.** A interface não rotula
  regiões como "perigosas" e o aviso permanente deve ser mantido.
- **Crimes sexuais não entram no modelo.** Na fonte, esses registros vêm sem
  localização (campos zerados e logradouro ocultado), então não há como
  representá-los no mapa.
- **Este projeto não substitui julgamento próprio nem orientação de segurança
  pública.** Em caso de emergência, procure os canais oficiais.

## Fontes de dados

- **SSP-SP, "Dados criminais"** (planilhas anuais em `.xlsx`):
  <https://www.ssp.sp.gov.br/estatistica/consultas>. Cada ano ocupa cerca de
  126 a 196 MB.
- **OpenStreetMap**, via [OSMnx](https://github.com/gboeing/osmnx), para a rede
  de ruas a pé e de carro.
- **Photon (komoot)** para geocodificação de endereços, restrita à bbox de São Paulo.
- **OpenFreeMap** para os tiles do mapa base.
- **dadoscrimesp.com.br**: referência complementar com dados agregados por
  delegacia. Serve como contexto e **não é usado no roteamento**.

## Como funciona

1. **Pipeline (offline)**: baixa as planilhas da SSP-SP, filtra ocorrências da
   capital com coordenadas válidas e as classifica em categorias.
2. **Modelo de risco**: agrega as ocorrências em uma grade H3 (resolução 9,
   ~174 m de aresta). Cada ocorrência soma um peso por categoria e modo
   (a pé ou carro), com decaimento temporal (meia-vida de 12 meses, janela de
   24 meses), por período do dia. A pontuação é normalizada em escala logarítmica
   entre 0 e 1.
3. **Grafo viário**: a rede do OSM recebe, em cada trecho, tempo de percurso e o
   risco médio para cada período.
4. **Roteamento**: Dijkstra (igraph) com custo `tempo × (1 + α · risco)`. Os
   perfis usam α = 0 (mais rápida), 2 (equilibrada) e 6 (mais segura). Rotas
   quase idênticas são descartadas, e alternativas só aparecem se reduzirem a
   exposição em pelo menos 5%.
5. **API** em FastAPI, que também serve o frontend.
6. **Frontend** estático (MapLibre GL JS e h3-js), sem etapa de build.

O contrato completo entre as partes (formato de dados, esquema da API, regras
de risco) está em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Requisitos

- [Python](https://www.python.org/) 3.11 ou mais recente.
- [uv](https://docs.astral.sh/uv/) para gerenciar dependências e executar os scripts.
- Espaço em disco: as planilhas da SSP somam centenas de MB por ano, e os
  arquivos intermediários e grafos ocupam mais espaço.
- Tempo: a primeira construção do grafo a partir do OSM leva cerca de 10 a 15
  minutos.
- Conexão com a internet para baixar dados e para geocodificação e tiles em uso.

## Instalação e execução

Execute os comandos na raiz do projeto:

```bash
uv sync
uv run python -m pipeline.download_ssp --years 2025 2026
uv run python -m pipeline.build_risk
uv run python -m pipeline.build_graph
uv run uvicorn backend.app.main:app --reload
```

Depois, abra <http://localhost:8000> no navegador. O uvicorn usa a porta 8000
por padrão.

### Comandos úteis

- **Refazer só o risco**, depois de reconstruir o modelo de risco, sem reprocessar
  o OSM (reutiliza `graph_{mode}.npz` já existente):

  ```bash
  uv run python -m pipeline.build_graph --risk-only
  ```

- **Testes**:

  ```bash
  uv run pytest
  ```

- **Desenvolvimento só do frontend**: abra <http://localhost:8000/?mock=1>. Nesse
  modo, `frontend/js/api.js` usa respostas falsas de `frontend/js/mock.js` em vez
  de chamar a API, o que permite trabalhar na interface sem os dados processados.

## API

Todos os endpoints ficam sob o prefixo `/api`. O formato detalhado de cada um
está em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md), seção 5.

- `GET /api/health`: status do servidor e tamanho dos grafos carregados.
- `GET /api/meta`: metadados do modelo de risco, perfis e períodos disponíveis.
- `GET /api/geocode?q=...`: busca de endereços dentro de São Paulo.
- `POST /api/routes`: calcula as rotas entre origem e destino, para um modo e período.
- `GET /api/risk?bbox=...&mode=...&period=...`: células H3 com risco, para a camada de calor.

## Estrutura do projeto

```
SampaNav/
├── pyproject.toml          # projeto Python único (uv)
├── uv.lock
├── docs/
│   └── ARQUITETURA.md      # contrato entre pipeline, API e frontend
├── pipeline/               # scripts offline
│   ├── config.py           # pesos, categorias, períodos e caminhos
│   ├── download_ssp.py     # baixa as planilhas da SSP-SP
│   ├── build_risk.py       # ocorrências -> grade H3 de risco
│   └── build_graph.py      # rede OSM + risco -> grafos por modo
├── backend/
│   ├── app/
│   │   ├── main.py         # FastAPI; também serve o frontend em /
│   │   ├── routing.py      # carga dos grafos e cálculo de rotas
│   │   └── geocode.py      # proxy para o Photon, com bbox de SP
│   └── tests/
├── frontend/               # HTML, CSS e JS estáticos, sem build
│   ├── index.html
│   ├── img/logo.svg        # logo e favicon
│   ├── css/
│   └── js/
│       ├── api.js          # chamadas à API (ou mock, com ?mock=1)
│       ├── mock.js         # respostas falsas para desenvolvimento
│       ├── map.js          # mapa, rotas e camada de calor
│       ├── ui.js           # painel, busca e cartões de rota
│       ├── format.js
│       └── main.js
└── data/                   # gitignored
    ├── raw/                # planilhas da SSP e arquivos do OSM
    └── processed/          # saídas do pipeline (parquet, npz, json)
```

## Créditos

O SampaNav nasceu de um protótipo desenvolvido em hackathon (DustNav), feito
pela equipe original do projeto. A versão atual é uma reescrita focada em
roteamento com dados criminais reais de São Paulo.
