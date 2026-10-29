"""Sanidade dos dados antes de publicar a Release (usado em data-refresh.yml).

Uso:
  python -m pipeline.validate_data --new data/processed [--prev prev] \
      [--min-occurrences 100000] [--max-drop 0.3] [--max-age-days 120]

`--prev` é um diretório com o risk_meta.json da Release anterior (opcional).
Saída 1 se qualquer verificação falhar; avisos não reprovam.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

import numpy as np

from pipeline import config as C

REQUIRED_KEYS = ["generated_at", "date_min", "date_max", "n_occurrences", "categories", "model"]
# Piso absoluto: SP capital em ~24 meses tem centenas de milhares de BOs úteis
# (após filtro de local/rubrica/coordenadas); 100k pega planilha vazia/truncada.
MIN_OCCURRENCES = 100_000
MAX_DROP = 0.30
MAX_AGE_DAYS = 120


def load_meta(d: Path) -> tuple[dict | None, str | None]:
    p = Path(d) / "risk_meta.json"
    if not p.exists():
        return None, f"{p} não existe"
    try:
        m = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return None, f"{p} ilegível: {e}"
    if not isinstance(m, dict):
        return None, f"{p} não é um objeto JSON"
    return m, None


def _parse_date(s) -> dt.date | None:
    try:
        return dt.date.fromisoformat(str(s)[:10])
    except ValueError:
        return None


def check_meta(meta: dict, prev: dict | None, min_occ: int, max_drop: float,
               max_age_days: int, today: dt.date) -> tuple[list[str], list[str]]:
    errs: list[str] = []
    warns: list[str] = []
    missing = [k for k in REQUIRED_KEYS if k not in meta]
    if missing:
        errs.append(f"risk_meta.json sem chaves obrigatórias: {', '.join(missing)}")
    n = meta.get("n_occurrences")
    if isinstance(n, int) and not isinstance(n, bool):
        if n < min_occ:
            errs.append(f"n_occurrences={n:,} abaixo do mínimo absoluto ({min_occ:,})")
        pn = (prev or {}).get("n_occurrences")
        if isinstance(pn, int) and pn > 0 and n < pn * (1 - max_drop):
            errs.append(
                f"n_occurrences caiu {1 - n / pn:.0%} ({pn:,} -> {n:,}); limite {max_drop:.0%}"
            )
    elif "n_occurrences" in meta:
        errs.append(f"n_occurrences inválido: {n!r}")
    dmax = _parse_date(meta.get("date_max"))
    if "date_max" in meta and dmax is None:
        errs.append(f"date_max inválido: {meta.get('date_max')!r}")
    if dmax is not None:
        age = (today - dmax).days
        if age > max_age_days:
            errs.append(f"date_max={dmax} tem {age} dias (máximo {max_age_days}): dados defasados")
        pmax = _parse_date((prev or {}).get("date_max"))
        if pmax is not None:
            if dmax < pmax:
                errs.append(f"date_max regrediu: {dmax} < {pmax} da Release anterior")
            elif dmax == pmax:
                warns.append(f"date_max={dmax} igual ao da Release anterior: sem dados novos")
    return errs, warns


def check_risk_hex(path: Path) -> list[str]:
    import pyarrow.compute as pc
    import pyarrow.parquet as pq

    if not path.exists():
        return [f"{path.name} não existe"]
    try:
        t = pq.read_table(path, columns=["mode", "period", "risk"])
    except Exception as e:  # noqa: BLE001 - qualquer falha de leitura reprova
        return [f"{path.name} ilegível: {e}"]
    errs: list[str] = []
    if t.num_rows == 0:
        return [f"{path.name} vazio"]
    risk = t["risk"]
    if risk.null_count or pc.any(pc.is_nan(risk)).as_py():
        errs.append(f"{path.name}: coluna risk com NaN/nulo")
    else:
        lo, hi = pc.min_max(risk).as_py().values()
        if lo < 0 or hi > 1:
            errs.append(f"{path.name}: risk fora de [0,1] (min={lo:.3g}, max={hi:.3g})")
    pairs = set(zip(t["mode"].to_pylist(), t["period"].to_pylist(), strict=True))
    for m in C.MODES:
        for p in C.PERIODS:
            if (m, p) not in pairs:
                errs.append(f"{path.name}: sem linhas para modo={m} período={p}")
    return errs


def check_graph(path: Path) -> list[str]:
    if not path.exists():
        return [f"{path.name} não existe"]
    errs: list[str] = []
    try:
        with np.load(path, allow_pickle=False) as z:
            if "edge_u" not in z.files:
                return [f"{path.name}: sem array edge_u"]
            m = len(z["edge_u"])
            for p in C.PERIODS:
                k = f"risk_{p}"
                if k not in z.files:
                    errs.append(f"{path.name}: sem array {k}")
                    continue
                a = z[k]
                if len(a) != m:
                    errs.append(f"{path.name}: {k} com {len(a)} itens, edge_u tem {m}")
                elif m == 0:
                    errs.append(f"{path.name}: grafo sem arestas")
                elif not np.isfinite(a).all():
                    errs.append(f"{path.name}: {k} com NaN/inf")
                elif a.min() < 0 or a.max() > 1:
                    errs.append(f"{path.name}: {k} fora de [0,1] (min={a.min():.3g}, max={a.max():.3g})")
                elif not a.any():
                    errs.append(f"{path.name}: {k} todo zerado")
    except Exception as e:  # noqa: BLE001
        errs.append(f"{path.name} ilegível: {e}")
    return errs


def validate(new_dir: Path, prev_meta: dict | None = None, min_occurrences: int = MIN_OCCURRENCES,
             max_drop: float = MAX_DROP, max_age_days: int = MAX_AGE_DAYS,
             today: dt.date | None = None) -> tuple[list[str], list[str]]:
    new_dir = Path(new_dir)
    today = today or dt.datetime.now(dt.UTC).date()
    meta, err = load_meta(new_dir)
    errs: list[str] = []
    warns: list[str] = []
    if meta is None:
        errs.append(err or "risk_meta.json inválido")
    else:
        errs, warns = check_meta(meta, prev_meta, min_occurrences, max_drop, max_age_days, today)
    errs += check_risk_hex(new_dir / "risk_hex.parquet")
    for mode in C.MODES:
        errs += check_graph(new_dir / f"graph_{mode}.npz")
    return errs, warns


def format_summary(errs: list[str], warns: list[str]) -> str:
    lines = ["## Validação dos dados", ""]
    lines.append("**FALHOU**" if errs else "**OK**")
    lines += [f"- ERRO: {e}" for e in errs]
    lines += [f"- AVISO: {w}" for w in warns]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--new", type=Path, default=C.DATA_PROCESSED)
    ap.add_argument("--prev", type=Path, default=None, help="dir com risk_meta.json anterior")
    ap.add_argument("--min-occurrences", type=int, default=MIN_OCCURRENCES)
    ap.add_argument("--max-drop", type=float, default=MAX_DROP)
    ap.add_argument("--max-age-days", type=int, default=MAX_AGE_DAYS)
    a = ap.parse_args(argv)

    prev_meta = None
    prev_warn: list[str] = []
    if a.prev is not None:
        prev_meta, perr = load_meta(a.prev)
        if prev_meta is None:
            prev_warn.append(f"Release anterior não comparada: {perr}")
    errs, warns = validate(a.new, prev_meta, a.min_occurrences, a.max_drop, a.max_age_days)
    warns = prev_warn + warns
    print(format_summary(errs, warns))
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
