"""Empacota os dados do deploy em data/dist/sampanav-data.tar.gz.

Conteúdo (na raiz do tar, para extrair direto em data/processed/):
  graph_walk.npz, graph_drive.npz, risk_hex.parquet, risk_meta.json

Também gera data/dist/sampanav-inputs.tar.gz (extrair em data/raw/) com as
entradas auxiliares cacheadas (pontos de iluminação) para a atualização mensal
não depender do GeoSampa.

Uso: uv run python -m pipeline.package_data
"""

from __future__ import annotations

import sys
import tarfile

from pipeline.config import DATA_PROCESSED, DATA_RAW, LIGHTING_RAW_PATH, ROOT

DIST = ROOT / "data" / "dist"
FILES = ["graph_walk.npz", "graph_drive.npz", "risk_hex.parquet", "risk_meta.json"]


def main() -> None:
    missing = [f for f in FILES if not (DATA_PROCESSED / f).exists()]
    if missing:
        sys.exit(f"Arquivos ausentes em {DATA_PROCESSED}: {', '.join(missing)}")
    DIST.mkdir(parents=True, exist_ok=True)
    out = DIST / "sampanav-data.tar.gz"
    with tarfile.open(out, "w:gz", compresslevel=9) as tar:
        for f in FILES:
            tar.add(DATA_PROCESSED / f, arcname=f)
    print(f"{out} ({out.stat().st_size / 1e6:.1f} MB)")

    inputs = [p for p in (LIGHTING_RAW_PATH,) if p.exists()]
    if inputs:
        out_in = DIST / "sampanav-inputs.tar.gz"
        with tarfile.open(out_in, "w:gz", compresslevel=9) as tar:
            for p in inputs:
                tar.add(p, arcname=str(p.relative_to(DATA_RAW)))
        print(f"{out_in} ({out_in.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
