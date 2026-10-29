"""Gera um GeoJSON de ruas (por classe viária) a partir dos grafos de produção.

Uso: uv run python tools/screenshots/basemap.py <data_dir> <saida.geojson>

O mapa-base dos screenshots é desenhado com estas ruas (o sandbox não alcança os tiles do
OpenFreeMap). Cobre só a região dos cenários (BBOX) para manter o arquivo pequeno.
"""
import json
import sys
from pathlib import Path

import numpy as np

# lon_min, lat_min, lon_max, lat_max: centro expandido + Pinheiros + Ibirapuera
BBOX = (-46.745, -23.635, -46.575, -23.495)

CLASSES = {
    "motorway": ("motorway", "motorway_link"),
    "trunk": ("trunk", "trunk_link"),
    "primary": ("primary", "primary_link"),
    "secondary": ("secondary", "secondary_link"),
    "tertiary": ("tertiary", "tertiary_link"),
    "minor": ("residential", "unclassified", "living_street"),
    "service": ("service",),
    "path": ("footway", "pedestrian", "path", "steps", "cycleway", "track", "corridor"),
}
# o grafo de carro cobre as vias; o de pedestre só contribui com caminhos de pedestre
FROM_GRAPH = {"drive": [c for c in CLASSES if c != "path"], "walk": ["path"]}


def extract(npz_path, wanted, seen):
    z = np.load(npz_path)
    hw = [str(x) for x in z["highway_table"]]
    cls_of = {}
    for cls in wanted:
        for name in CLASSES[cls]:
            if name in hw:
                cls_of[hw.index(name)] = cls
    nlat, nlon = z["node_lat"], z["node_lon"]
    u, v = z["edge_u"], z["edge_v"]
    inside = ((nlon[u] >= BBOX[0]) & (nlon[u] <= BBOX[2]) & (nlat[u] >= BBOX[1]) & (nlat[u] <= BBOX[3])) | \
             ((nlon[v] >= BBOX[0]) & (nlon[v] <= BBOX[2]) & (nlat[v] >= BBOX[1]) & (nlat[v] <= BBOX[3]))
    ehw = z["edge_highway"]
    off, co, ln = z["geom_offsets"], z["geom_coords"], z["length_m"]
    out = {c: [] for c in wanted}
    for e in np.nonzero(inside & np.isin(ehw, list(cls_of)))[0]:
        key = (min(u[e], v[e]), max(u[e], v[e]), int(ln[e]))
        if key in seen:  # aresta oposta (mão dupla) ou repetida
            continue
        seen.add(key)
        pts = co[off[e]:off[e + 1]]
        if len(pts) < 2:
            continue
        out[cls_of[int(ehw[e])]].append([[round(float(x), 5), round(float(y), 5)] for x, y in pts])
    return out


def main(data_dir, dest):
    data = Path(data_dir)
    feats = {}
    for graph, wanted in FROM_GRAPH.items():
        got = extract(data / f"graph_{graph}.npz", wanted, set())
        feats.update(got)
    fc = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"c": cname},
         "geometry": {"type": "MultiLineString", "coordinates": lines}}
        for cname, lines in feats.items() if lines]}
    Path(dest).parent.mkdir(parents=True, exist_ok=True)
    Path(dest).write_text(json.dumps(fc, separators=(",", ":")))
    print("basemap:", {k: len(v) for k, v in feats.items()}, f"{Path(dest).stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(*sys.argv[1:])
