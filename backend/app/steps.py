"""Passos de navegação (manobras) a partir das arestas de uma rota."""

from __future__ import annotations

import math
import unicodedata

import numpy as np

M_PER_DEG = 111_320.0
COSLAT = math.cos(math.radians(-23.55))

CONTINUE_DEG = 20.0
SLIGHT_DEG = 60.0
NORMAL_DEG = 135.0
SHARP_DEG = 170.0
BEARING_WINDOW_M = 20.0  # distância usada para estimar a direção antes/depois da junção
MIN_LINK_M = 30.0  # trechos sem nome mais curtos que isto (ligações) são absorvidos pelo passo seguinte

MANEUVERS = (
    "depart", "continue", "slight-left", "left", "sharp-left",
    "slight-right", "right", "sharp-right", "uturn", "arrive",
)

# primeiro termo do nome -> gênero (para "na/no", "pela/pelo")
_FEM = {
    "rua", "r", "avenida", "av", "alameda", "al", "travessa", "tv", "praca", "pca", "pc", "ladeira",
    "estrada", "est", "viela", "rodovia", "rod", "ponte", "passarela", "escadaria", "via", "marginal",
    "vila", "passagem", "galeria", "ciclovia", "calcada", "rotatoria", "servidao", "trilha",
}
_MASC = {
    "largo", "viaduto", "beco", "tunel", "parque", "elevado", "corredor", "complexo", "jardim",
    "caminho", "passeio", "terminal", "calcadao", "acesso", "trecho", "boulevard", "mercado",
}

_TURN_TEXT = {
    "slight-left": "Vire levemente à esquerda",
    "left": "Vire à esquerda",
    "sharp-left": "Faça uma curva fechada à esquerda",
    "slight-right": "Vire levemente à direita",
    "right": "Vire à direita",
    "sharp-right": "Faça uma curva fechada à direita",
}


def classify(angle_deg: float) -> str:
    """Manobra a partir do ângulo assinado (positivo = giro à direita, graus)."""
    a = abs(angle_deg)
    if a < CONTINUE_DEG:
        return "continue"
    if a < SLIGHT_DEG:
        side = "slight"
    elif a < NORMAL_DEG:
        side = ""
    elif a < SHARP_DEG:
        side = "sharp"
    else:
        return "uturn"
    d = "right" if angle_deg > 0 else "left"
    return f"{side}-{d}" if side else d


def _gender(name: str) -> str | None:
    w = unicodedata.normalize("NFKD", name.split(" ", 1)[0]).encode("ascii", "ignore").decode().lower().strip(".")
    if w in _FEM:
        return "f"
    if w in _MASC:
        return "m"
    return None


def fmt_dist(m: float) -> str:
    if m < 1000:
        v = int(round(m)) if m < 20 else int(round(m / 10.0) * 10)
        return f"{max(v, 1)} m"
    return f"{m / 1000.0:.1f}".replace(".", ",") + " km"


def _place(name: str, mode: str, prep: str) -> str:
    """'na Rua X' / 'pela Rua X'; sem nome: 'no caminho' (a pé) ou 'na via sem nome'."""
    if name:
        g = _gender(name)
        art = {"em": {"f": "na", "m": "no", None: "em"}, "por": {"f": "pela", "m": "pelo", None: "por"}}[prep][g]
        return f"{art} {name}"
    base = {"em": ("no", "na"), "por": ("pelo", "pela")}[prep]
    return f"{base[0]} caminho" if mode == "walk" else f"{base[1]} via sem nome"


def instruction(maneuver: str, name: str, dist_m: float, mode: str) -> str:
    if maneuver == "arrive":
        return "Chegada ao destino"
    if maneuver == "depart":
        return f"Siga {_place(name, mode, 'por')} por {fmt_dist(dist_m)}"
    if maneuver == "continue":
        return f"Continue {_place(name, mode, 'por')} por {fmt_dist(dist_m)}"
    if maneuver == "uturn":
        return f"Faça o retorno {_place(name, mode, 'em')}"
    return f"{_TURN_TEXT[maneuver]} {_place(name, mode, 'em')}"


