"""Carga dos grafos, snap, roteamento por perfis de risco e métricas de rota."""

from __future__ import annotations

import json
import math
import threading
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from backend.app.steps import build_steps
from pipeline.config import DATA_PROCESSED, H3_RES, PERIODS, SP_BBOX

M_PER_DEG = 111_320.0
COSLAT = math.cos(math.radians(-23.55))

# (id, rótulo, alpha)
PROFILES = [
    ("rapida", "Mais rápida", 0.0),
    ("equilibrada", "Equilibrada", 2.0),
    ("segura", "Mais segura", 6.0),
]
ALPHA_MAX = 15.0
ALPHA_LADDER = [2.0, 3.0, 4.5, 6.0, 9.0, 12.0, ALPHA_MAX]
OVERLAP_MAX = 0.90
# Uma alternativa só aparece se reduzir a exposição em pelo menos 5% frente à
# rota menos exposta já escolhida; senão é só um desvio sem ganho de segurança.
MIN_EXPOSURE_GAIN = 0.05
MAX_SNAP_M = 1000.0
SEGMENT_BIN = 0.1
SEGMENT_MIN_M = 40.0
CATEGORY_STEP_M = 30.0


class RoutingError(Exception):
    """Erro de roteamento mapeado para HTTP 400."""


# Níveis relativos à cidade: quantis do risco das ruas, ponderados por comprimento.
# Ex.: "alto" = risco médio acima de 75% da malha viária naquele modo/período.
LEVEL_QUANTILES = (0.50, 0.75, 0.90)
DEFAULT_LEVEL_THRESHOLDS = (0.15, 0.35, 0.6)
LEVELS = ("baixo", "moderado", "alto", "muito alto")


def risk_level(avg: float, thresholds=DEFAULT_LEVEL_THRESHOLDS) -> str:
    for level, limit in zip(LEVELS, thresholds, strict=False):
        if avg < limit:
            return level
    return LEVELS[-1]


def weighted_quantiles(values: np.ndarray, weights: np.ndarray, qs) -> tuple[float, ...]:
    order = np.argsort(values)
    cw = np.cumsum(weights[order])
    if cw.size == 0 or cw[-1] <= 0:
        return DEFAULT_LEVEL_THRESHOLDS
    idx = np.minimum(np.searchsorted(cw / cw[-1], qs), len(order) - 1)
    return tuple(float(values[order][i]) for i in idx)


def in_bbox(lat: float, lon: float) -> bool:
    return SP_BBOX[0] <= lon <= SP_BBOX[2] and SP_BBOX[1] <= lat <= SP_BBOX[3]


# --------------------------------------------------------------------------- #
# Risco por célula H3
# --------------------------------------------------------------------------- #
def _parse_tc(raw) -> dict[str, int]:
    if not raw:
        return {}
    try:
        d = json.loads(raw) if isinstance(raw, str) else dict(raw)
        return {str(k): int(v) for k, v in d.items()}
    except (ValueError, TypeError):
        return {}


