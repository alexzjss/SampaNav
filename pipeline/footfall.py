"""Proxy de movimento de pessoas a partir da malha viária a pé (sem rede).

Cada aresta de data/processed/graph_walk.npz contribui com
`peso(highway) × comprimento_km` para a célula H3 res 9 do seu ponto médio;
depois suavização k=1. Calçadões, corredores de metrô/ônibus e avenidas
principais pesam mais que ruas residenciais (ver config.STREET_FOOTFALL_WEIGHTS).

Substitui a versão por POIs do OSM: o Overpass público se mostrou instável
demais (502/504/timeouts) para um pipeline que roda todo mês.

Uso: python -m pipeline.footfall
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline import config as C


def street_weight(highway: str, rules: dict | None = None) -> float:
    """Peso por km de via do tipo `highway`; tipos ausentes usam o peso padrão."""
    rules = rules if rules is not None else C.STREET_FOOTFALL_WEIGHTS
    return float(rules.get(highway, C.STREET_FOOTFALL_DEFAULT))


def smooth_k1(values: dict[str, float], factor: float = C.NEIGHBOR_FACTOR) -> dict[str, float]:
    """Soma o valor de cada célula e `factor`× o dos vizinhos k=1."""
    import h3

    out = dict(values)
    for cell, v in values.items():
        for nb in h3.grid_disk(cell, 1):
            if nb != cell:
                out[nb] = out.get(nb, 0.0) + factor * v
    return out


def aggregate_footfall(lats, lons, weights) -> pd.Series:
    """Soma pesos por célula H3 res 9 e suaviza (k=1). Retorna Series indexada por h3."""
    import h3

    cells = [h3.latlng_to_cell(a, o, C.H3_RES) for a, o in zip(lats, lons, strict=True)]
    g = pd.Series(np.asarray(weights, dtype=float)).groupby(cells).sum()
    sm = smooth_k1(g.to_dict())
    return pd.Series(sm, name="footfall", dtype=float)


def edge_midpoints(z) -> tuple[np.ndarray, np.ndarray]:
    """(lat, lon) do ponto médio (vértice central da geometria) de cada aresta."""
    offsets = z["geom_offsets"]
    coords = z["geom_coords"]
    mid = (offsets[:-1] + offsets[1:] - 1) // 2
    return coords[mid, 1].astype(float), coords[mid, 0].astype(float)


def load_footfall(graph_path=None) -> pd.Series:
    """Footfall por célula H3 res 9 (>= 0) a partir do grafo a pé."""
    path = graph_path or C.DATA_PROCESSED / "graph_walk.npz"
    if not path.exists():
        raise SystemExit(f"{path} não existe: rode `python -m pipeline.build_graph --modes walk` antes")
    with np.load(path) as z:
        table = z["highway_table"]
        w_type = np.array([street_weight(str(h)) for h in table])
        w = w_type[z["edge_highway"]] * z["length_m"] / 1000.0
        lat, lon = edge_midpoints(z)
    # o grafo a pé é bidirecional: cada via aparece duas vezes, o que só escala o total
    keep = w > 0
    return aggregate_footfall(lat[keep], lon[keep], w[keep])


def main() -> None:
    ff = load_footfall()
    print(ff.describe())


if __name__ == "__main__":
    main()
