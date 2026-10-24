"""Iluminação pública: pontos de luz do GeoSampa (SMUL/ILUME) -> densidade por célula H3.

Fonte (verificada em 23/10/2026, ~663 mil pontos, EPSG:31983, carga 2026-10-21):
  WFS  http://wfs.geosampa.prefeitura.sp.gov.br/geoserver/wfs  camada geoportal:iluminacao_publica
  Info https://gestaourbana.prefeitura.sp.gov.br/noticias/semaforos-e-pontos-de-iluminacao-publica-podem-ser-localizados-no-geosampa
Sem autenticação; paginado por startIndex. Cache em data/raw/iluminacao_pontos.parquet.

light = densidade (pontos/célula, suavizada k=1) normalizada 0-1 pelo percentil 95
(clip); o multiplicador noturno é aplicado em build_risk.

Uso: python -m pipeline.lighting [--force]
"""

from __future__ import annotations

import argparse

import httpx
import numpy as np
import pandas as pd

from pipeline import config as C
from pipeline.footfall import aggregate_footfall

WFS_URL = "http://wfs.geosampa.prefeitura.sp.gov.br/geoserver/wfs"
LAYER = "geoportal:iluminacao_publica"
PAGE = 30_000  # o servidor limita a 30000 por requisição; paginamos até vir vazio
LIGHT_PERCENTILE = 95.0


def normalize_light(density: pd.Series, percentile: float = LIGHT_PERCENTILE) -> pd.Series:
    """Densidade -> 0-1 (clip no percentil indicado das células com luz). Vazio -> NaN."""
    pos = density[density > 0]
    if pos.empty:
        return density * np.nan
    top = np.percentile(pos, percentile)
    return (density / top).clip(0.0, 1.0)


def fetch_points(force: bool = False) -> pd.DataFrame:
    path = C.LIGHTING_RAW_PATH
    if path.exists() and not force:
        return pd.read_parquet(path)
    from pyproj import Transformer

    tr = Transformer.from_crs(31983, 4326, always_xy=True)
    xs, ys, types = [], [], []
    start = 0
    with httpx.Client(timeout=httpx.Timeout(60, read=300)) as client:
        while True:
            params = {"service": "WFS", "version": "2.0.0", "request": "GetFeature",
                      "typeNames": LAYER, "outputFormat": "application/json",
                      "count": PAGE, "startIndex": start, "sortBy": "cd_identificador_iluminacao_publica",
                      "propertyName": "ge_ponto,dc_tipo_iluminacao_publica"}
            for attempt in range(4):
                try:
                    r = client.get(WFS_URL, params=params)
                    r.raise_for_status()
                    feats = r.json()["features"]
                    break
                except (httpx.HTTPError, ValueError) as e:
                    print(f"  retry {attempt}: {e}")
            else:
                raise SystemExit("WFS iluminação falhou")
            if not feats:
                break
            for f in feats:
                g = f.get("geometry")
                if g and g["type"] == "Point":
                    xs.append(g["coordinates"][0])
                    ys.append(g["coordinates"][1])
                    types.append(f["properties"].get("dc_tipo_iluminacao_publica"))
            start += len(feats)
            print(f"  {start} pontos", flush=True)
    lon, lat = tr.transform(np.array(xs), np.array(ys))
    df = pd.DataFrame({"lat": lat, "lon": lon, "tipo": pd.array(types, dtype="string")})
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(path, index=False)
    return df


def load_light(force: bool = False) -> pd.Series | None:
    """Série `light` (0-1) por célula H3; None se a fonte estiver indisponível (sem efeito)."""
    try:
        pts = fetch_points(force)
    except (SystemExit, httpx.HTTPError) as e:
        print(f"Iluminação indisponível ({e}); light=NaN")
        return None
    min_lon, min_lat, max_lon, max_lat = C.SP_BBOX
    pts = pts[pts["lat"].between(min_lat, max_lat) & pts["lon"].between(min_lon, max_lon)]
    dens = aggregate_footfall(pts["lat"], pts["lon"], np.ones(len(pts)))
    return normalize_light(dens).rename("light")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    print(load_light(args.force).describe())


if __name__ == "__main__":
    main()
