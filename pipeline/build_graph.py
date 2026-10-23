"""Constrói os grafos viários (walk/drive) com risco por período.

Uso:
    uv run python -m pipeline.build_graph [--modes walk drive] [--synthetic-risk]
    uv run python -m pipeline.build_graph --risk-only [--synthetic-risk]

Etapas:
  1. build_structure(mode): OSMnx -> arrays (nós, arestas, geometria). Cacheia o
     graphml em data/raw/osm_{mode}.graphml. Escreve data/processed/graph_{mode}.npz
     com risk_* zerado.
  2. join_risk(mode): lê o npz existente (sem OSM), amostra o risco H3 a cada ~25 m
     ao longo da geometria de cada aresta e regrava os arrays risk_<periodo>.
     É a etapa barata: `--risk-only`.
"""

from __future__ import annotations

import argparse
import json
import math
import time

import numpy as np
import pandas as pd

from pipeline.config import DATA_PROCESSED, DATA_RAW, H3_RES, MODES, PERIODS

PLACE = "São Paulo, São Paulo, Brazil"
WALK_SPEED_MS = 1.3
SAMPLE_STEP_M = 25.0
M_PER_DEG = 111_320.0

RISK_PARQUET = DATA_PROCESSED / "risk_hex.parquet"
SYNTH_PARQUET = DATA_PROCESSED / "risk_hex_synthetic.parquet"


def graph_path(mode: str):
    return DATA_PROCESSED / f"graph_{mode}.npz"


def graphml_path(mode: str):
    return DATA_RAW / f"osm_{mode}.graphml"


# --------------------------------------------------------------------------- #
# 1. Estrutura do grafo
# --------------------------------------------------------------------------- #
def load_osm_graph(mode: str):
    import osmnx as ox

    ox.settings.cache_folder = str(DATA_RAW / "osmnx_cache")
    ox.settings.requests_timeout = 600
    p = graphml_path(mode)
    if p.exists():
        print(f"[{mode}] lendo {p.name} ...", flush=True)
        return ox.load_graphml(p)
    print(f"[{mode}] baixando rede OSM de '{PLACE}' (lento) ...", flush=True)
    DATA_RAW.mkdir(parents=True, exist_ok=True)
    G = ox.graph_from_place(PLACE, network_type=mode, simplify=True, retain_all=False)
    if mode == "drive":
        G = ox.add_edge_speeds(G)
        G = ox.add_edge_travel_times(G)
    print(f"[{mode}] salvando {p.name} ...", flush=True)
    ox.save_graphml(G, p)
    return G


def build_structure(mode: str) -> dict:
    G = load_osm_graph(mode)
    if mode == "drive" and not any("travel_time" in d for _, _, d in G.edges(data=True)):
        import osmnx as ox

        G = ox.add_edge_travel_times(ox.add_edge_speeds(G))

    node_ids = np.fromiter(G.nodes, dtype=np.int64, count=G.number_of_nodes())
    idx = {nid: i for i, nid in enumerate(node_ids.tolist())}
    node_lat = np.empty(len(node_ids), np.float64)
    node_lon = np.empty(len(node_ids), np.float64)
    for nid, d in G.nodes(data=True):
        i = idx[nid]
        node_lat[i], node_lon[i] = d["y"], d["x"]

    m = G.number_of_edges()
    eu = np.empty(m, np.int32)
    ev = np.empty(m, np.int32)
    length = np.empty(m, np.float32)
    ttime = np.empty(m, np.float32)
    offsets = np.zeros(m + 1, np.int64)
    chunks: list[np.ndarray] = []
    for k, (u, v, d) in enumerate(G.edges(data=True)):
        iu, iv = idx[u], idx[v]
        eu[k], ev[k] = iu, iv
        L = float(d.get("length", 0.0))
        length[k] = L
        if mode == "walk":
            ttime[k] = L / WALK_SPEED_MS
        else:
            ttime[k] = float(d.get("travel_time", L / 8.3))
        g = d.get("geometry")
        if g is not None:
            c = np.asarray(g.coords, dtype=np.float64)[:, :2]  # lon, lat
        else:
            c = np.array([[node_lon[iu], node_lat[iu]], [node_lon[iv], node_lat[iv]]])
        chunks.append(c)
        offsets[k + 1] = offsets[k] + len(c)
    coords = np.concatenate(chunks).astype(np.float32)
    del chunks, G
    out = dict(
        node_id=node_ids,
        node_lat=node_lat.astype(np.float64),
        node_lon=node_lon.astype(np.float64),
        edge_u=eu,
        edge_v=ev,
        length_m=length,
        travel_time_s=ttime,
        geom_offsets=offsets,
        geom_coords=coords,
    )
    for p in PERIODS:
        out[f"risk_{p}"] = np.zeros(m, np.float32)
    return out