def _bearing(dx: float, dy: float) -> float | None:
    return None if dx == 0.0 and dy == 0.0 else math.atan2(dx, dy)  # rad, 0 = norte, horário


def turn_angle(xy: np.ndarray, cum: np.ndarray, j: int) -> float:
    """Ângulo assinado (graus, + = direita) da rota na junção j (índice nas coordenadas)."""
    n = len(xy)
    i0 = max(int(np.searchsorted(cum, cum[j] - BEARING_WINDOW_M, side="right")) - 1, 0)
    i1 = min(int(np.searchsorted(cum, cum[j] + BEARING_WINDOW_M, side="left")), n - 1)
    # se a janela cair em pontos coincidentes, recua/avança até achar direção válida
    while i0 > 0 and xy[i0, 0] == xy[j, 0] and xy[i0, 1] == xy[j, 1]:
        i0 -= 1
    while i1 < n - 1 and xy[i1, 0] == xy[j, 0] and xy[i1, 1] == xy[j, 1]:
        i1 += 1
    b_in = _bearing(xy[j, 0] - xy[i0, 0], xy[j, 1] - xy[i0, 1])
    b_out = _bearing(xy[i1, 0] - xy[j, 0], xy[i1, 1] - xy[j, 1])
    if b_in is None or b_out is None:
        return 0.0
    d = math.degrees(b_out - b_in)
    return (d + 180.0) % 360.0 - 180.0


def build_steps(
    coords: np.ndarray,
    edge_starts: np.ndarray,
    names: list[str],
    lengths: np.ndarray,
    times: np.ndarray,
    mode: str,
) -> list[dict]:
    """Passos da rota.

    coords: (n, 2) lon/lat da rota; edge_starts[k]: índice em coords onde a aresta k começa;
    names/lengths/times: por aresta, na ordem da rota.
    """
    k = len(names)
    if k == 0 or len(coords) < 2:
        return []
    xy = np.column_stack([coords[:, 0] * COSLAT * M_PER_DEG, coords[:, 1] * M_PER_DEG])
    seg = np.hypot(np.diff(xy[:, 0]), np.diff(xy[:, 1]))
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    turns = [0.0] + [turn_angle(xy, cum, int(edge_starts[i])) for i in range(1, k)]

    # 1. agrupa arestas consecutivas
    groups: list[list[int]] = [[0]]
    for i in range(1, k):
        same = (names[i] == names[i - 1] and names[i] != "") or (
            names[i] == "" and names[i - 1] == "" and abs(turns[i]) < CONTINUE_DEG
        )
        if same:
            groups[-1].append(i)
        else:
            groups.append([i])

    # 2. absorve ligações curtas sem nome (exceto primeiro/último) no passo seguinte
    out_groups: list[list[int]] = []
    pending: list[int] = []
    for gi, g in enumerate(groups):
        name = names[g[0]]
        dist = float(np.sum(lengths[g]))
        if gi not in (0, len(groups) - 1) and name == "" and dist < MIN_LINK_M and not pending:
            pending = g
            continue
        out_groups.append(pending + g)
        pending = []
    if pending:
        out_groups.append(pending)

    steps: list[dict] = []
    for gi, g in enumerate(out_groups):
        # nome do passo: o do trecho mais longo com nome (ou o da última aresta nomeada)
        nm = next((names[e] for e in g if names[e]), "")
        dist = float(np.sum(lengths[g]))
        dur = float(np.sum(times[g]))
        j = int(edge_starts[g[0]])
        man = "depart" if gi == 0 else classify(turns[g[0]])
        steps.append(
            {
                "maneuver": man,
                "instruction": instruction(man, nm, dist, mode),
                "street": nm,
                "distance_m": round(dist, 1),
                "duration_s": int(round(dur)),
                "location": [round(float(coords[j, 0]), 6), round(float(coords[j, 1]), 6)],
                "geometry_index": j,
            }
        )
    last = len(coords) - 1
    steps.append(
        {
            "maneuver": "arrive",
            "instruction": instruction("arrive", "", 0.0, mode),
            "street": "",
            "distance_m": 0.0,
            "duration_s": 0,
            "location": [round(float(coords[last, 0]), 6), round(float(coords[last, 1]), 6)],
            "geometry_index": last,
        }
    )
    return steps