class RiskStore:
    """Índice do risk_hex.parquet por (mode, period): chaves int ordenadas.

    Compacto: chaves uint64, risco float32 e `top_categories` codificado como índice
    int32 numa tabela de dicts únicos (poucos milhares), em vez de uma string por linha.
    """

    def __init__(self, table=None):
        self.groups: dict[tuple[str, str], dict] = {}
        self._centers: dict[tuple[str, str], tuple[np.ndarray, np.ndarray]] = {}
        self._lock = threading.Lock()
        self._tc_tab: list[dict] = [{}]
        if table is None or table.num_rows == 0:
            return
        tc_ids = None
        if "top_categories" in table.column_names:
            enc = table.column("top_categories").combine_chunks().dictionary_encode()
            tc_ids = enc.indices.fill_null(0).to_numpy(zero_copy_only=False).astype(np.int32) + 1
            self._tc_tab = [{}] + [_parse_tc(x) for x in enc.dictionary.to_pylist()]
        h3s = table.column("h3").to_pylist()
        keys_all = hex_to_uint64(h3s)
        del h3s
        risk_all = table.column("risk").to_numpy().astype(np.float32)
        mode_all = np.asarray(table.column("mode").to_pylist(), dtype=object)
        period_all = np.asarray(table.column("period").to_pylist(), dtype=object)
        for mode in np.unique(mode_all):
            for period in np.unique(period_all[mode_all == mode]):
                sel = np.nonzero((mode_all == mode) & (period_all == period))[0]
                order = sel[np.argsort(keys_all[sel], kind="stable")]
                self.groups[(str(mode), str(period))] = dict(
                    keys=keys_all[order],
                    risk=risk_all[order],
                    tc=tc_ids[order] if tc_ids is not None else None,
                )

    @classmethod
    def from_parquet(cls, path: Path) -> RiskStore:
        if not path.exists():
            return cls(None)
        import pyarrow.parquet as pq

        names = set(pq.ParquetFile(path).schema_arrow.names)
        cols = [c for c in ("h3", "mode", "period", "risk", "top_categories") if c in names]
        return cls(pq.read_table(path, columns=cols))

    def categories(self, mode: str, period: str, cells: np.ndarray) -> dict[str, int]:
        g = self.groups.get((mode, period))
        if g is None or g["tc"] is None or len(cells) == 0:
            return {}
        pos = np.minimum(np.searchsorted(g["keys"], cells), len(g["keys"]) - 1)
        hit = g["keys"][pos] == cells
        out: dict[str, int] = {}
        for i in g["tc"][pos[hit]].tolist():
            for k, v in self._tc_tab[i].items():
                out[k] = out.get(k, 0) + v
        return dict(sorted(out.items(), key=lambda kv: -kv[1]))

    def cells_in_bbox(self, mode, period, bbox, min_risk=0.05, limit=20000):
        import h3.api.basic_int as h3i

        g = self.groups.get((mode, period))
        if g is None:
            return []
        with self._lock:
            if (mode, period) not in self._centers:
                sel = np.nonzero(g["risk"] >= min_risk)[0]
                ll = np.array([h3i.cell_to_latlng(int(c)) for c in g["keys"][sel]]).reshape(-1, 2)
                self._centers[(mode, period)] = (sel, ll)
        sel, ll = self._centers[(mode, period)]
        min_lon, min_lat, max_lon, max_lat = bbox
        m = (ll[:, 1] >= min_lon) & (ll[:, 1] <= max_lon) & (ll[:, 0] >= min_lat) & (ll[:, 0] <= max_lat)
        idx = sel[m]
        if len(idx) > limit:
            idx = idx[np.argsort(-g["risk"][idx])[:limit]]
        return [
            {"h3": h3i.int_to_str(int(g["keys"][i])), "risk": round(float(g["risk"][i]), 3)} for i in idx
        ]


# --------------------------------------------------------------------------- #
# Grafo
# --------------------------------------------------------------------------- #
@dataclass
class Route:
    id: str
    label: str
    alpha: float
    edges: np.ndarray
    distance_m: float
    duration_s: float
    exposure: float
    avg_risk: float
    coords: np.ndarray  # (n, 2) lon, lat
    extra: dict = field(default_factory=dict)


class _LazyThresholds(dict):
    """Limiares de nível por período, calculados na primeira consulta (ordenar 600 mil arestas
    para cada um dos 5 períodos custa ~0,4 s de CPU na partida)."""

    def __init__(self, graph):
        super().__init__()
        self._g = graph

    def __missing__(self, period):
        g = self._g
        v = weighted_quantiles(g.risk[period].astype(np.float64), g.length.astype(np.float64), LEVEL_QUANTILES)
        self[period] = v
        return v


def hex_to_uint64(strs: list[str]) -> np.ndarray:
    """Strings hex (H3, 15 chars) -> uint64, vetorizado."""
    if not strs:
        return np.zeros(0, np.uint64)
    a = np.array(strs, dtype="S16")
    raw = np.frombuffer(a.tobytes(), np.uint8).reshape(len(a), 16)
    lens = np.char.str_len(a)
    if lens.min() != lens.max():  # tamanhos mistos: caminho lento
        return np.fromiter((int(x, 16) for x in strs), np.uint64, len(strs))
    w = int(lens[0])
    d = raw[:, :w].astype(np.int64)
    d = np.where(d > 57, d - 87, d - 48).astype(np.uint64)  # '0'-'9', 'a'-'f'
    out = np.zeros(len(a), np.uint64)
    for i in range(w):
        out = (out << np.uint64(4)) | d[:, i]
    return out


