"""Testes de pipeline/validate_data.py com fixtures sintéticas pequenas."""

import datetime as dt
import json

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from pipeline import config as C
from pipeline.validate_data import main, validate

TODAY = dt.date(2026, 10, 29)


def make_meta(n=300_000, date_max="2026-10-01"):
    return {
        "generated_at": "2026-10-10T00:00:00+00:00", "date_min": "2024-10-01",
        "date_max": date_max, "n_occurrences": n, "categories": {}, "model": "v2",
    }


def build(d, meta=None, risk_fn=None, drop_period=None, graph_fn=None):
    d.mkdir(parents=True, exist_ok=True)
    (d / "risk_meta.json").write_text(json.dumps(meta or make_meta()))
    rows = [(m, p) for m in C.MODES for p in C.PERIODS if p != drop_period]
    risk = [0.2 + 0.1 * (i % 5) for i in range(len(rows))]
    if risk_fn:
        risk = risk_fn(risk)
    pq.write_table(pa.table({
        "mode": [r[0] for r in rows], "period": [r[1] for r in rows], "risk": risk,
    }), d / "risk_hex.parquet")
    for mode in C.MODES:
        data = {"edge_u": np.arange(10, dtype=np.int32)}
        for p in C.PERIODS:
            data[f"risk_{p}"] = np.linspace(0.1, 0.9, 10, dtype=np.float32)
        if graph_fn:
            graph_fn(data)
        np.savez(d / f"graph_{mode}.npz", **data)


def run(d, prev=None):
    return validate(d, prev, today=TODAY)


def test_ok(tmp_path):
    build(tmp_path)
    assert run(tmp_path, make_meta(310_000, "2026-09-01")) == ([], [])


def test_contagem_baixa(tmp_path):
    build(tmp_path, make_meta(n=500))
    errs, _ = run(tmp_path)
    assert any("mínimo absoluto" in e for e in errs)


def test_queda_vs_anterior(tmp_path):
    build(tmp_path, make_meta(n=200_000))
    errs, _ = run(tmp_path, make_meta(n=400_000))
    assert any("caiu 50%" in e for e in errs)


def test_data_regrediu_e_igual(tmp_path):
    build(tmp_path, make_meta(date_max="2026-09-01"))
    errs, _ = run(tmp_path, make_meta(date_max="2026-10-01"))
    assert any("regrediu" in e for e in errs)
    build(tmp_path, make_meta(date_max="2026-10-01"))
    errs, warns = run(tmp_path, make_meta(date_max="2026-10-01"))
    assert not errs and any("sem dados novos" in w for w in warns)


def test_dados_defasados(tmp_path):
    build(tmp_path, make_meta(date_max="2026-01-01"))
    errs, _ = run(tmp_path)
    assert any("defasados" in e for e in errs)


def test_meta_ausente_ou_incompleta(tmp_path):
    build(tmp_path)
    (tmp_path / "risk_meta.json").unlink()
    assert any("não existe" in e for e in run(tmp_path)[0])
    build(tmp_path, {"n_occurrences": 300_000})
    assert any("chaves obrigatórias" in e for e in run(tmp_path)[0])


def test_periodo_ausente(tmp_path):
    build(tmp_path, drop_period="noite")
    errs, _ = run(tmp_path)
    assert any("período=noite" in e for e in errs)


def test_risco_fora_do_intervalo(tmp_path):
    build(tmp_path, risk_fn=lambda r: [*r[:-1], 1.5])
    assert any("fora de [0,1]" in e for e in run(tmp_path)[0])
    build(tmp_path, risk_fn=lambda r: [*r[:-1], float("nan")])
    assert any("NaN" in e for e in run(tmp_path)[0])


def test_grafo_invalido(tmp_path):
    build(tmp_path, graph_fn=lambda d: d.update(risk_tarde=np.zeros(10, np.float32)))
    assert any("todo zerado" in e for e in run(tmp_path)[0])
    build(tmp_path, graph_fn=lambda d: d.update(risk_all=np.full(10, 2.0, np.float32)))
    assert any("risk_all fora" in e for e in run(tmp_path)[0])
    build(tmp_path, graph_fn=lambda d: d.update(risk_manha=np.full(9, 0.5, np.float32)))
    assert any("risk_manha com 9" in e for e in run(tmp_path)[0])
    build(tmp_path, graph_fn=lambda d: d.pop("risk_noite"))
    assert any("sem array risk_noite" in e for e in run(tmp_path)[0])


@pytest.mark.parametrize("ok", [True, False])
def test_cli_exit_code(tmp_path, ok, capsys):
    build(tmp_path, make_meta(date_max=dt.date.today().isoformat()) if ok else make_meta(n=1))
    code = main(["--new", str(tmp_path)])
    assert code == (0 if ok else 1)
    assert "Validação" in capsys.readouterr().out
