"""Testes das funções puras do modelo de risco v2 (footfall, iluminação, mix)."""

import numpy as np
import pandas as pd
import pytest

from pipeline import config as C
from pipeline.build_risk import light_multiplier, mix_risk, normalize_risk
from pipeline.footfall import aggregate_footfall, smooth_k1, street_weight
from pipeline.lighting import normalize_light


def test_street_weight_ranks_pedestrian_areas_above_residential():
    assert street_weight("pedestrian") > street_weight("primary") > street_weight("residential") > 0
    assert street_weight("corridor") > street_weight("residential")
    assert street_weight("ladder") == 0.0          # tipo desconhecido usa o padrão
    assert street_weight("x", {"x": 2.5}) == 2.5   # regras customizadas


def test_smooth_k1_spreads_to_neighbors():
    import h3

    c = h3.latlng_to_cell(-23.55, -46.63, C.H3_RES)
    out = smooth_k1({c: 10.0})
    assert out[c] == 10.0
    nbs = [x for x in h3.grid_disk(c, 1) if x != c]
    assert all(out[n] == pytest.approx(10.0 * C.NEIGHBOR_FACTOR) for n in nbs)


def test_aggregate_footfall_sums_per_cell():
    ff = aggregate_footfall([-23.55, -23.55], [-46.63, -46.63], [2.0, 3.0])
    assert ff.max() == pytest.approx(5.0)
    assert (ff >= 0).all()


def test_light_multiplier():
    m = light_multiplier([0.0, 1.0, np.nan], gamma=0.3)
    assert m == pytest.approx([1.3, 1.0, 1.0])


def test_normalize_light_clips_and_nan_when_empty():
    s = pd.Series([0.0, 1.0, 2.0, 100.0])
    n = normalize_light(s)
    assert n.min() == 0.0 and n.max() == 1.0
    assert normalize_light(pd.Series([0.0, 0.0])).isna().all()


def test_mix_beta_zero_reproduces_v1():
    score = np.array([1.0, 2.0, 5.0, 40.0, 0.0])
    ff = np.array([10.0, 0.0, 3.0, 500.0, 1.0])
    risk, _ = mix_risk(score, ff, beta=0.0)
    assert risk == pytest.approx(normalize_risk(score))


def test_mix_penalizes_crowded_cells():
    # mesma pontuação, mas uma célula tem muito mais movimento -> risco menor
    score = np.array([10.0] * 6 + [1.0, 2.0, 3.0])
    ff = np.array([1000.0, 1.0, 1.0, 1.0, 1.0, 1.0, 5.0, 5.0, 5.0])
    risk, rate = mix_risk(score, ff, beta=0.5)
    assert rate[0] < rate[1]
    assert risk[0] < risk[1]
    assert ((risk >= 0) & (risk <= 1)).all()


def test_mix_without_footfall_signal_is_finite():
    risk, rate = mix_risk(np.array([1.0, 2.0, 3.0]), np.zeros(3), beta=0.5)
    assert np.isfinite(risk).all() and np.isfinite(rate).all()


def test_fill_tipolocal_uses_modal_type_per_subtype():
    import pandas as pd

    from pipeline.build_risk import fill_tipolocal

    df = pd.DataFrame({
        "DESCR_TIPOLOCAL": ["Via Pública", "Via Pública", "Comércio", None, None],
        "DESCR_SUBTIPOLOCAL": ["Calçada", "Calçada", "Calçada", "Calçada", "Inexistente"],
    })
    out = fill_tipolocal(df)
    assert out.loc[3, "DESCR_TIPOLOCAL"] == "Via Pública"
    assert pd.isna(out.loc[4, "DESCR_TIPOLOCAL"])