class RoadGraph:
    def __init__(self, mode: str, a: dict, risk: RiskStore | None = None):
        import igraph as ig
        from scipy.spatial import cKDTree

        self.mode = mode
        self.risk_store = risk or RiskStore(None)
        self.node_lat = np.asarray(a["node_lat"], np.float64)
        self.node_lon = np.asarray(a["node_lon"], np.float64)
        self.n_nodes = len(self.node_lat)
        self.eu = np.asarray(a["edge_u"], np.int32)
        self.ev = np.asarray(a["edge_v"], np.int32)
        self.n_edges = len(self.eu)
        # float32 em repouso (metade da RAM); as contas são feitas em float64 sob demanda
        self.length = np.asarray(a["length_m"], np.float32)
        self.ttime = np.asarray(a["travel_time_s"], np.float32)
        self.risk = {p: np.asarray(a[f"risk_{p}"], np.float32) for p in PERIODS if f"risk_{p}" in a}
        self.level_thresholds = _LazyThresholds(self)
        self.offsets = np.asarray(a["geom_offsets"], np.int64)
        self.coords = np.asarray(a["geom_coords"], np.float32)
        # nomes/tipos de via (opcionais: grafos antigos não têm)
        if "edge_name" in a:
            self.edge_name = np.asarray(a["edge_name"], np.int32)
            self.name_table = [str(x) for x in a["name_table"].tolist()]
        else:
            self.edge_name, self.name_table = None, [""]
        if "edge_highway" in a:
            self.edge_highway = np.asarray(a["edge_highway"], np.uint8)
            self.highway_table = [str(x) for x in a["highway_table"].tolist()]
        else:
            self.edge_highway, self.highway_table = None, [""]
        self.g = ig.Graph(
            n=self.n_nodes,
            edges=np.stack([self.eu, self.ev], axis=1),
            directed=True,
        )
        # snap só em nós da maior componente fortemente conexa (evita ilhas/becos sem saída)
        memb = np.asarray(self.g.connected_components("strong").membership)
        self._snap_ids = np.nonzero(memb == np.bincount(memb).argmax())[0]
        del memb
        xy = np.column_stack([self.node_lon * COSLAT * M_PER_DEG, self.node_lat * M_PER_DEG])
        self.tree = cKDTree(xy[self._snap_ids])

    @classmethod
    def load(cls, mode: str, path: Path, risk: RiskStore | None = None) -> RoadGraph:
        with np.load(path) as z:
            return cls(mode, {k: z[k] for k in z.files}, risk)

    # -- snap ---------------------------------------------------------------
    def snap(self, lat: float, lon: float) -> int:
        d, i = self.tree.query([lon * COSLAT * M_PER_DEG, lat * M_PER_DEG])
        if d > MAX_SNAP_M:
            raise RoutingError("Não há rede viária próxima a este ponto.")
        return int(self._snap_ids[i])

    # -- pesos --------------------------------------------------------------
    def weights(self, period: str, alpha: float) -> list:
        """Pesos como lista Python (a forma mais rápida para o igraph). Não são cacheados:
        a lista de floats ocupa dezenas de MB e refazê-la custa ~20 ms, bem menos que o Dijkstra."""
        return (self.ttime.astype(np.float64) * (1.0 + alpha * self.risk[period].astype(np.float64))).tolist()

    def _path(self, src: int, dst: int, period: str, alpha: float) -> np.ndarray:
        p = self.g.get_shortest_paths(src, to=dst, weights=self.weights(period, alpha), output="epath")[0]
        return np.asarray(p, np.int64)

    # -- geometria ----------------------------------------------------------
    def edge_coords(self, e: int) -> np.ndarray:
        return self.coords[self.offsets[e] : self.offsets[e + 1]]

    def route_coords(self, edges: np.ndarray) -> np.ndarray:
        parts = [self.edge_coords(int(e)) for e in edges]
        out = [parts[0]] + [p[1:] for p in parts[1:]]
        return np.concatenate(out).astype(np.float64)

    # -- métricas -----------------------------------------------------------
    def _make_route(self, rid, label, alpha, edges, period) -> Route:
        L = self.length[edges].astype(np.float64)
        dist = float(L.sum())
        expo = float((L * self.risk[period][edges]).sum() / 1000.0)
        avg = expo / (dist / 1000.0) if dist > 0 else 0.0
        return Route(
            rid, label, alpha, edges, dist, float(self.ttime[edges].astype(np.float64).sum()), expo, avg, self.route_coords(edges)
        )

    def _overlap(self, edges: np.ndarray, chosen: list[Route]) -> float:
        if not chosen:
            return 0.0
        N = self.n_nodes
        keys = self.eu[edges].astype(np.int64) * N + self.ev[edges]
        used = set()
        for r in chosen:
            used.update((self.eu[r.edges].astype(np.int64) * N + self.ev[r.edges]).tolist())
        mask = np.fromiter((k in used for k in keys.tolist()), bool, len(keys))
        le = self.length[edges].astype(np.float64)
        tot = le.sum()
        return float(le[mask].sum() / tot) if tot > 0 else 1.0

    def routes(self, o: tuple[float, float], d: tuple[float, float], period: str) -> list[Route]:
        src, dst = self.snap(*o), self.snap(*d)
        if src == dst:
            raise RoutingError("Origem e destino estão muito próximos.")
        chosen: list[Route] = []
        cache: dict[float, np.ndarray] = {}

        def path(a: float) -> np.ndarray:
            if a not in cache:
                cache[a] = self._path(src, dst, period, a)
            return cache[a]

        for rid, label, alpha in PROFILES:
            a, prev = alpha, None
            while True:
                edges = path(a)
                if len(edges) == 0:
                    raise RoutingError("Não foi encontrado caminho entre origem e destino.")
                if self._overlap(edges, chosen) <= OVERLAP_MAX:
                    cand = self._make_route(rid, label, a, edges, period)
                    best = min((r.exposure for r in chosen), default=None)
                    if best is None or cand.exposure <= best * (1 - MIN_EXPOSURE_GAIN):
                        chosen.append(cand)
                        break
                if a >= ALPHA_MAX:
                    break  # desiste desta variante
                same_as_prev = prev is not None and np.array_equal(prev, edges)
                prev = edges
                # caminho idêntico ao da tentativa anterior: pula direto ao alpha máximo
                a = ALPHA_MAX if same_as_prev else next(x for x in ALPHA_LADDER if x > a)
        return chosen

    # -- extras (passos, categorias, segmentos) -----------------------------
    def steps(self, route: Route) -> list[dict]:
        edges = route.edges
        n = (self.offsets[edges + 1] - self.offsets[edges] - 1).astype(np.int64)
        starts = np.concatenate([[0], np.cumsum(n)[:-1]])
        if self.edge_name is not None:
            names = [self.name_table[i] for i in self.edge_name[edges].tolist()]
        else:
            names = [""] * len(edges)
        return build_steps(
            route.coords, starts, names, self.length[edges].astype(np.float64),
            self.ttime[edges].astype(np.float64), self.mode,
        )

    def categories(self, route: Route, period: str) -> dict[str, int]:
        import h3.api.basic_int as h3i

        c = route.coords
        if len(c) < 2:
            return {}
        dx = np.diff(c[:, 0]) * COSLAT * M_PER_DEG
        dy = np.diff(c[:, 1]) * M_PER_DEG
        sl = np.hypot(dx, dy)
        cum = np.concatenate([[0.0], np.cumsum(sl)])
        ts = np.arange(0, cum[-1] + CATEGORY_STEP_M, CATEGORY_STEP_M)
        lon = np.interp(ts, cum, c[:, 0])
        lat = np.interp(ts, cum, c[:, 1])
        cells = np.unique(
            np.fromiter((h3i.latlng_to_cell(a, b, H3_RES) for a, b in zip(lat.tolist(), lon.tolist(), strict=False)), np.uint64, len(lat))
        )
        return self.risk_store.categories(self.mode, period, cells)

    def segments(self, route: Route, period: str) -> list[dict]:
        rk = self.risk[period]
        segs: list[dict] = []  # cada: coords(list), len, riskxlen, bin
        for e in route.edges:
            e = int(e)
            c = self.edge_coords(e)
            r = float(rk[e])
            L = float(self.length[e])
            b = min(int(r / SEGMENT_BIN), int(1 / SEGMENT_BIN))
            if segs and segs[-1]["bin"] == b:
                s = segs[-1]
                s["c"].append(c[1:])
            else:
                segs.append({"c": [c], "bin": b, "len": 0.0, "rl": 0.0})
                s = segs[-1]
            s["len"] += L
            s["rl"] += r * L
        # funde trechos muito curtos no vizinho anterior (ou seguinte)
        merged: list[dict] = []
        for s in segs:
            if merged and (s["len"] < SEGMENT_MIN_M or merged[-1]["len"] < SEGMENT_MIN_M):
                p = merged[-1]
                p["c"].append(s["c"][0][1:])
                p["c"].extend(s["c"][1:])
                p["len"] += s["len"]
                p["rl"] += s["rl"]
                p["bin"] = s["bin"] if s["len"] > p["len"] - s["len"] else p["bin"]
            else:
                merged.append(s)
        out = []
        for s in merged:
            arr = np.concatenate(s["c"]).astype(np.float64)
            # remove pontos consecutivos duplicados (junções)
            keep = np.ones(len(arr), bool)
            keep[1:] = np.any(arr[1:] != arr[:-1], axis=1)
            arr = arr[keep]
            if len(arr) < 2:
                continue
            out.append(
                {
                    "coordinates": np.round(arr, 6).tolist(),
                    "risk": round(s["rl"] / s["len"], 3) if s["len"] > 0 else 0.0,
                }
            )
        return out


