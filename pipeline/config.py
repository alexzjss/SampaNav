"""Constantes compartilhadas do pipeline: caminhos, bbox de SP, H3, períodos e modos."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_RAW = ROOT / "data" / "raw"
DATA_PROCESSED = ROOT / "data" / "processed"

# (min_lon, min_lat, max_lon, max_lat)
SP_BBOX = (-46.83, -24.01, -46.36, -23.35)

H3_RES = 9
PERIODS = ["all", "madrugada", "manha", "tarde", "noite"]
MODES = ["walk", "drive"]

SSP_URL_TEMPLATE = (
    "https://www.ssp.sp.gov.br/assets/estatistica/transparencia/spDados/"
    "SPDadosCriminais_{year}.xlsx"
)

# Colunas lidas das planilhas (demais são descartadas)
OCC_COLUMNS = [
    "NUM_BO", "ANO_BO", "NOME_DELEGACIA", "DATA_OCORRENCIA_BO", "HORA_OCORRENCIA_BO",
    "DESC_PERIODO", "DESCR_TIPOLOCAL", "DESCR_SUBTIPOLOCAL", "LATITUDE", "LONGITUDE",
    "RUBRICA", "DESCR_CONDUTA", "NATUREZA_APURADA",
]

# ---------------------------------------------------------------------------
# Modelo de risco
# Todos os textos abaixo são comparados normalizados (minúsculas, sem acento)
# por substring, exceto TIPOLOCAL_ALLOW (igualdade).
# Valores levantados em 23/10/2026 nos dados de S.PAULO (2025-2026).
# ---------------------------------------------------------------------------
HALF_LIFE_DAYS = 365.0   # meia-vida do decaimento exponencial (w_t = 0.5 ** (idade/365))
WINDOW_DAYS = 730        # janela: ~24 meses antes da ocorrência mais recente
NEIGHBOR_FACTOR = 0.5    # peso dos vizinhos H3 (k=1) na suavização

CATEGORIES = [
    "roubo_pessoa", "furto_pessoa", "roubo_veiculo", "furto_veiculo", "lesao", "letal",
]
WEIGHTS = {
    "walk": {"roubo_pessoa": 3, "furto_pessoa": 1, "roubo_veiculo": 1,
             "furto_veiculo": 0, "lesao": 2, "letal": 10},
    "drive": {"roubo_pessoa": 1, "furto_pessoa": 0.3, "roubo_veiculo": 4,
              "furto_veiculo": 1.5, "lesao": 0.5, "letal": 5},
}

# Período do dia pela hora [início, fim)
PERIOD_HOURS = {"madrugada": (0, 6), "manha": (6, 12), "tarde": (12, 18), "noite": (18, 24)}
# DESC_PERIODO ('De madrugada', 'Pela manhã', 'A tarde', 'A noite'; 'Em hora incerta'/NULL ignorados)
DESC_PERIODO_MAP = {"madrugada": "madrugada", "manha": "manha", "tarde": "tarde", "noite": "noite"}

# DESCR_TIPOLOCAL aceitos: espaços abertos/públicos. Descartados: Residência, Condomínio *,
# Comércio e Serviços, Shopping, Restaurante, Ensino, Saúde, Banco, Internet, Prisional, etc.
# "Outros" (4%) tem subtipo "Outros", sem como separar; mantido (só entra se tiver lat/lon).
TIPOLOCAL_ALLOW = {
    "via publica", "terminal/estacao", "estacionamento/garagem", "rodovia/estrada",
    "area nao ocupada", "favela", "outros", "metroviario e ferroviario metropolitano",
}
# Subtipos descartados mesmo em tipolocal aceito (garagens privadas, interior de imóveis)
SUBTIPOLOCAL_DENY = [
    "garagem ou abrigo de residencia", "garagem coletiva", "casa", "apartamento",
    "moradia", "bar", "obra/construcao",
]

# RUBRICA (substring). Culposos de trânsito (303/302), drogas, armas, estupro (sem
# coordenadas), extorsão mediante sequestro e não criminais não casam e são descartados.
RUBRICA_ROUBO = ["roubo (art. 157)"]
RUBRICA_FURTO = ["furto (art. 155)"]
RUBRICA_LESAO = ["lesao corporal (art. 129)"]
RUBRICA_HOMICIDIO = ["homicidio (art. 121)"]   # só dolosos (ver NATUREZA_LETAL)
RUBRICA_LETAL = ["feminicidio"]

# NATUREZA_APURADA que marca crime letal / lesão dolosa
# Tentativa de homicídio conta como "letal" (peso cheio): a violência é a mesma,
# só o desfecho difere.
NATUREZA_LETAL = ["homicidio doloso", "latrocinio", "tentativa de homicidio"]   # inclui "...por acidente de transito" doloso
CONDUTA_LETAL_ROUBO = ["resulta morte"]               # roubo §3º I (latrocínio)
NATUREZA_LESAO = ["lesao corporal dolosa"]

# Veículo: DESCR_CONDUTA 'Veículo' / 'Interior de Veículo' ou NATUREZA 'ROUBO/FURTO DE VEÍCULO'
CONDUTA_VEICULO = ["veiculo"]
NATUREZA_VEICULO = ["de veiculo"]
# Descartes: carga (roubo de caminhões), residência/condomínio, estabelecimentos, cabos/energia
CONDUTA_CARGA = ["carga"]
NATUREZA_CARGA = ["de carga"]
CONDUTA_RESIDENCIA = [
    "residencia", "condominio", "estabelecimento", "joalheria", "caixa eletronico",
    "fios e cabos", "derivacao clandestina",
]

# Percentil que define risk = 1.0 na normalização logarítmica (ver build_risk.normalize_risk).
RISK_TOP_PERCENTILE = 99.9
