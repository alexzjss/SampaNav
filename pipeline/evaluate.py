"""Diagnóstico do modelo de risco v2 vs v1.

Compara data/processed/risk_hex_v1.parquet com risk_hex.parquet: distribuição de risk,
top-20 células (bairro aproximado = BAIRRO mais comum nas ocorrências da célula),
correlação de risk com footfall e células do Centro com risk >= 0.95.

Uso: python -m pipeline.evaluate [--mode walk] [--period all]
"""

from __future__ import annotations

import argparse

import numpy as np
import pandas as pd

from pipeline import config as C

CENTRO_LATLON = (-23.5505, -46.6333)   # Praça da Sé
CENTRO_RADIUS_M = 1500.0
OCC_PATH = C.DATA_PROCESSED / "occurrences.parquet"


def distribution(risk: pd.Series) -> dict:
    q = risk.quantile([0.5, 0.75, 0.9, 0.99]).to_dict()
    return {"n": int(len(risk)), **{f"p{int(k * 100)}": round(float(v), 3) for k, v in q.items()},
            "ge_0.95": int((risk >= 0.95).sum()), "ge_0.8": int((risk >= 0.8).sum())}


def centro_cells(cells) -> np.ndarray:
    """Máscara das células a até CENTRO_RADIUS_M da Praça da Sé."""
    import h3

    out = []
    for c in cells:
        lat, lon = h3.cell_to_latlng(c)
        dy = (lat - CENTRO_LATLON[0]) * 111_000
        dx = (lon - CENTRO_LATLON[1]) * 111_000 * np.cos(np.radians(lat))
        out.append(np.hypot(dx, dy) <= CENTRO_RADIUS_M)
    return np.array(out)


def neighborhoods() -> pd.Series:
    """BAIRRO mais comum por célula H3, quando o cache de ocorrências tiver a coluna."""
    import h3

    if not OCC_PATH.exists():
        return pd.Series(dtype=object)
    occ = pd.read_parquet(OCC_PATH)
    if "BAIRRO" not in occ.columns:
        return pd.Series(dtype=object)
    occ = occ[occ["LATITUDE"].between(-24.1, -23.3) & occ["LONGITUDE"].between(-46.9, -46.3)]
    occ = occ.assign(h3=[h3.latlng_to_cell(a, o, C.H3_RES) for a, o in zip(occ["LATITUDE"], occ["LONGITUDE"], strict=True)])
    return occ.groupby("h3")["BAIRRO"].agg(lambda s: s.mode().iat[0] if s.notna().any() else "")


def report(mode: str = "walk", period: str = "all") -> None:
    v1 = pd.read_parquet(C.DATA_PROCESSED / "risk_hex_v1.parquet")
    v2 = pd.read_parquet(C.DATA_PROCESSED / "risk_hex.parquet")
    v1 = v1[(v1["mode"] == mode) & (v1["period"] == period)].set_index("h3")
    v2 = v2[(v2["mode"] == mode) & (v2["period"] == period)].set_index("h3")
    print(f"=== {mode}/{period} ===")
    print("distribuição v1:", distribution(v1["risk"]))
    print("distribuição v2:", distribution(v2["risk"]))

    bairros = neighborhoods()
    for name, d in (("v1", v1), ("v2", v2)):
        print(f"\nTop-20 {name}:")
        top = d.sort_values("risk", ascending=False).head(20)
        for h, r in top.iterrows():
            ff = r.get("footfall", np.nan)
            print(f"  {h} risk={r['risk']:.3f} n={r['n']:>4d} footfall={ff:.0f} "
                  f"{bairros.get(h, '?')}" if pd.notna(ff) else
                  f"  {h} risk={r['risk']:.3f} n={r['n']:>4d} {bairros.get(h, '?')}")
    both = set(v1.sort_values("risk", ascending=False).head(20).index) & \
        set(v2.sort_values("risk", ascending=False).head(20).index)
    print(f"\nInterseção top-20 v1/v2: {len(both)}")

    if "footfall" in v2 and v2["footfall"].notna().any():
        ff = v2["footfall"]
        print(f"corr(risk, footfall) v1 (footfall do v2): "
              f"{v1['risk'].reindex(v2.index).corr(ff):.3f} | v2: {v2['risk'].corr(ff):.3f}")
        print(f"corr de Spearman v1: {v1['risk'].reindex(v2.index).corr(ff, method='spearman'):.3f} "
              f"| v2: {v2['risk'].corr(ff, method='spearman'):.3f}")
    for name, d in (("v1", v1), ("v2", v2)):
        m = centro_cells(d.index)
        print(f"Centro (raio {CENTRO_RADIUS_M:.0f} m da Sé), {name}: {int(m.sum())} células, "
              f"risk>=0.95: {int((d['risk'][m] >= 0.95).sum())}, mediana risk {d['risk'][m].median():.3f}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--mode", default="walk")
    ap.add_argument("--period", default="all")
    args = ap.parse_args()
    report(args.mode, args.period)
    if args.period == "all":
        report(args.mode, "noite")


if __name__ == "__main__":
    main()
