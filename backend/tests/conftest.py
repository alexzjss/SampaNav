"""Fixtures: grafo sintético minúsculo (grade 6x6) no formato dos graph_*.npz."""

import numpy as np
import pytest

from pipeline.config import PERIODS

LAT0, LON0, STEP = -23.552, -46.640, 0.001  # ~111 m por passo
N = 6


def nid(r, c):
    return r * N + c


def make_arrays(risky_row0: bool = True, risk_noite_only: bool = False, oneway: bool = False):
    lat = np.array([LAT0 - r * STEP for r in range(N) for c in range(N)])
    lon = np.array([LON0 + c * STEP for r in range(N) for c in range(N)])
    eu, ev, row0 = [], [], []

    def add(a, b):
        eu.append(a)
        ev.append(b)
        row0.append(a < N and b < N)  # aresta da linha 0

    for r in range(N):
        for c in range(N):
            for dr, dc in ((0, 1), (1, 0)):
                rr, cc = r + dr, c + dc
                if rr < N and cc < N:
                    add(nid(r, c), nid(rr, cc))
                    if not (oneway and dr == 0):
                        add(nid(rr, cc), nid(r, c))
    eu, ev, row0 = np.array(eu, np.int32), np.array(ev, np.int32), np.array(row0)
    # comprimento real
    dy = (lat[eu] - lat[ev]) * 111_320
    dx = (lon[eu] - lon[ev]) * 111_320 * np.cos(np.radians(-23.55))
    length = np.hypot(dx, dy).astype(np.float32)
    ttime = (length / 1.3).astype(np.float32)
    coords = np.stack([np.column_stack([lon[eu], lat[eu]]), np.column_stack([lon[ev], lat[ev]])], axis=1)
    geom = coords.reshape(-1, 2).astype(np.float32)
    offsets = np.arange(0, 2 * len(eu) + 1, 2, dtype=np.int64)
    risk = np.where(row0 & risky_row0, 0.9, 0.05).astype(np.float32)
    out = dict(
        node_id=np.arange(N * N, dtype=np.int64),
        node_lat=lat,
        node_lon=lon,
        edge_u=eu,
        edge_v=ev,
        length_m=length,
        travel_time_s=ttime,
        geom_offsets=offsets,
        geom_coords=geom,
    )
    for p in PERIODS:
        zero = risk_noite_only and p != "noite"
        out[f"risk_{p}"] = np.zeros_like(risk) if zero else risk
    return out


@pytest.fixture
def grid():
    return make_arrays()


@pytest.fixture
def data_dir(tmp_path):
    np.savez(tmp_path / "graph_walk.npz", **make_arrays())
    return tmp_path


# origem = canto (0,0), destino = canto (0,5) => rota direta passa pela linha 0
ORIGIN = (LAT0, LON0)
DEST = (LAT0, LON0 + 5 * STEP)