# --------------------------------------------------------------------------- #
# 2. Junção de risco
# --------------------------------------------------------------------------- #
def sample_edges(offsets: np.ndarray, coords: np.ndarray):
    """Amostra pontos a cada ~25 m (pontos médios) ao longo de cada aresta.

    Retorna (edge_idx, lat, lon) de todas as amostras (vetorizado).
    """
    m = len(offsets) - 1
    cnt = np.diff(offsets)
    lon = coords[:, 0].astype(np.float64)
    lat = coords[:, 1].astype(np.float64)
    coslat = math.cos(math.radians(-23.55))
    dx = np.diff(lon) * coslat * M_PER_DEG
    dy = np.diff(lat) * M_PER_DEG
    seglen = np.hypot(dx, dy)
    # zera segmentos que cruzam a fronteira entre arestas
    bound = offsets[1:-1] - 1  # último índice de cada aresta (exceto a final)
    seglen[bound[(bound >= 0) & (bound < len(seglen))]] = 0.0
    C = np.concatenate([[0.0], np.cumsum(seglen)])
    start = offsets[:-1]
    end_idx = offsets[1:] - 1
    geom_len = C[end_idx] - C[start]
    n = np.maximum(1, np.ceil(geom_len / SAMPLE_STEP_M)).astype(np.int64)
    edge_idx = np.repeat(np.arange(m), n)
    first = np.cumsum(n) - n
    k = np.arange(n.sum()) - np.repeat(first, n)
    frac = (k + 0.5) / n[edge_idx]
    t = C[start][edge_idx] + frac * geom_len[edge_idx]
    seg = np.searchsorted(C, t, side="right") - 1
    lo = start[edge_idx]
    hi = np.maximum(lo, end_idx[edge_idx] - 1)
    seg = np.clip(seg, lo, hi)
    sl = seglen[np.minimum(seg, len(seglen) - 1)]
    with np.errstate(invalid="ignore", divide="ignore"):
        w = np.where(sl > 0, (t - C[seg]) / sl, 0.0)
    w = np.clip(w, 0, 1)
    nxt = np.minimum(seg + 1, len(lon) - 1)
    return edge_idx, lat[seg] + w * (lat[nxt] - lat[seg]), lon[seg] + w * (lon[nxt] - lon[seg])