# --------------------------------------------------------------------------- #
# Fachada usada pela API
# --------------------------------------------------------------------------- #
def find_risk_parquet(processed: Path) -> Path | None:
    for name in ("risk_hex.parquet", "risk_hex_synthetic.parquet"):
        if (processed / name).exists():
            return processed / name
    return None


def trim_memory() -> None:
    """Devolve ao SO páginas livres do heap (glibc); no-op em outras plataformas."""
    try:
        import ctypes

        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except (OSError, AttributeError):
        pass


class Engine:
    def __init__(self, processed: Path = DATA_PROCESSED, modes=("walk", "drive"), load: bool = True):
        self.processed = Path(processed)
        self.modes = tuple(modes)
        self.graphs: dict[str, RoadGraph] = {}
        self.missing: list[str] = []
        self.risk_path = None
        self.risk_store = RiskStore(None)
        self.meta: dict = {}
        self.ready = threading.Event()
        self._lock = threading.Lock()  # um cálculo por vez: limita o pico de memória
        if load:
            self.load()

    def load(self) -> None:
        self.risk_path = find_risk_parquet(self.processed)
        self.risk_store = RiskStore.from_parquet(self.risk_path) if self.risk_path else RiskStore(None)
        self.meta = self._load_meta()
        for m in self.modes:
            p = self.processed / f"graph_{m}.npz"
            if p.exists():
                self.graphs[m] = RoadGraph.load(m, p, self.risk_store)
            else:
                self.missing.append(m)
        trim_memory()
        self.ready.set()

    def _load_meta(self) -> dict:
        p = self.processed / "risk_meta.json"
        if p.exists():
            try:
                return json.loads(p.read_text())
            except ValueError:
                pass
        return {"synthetic": True} if self.risk_path and "synthetic" in self.risk_path.name else {}

    def compute(self, mode: str, o, d, period: str) -> list[dict]:
        g = self.graphs.get(mode)
        if g is None:
            raise RoutingError(f"Grafo '{mode}' não carregado.")
        for lat, lon in (o, d):
            if not in_bbox(lat, lon):
                raise RoutingError("Ponto fora da cidade de São Paulo.")
        with self._lock:
            routes = g.routes(o, d, period)
            out = self._serialize(g, routes, period)
        trim_memory()
        return out

    def _serialize(self, g: RoadGraph, routes: list[Route], period: str) -> list[dict]:
        base = routes[0]
        out = []
        for r in routes:
            dpct = (r.duration_s - base.duration_s) / base.duration_s * 100 if base.duration_s else 0.0
            epct = (r.exposure - base.exposure) / base.exposure * 100 if base.exposure else 0.0
            out.append(
                {
                    "id": r.id,
                    "label": r.label,
                    "alpha": round(r.alpha, 2),
                    "distance_m": round(r.distance_m, 1),
                    "duration_s": int(round(r.duration_s)),
                    "exposure": round(r.exposure, 3),
                    "avg_risk": round(r.avg_risk, 3),
                    "risk_level": risk_level(r.avg_risk, g.level_thresholds[period]),
                    "vs_fastest": {"duration_pct": round(dpct, 1), "exposure_pct": round(epct, 1)},
                    "categories": g.categories(r, period),
                    "geometry": {"type": "LineString", "coordinates": np.round(r.coords, 6).tolist()},
                    "segments": g.segments(r, period),
                    "steps": g.steps(r),
                }
            )
        return out