def _cells(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    import h3.api.basic_int as h3i

    f = h3i.latlng_to_cell
    return np.fromiter((f(a, b, H3_RES) for a, b in zip(lat.tolist(), lon.tolist())), np.uint64, len(lat))


def synthetic_field(lat, lon, salt: float = 0.0):
    """Ruído espacial suave em [0,1] (soma de senoides + hotspots)."""
    x = (np.asarray(lon) + 46.63) * 40
    y = (np.asarray(lat) + 23.55) * 40
    f = (
        np.sin(x * 1.3 + salt)
        + np.sin(y * 1.7 - salt)
        + np.sin((x + y) * 0.9 + 2 * salt)
        + np.sin((x - 2 * y) * 0.6)
    )
    f = (f + 4) / 8
    return np.clip(f**2.6 * 1.1, 0, 1)


def make_synthetic_parquet(cells: np.ndarray, only_mode: str) -> None:
    import h3.api.basic_int as h3i

    uniq = np.unique(cells)
    ll = np.array([h3i.cell_to_latlng(int(c)) for c in uniq])
    strs = [h3i.int_to_str(int(c)) for c in uniq]
    rng = np.random.default_rng(0)
    rows = []
    cats = ["roubo_pessoa", "furto_pessoa", "lesao"]
    for mi, mode in enumerate(MODES):
        if mode != only_mode:
            continue
        for pi, period in enumerate(PERIODS):
            r = synthetic_field(ll[:, 0], ll[:, 1], salt=mi * 0.7 + pi * 0.9)
            n = (r * 30).astype(int)
            tc = [
                json.dumps({c: int(x * w) for c, w in zip(cats, (0.5, 0.35, 0.15)) if int(x * w)})
                for x in n
            ]
            rows.append(
                pd.DataFrame(
                    dict(h3=strs, mode=mode, period=period, score=r * 10, risk=r, n=n, top_categories=tc)
                )
            )
    df = pd.concat(rows, ignore_index=True)
    df = df[df.risk > 0.01]
    if SYNTH_PARQUET.exists():  # preserva os outros modos
        old = pd.read_parquet(SYNTH_PARQUET)
        df = pd.concat([old[old["mode"] != only_mode], df], ignore_index=True)
    SYNTH_PARQUET.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(SYNTH_PARQUET, index=False)
    print(f"parquet sintético: {SYNTH_PARQUET} ({len(df)} linhas)", flush=True)


def join_risk(mode: str, synthetic: bool = False) -> None:
    p = graph_path(mode)
    with np.load(p) as z:
        data = {k: z[k] for k in z.files}
    t0 = time.time()
    edge_idx, lat, lon = sample_edges(data["geom_offsets"], data["geom_coords"])
    print(f"[{mode}] {len(lat)} amostras ({time.time()-t0:.1f}s)", flush=True)
    cells = _cells(lat, lon)
    print(f"[{mode}] células H3 calculadas ({time.time()-t0:.1f}s)", flush=True)
    if synthetic:
        make_synthetic_parquet(cells, mode)
        src = SYNTH_PARQUET
    else:
        src = RISK_PARQUET
        if not src.exists():
            raise SystemExit(f"{src} não existe; use --synthetic-risk ou rode build_risk antes.")
    import h3.api.basic_int as h3i

    df = pd.read_parquet(src, columns=["h3", "mode", "period", "risk"])
    df = df[df["mode"] == mode]
    m = len(data["length_m"])
    for period in PERIODS:
        d = df[df["period"] == period]
        if d.empty:
            data[f"risk_{period}"] = np.zeros(m, np.float32)
            continue
        keys = np.fromiter((h3i.str_to_int(s) for s in d["h3"]), np.uint64, len(d))
        order = np.argsort(keys)
        keys, vals = keys[order], d["risk"].to_numpy(np.float32)[order]
        pos = np.searchsorted(keys, cells)
        pos = np.minimum(pos, len(keys) - 1)
        hit = keys[pos] == cells
        s = np.where(hit, vals[pos], 0.0)
        tot = np.bincount(edge_idx, weights=s, minlength=m)
        cnt = np.bincount(edge_idx, minlength=m)
        data[f"risk_{period}"] = (tot / np.maximum(cnt, 1)).astype(np.float32)
    data["risk_source"] = np.array(src.name)
    np.savez_compressed(p, **data)
    print(
        f"[{mode}] risco gravado em {p.name} ({p.stat().st_size/1e6:.1f} MB, fonte {src.name}) "
        f"em {time.time()-t0:.1f}s",
        flush=True,
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--modes", nargs="+", default=MODES, choices=MODES)
    ap.add_argument("--synthetic-risk", action="store_true")
    ap.add_argument("--risk-only", action="store_true", help="reusa graph_{mode}.npz; só refaz o risco")
    a = ap.parse_args()
    DATA_PROCESSED.mkdir(parents=True, exist_ok=True)
    for mode in a.modes:
        t0 = time.time()
        if not a.risk_only:
            data = build_structure(mode)
            np.savez_compressed(graph_path(mode), **data)
            print(
                f"[{mode}] nós={len(data['node_id'])} arestas={len(data['edge_u'])} "
                f"estrutura em {time.time()-t0:.0f}s",
                flush=True,
            )
            del data
        join_risk(mode, a.synthetic_risk)
        print(f"[{mode}] pronto em {time.time()-t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
