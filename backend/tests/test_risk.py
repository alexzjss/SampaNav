"""Testes das funções puras de pipeline/build_risk.py."""

import datetime as dt

import numpy as np
import pytest

from pipeline.build_risk import (
    classify,
    decay_weight,
    norm_text,
    parse_hour,
    period_from_desc,
    period_from_hour,
)

VP = "Via Pública"


@pytest.mark.parametrize(
    "args, expected",
    [
        (("Roubo (art. 157)", "Transeunte", "ROUBO - OUTROS", VP, "Via Pública"), "roubo_pessoa"),
        (("Roubo (art. 157)", "Outros", "ROUBO - OUTROS", VP, "Via Pública"), "roubo_pessoa"),
        (("Roubo (art. 157)", "Veículo", "ROUBO DE VEÍCULO", VP, "Via Pública"), "roubo_veiculo"),
        (("Roubo (art. 157)", "Carga", "ROUBO DE CARGA", VP, "Via Pública"), None),
        (("Roubo (art. 157)", "Outros", "LATROCÍNIO", VP, "Via Pública"), "letal"),
        (("Roubo (art. 157)", "§ 3º, I - Se da violência resulta morte", "ROUBO - OUTROS", VP, ""), "letal"),
        (("Furto (art. 155)", "Transeunte", "FURTO - OUTROS", VP, "Via Pública"), "furto_pessoa"),
        (("Furto (art. 155)", "Veículo", "FURTO DE VEÍCULO", VP, "Via Pública"), "furto_veiculo"),
        (("Furto (art. 155)", "Interior de Veículo", "FURTO - OUTROS", VP, ""), "furto_veiculo"),
        (("Furto (art. 155)", "Fios e Cabos", "FURTO - OUTROS", VP, ""), None),
        (("Furto (art. 155)", "Residência", "FURTO - OUTROS", VP, ""), None),
        (("Lesão corporal (art. 129)", None, "LESÃO CORPORAL DOLOSA", VP, ""), "lesao"),
        (("Lesão corporal (art. 129)", None, "LESÃO CORPORAL CULPOSA - OUTRAS", VP, ""), None),
        (("Homicídio (art. 121)", None, "HOMICÍDIO DOLOSO", VP, ""), "letal"),
        (("Homicídio (art. 121)", None, "TENTATIVA DE HOMICÍDIO", VP, ""), "letal"),
        (("Homicídio (art. 121)", None, "HOMICÍDIO CULPOSO OUTROS", VP, ""), None),
        (("Feminicídio", None, "HOMICÍDIO DOLOSO", VP, ""), "letal"),
        # descartes por rubrica
        (("tráfico drogas (Art.33, caput)", None, "TRÁFICO", VP, ""), None),
        (("Lesão corporal culposa na direção de veículo automotor (Art. 303)", None, "", VP, ""), None),
        # descartes por local
        (("Roubo (art. 157)", "Transeunte", "ROUBO - OUTROS", "Residência", "Casa"), None),
        (("Furto (art. 155)", "Outros", "FURTO - OUTROS", "Shopping Center", "Lojas"), None),
        (("Furto (art. 155)", "Outros", "FURTO - OUTROS", "Estacionamento/Garagem",
          "Garagem coletiva de prédio"), None),
        (("Roubo (art. 157)", "Outros", "ROUBO - OUTROS", "Terminal/Estação",
          "Metroviário e Ferroviário Metropolitano"), "roubo_pessoa"),
    ],
)
def test_classify(args, expected):
    assert classify(*args) == expected


def test_norm_text():
    assert norm_text("Via Pública ") == "via publica"
    assert norm_text(None) == ""
    assert norm_text(float("nan")) == ""


@pytest.mark.parametrize(
    "hour, expected",
    [(0, "madrugada"), (5, "madrugada"), (6, "manha"), (11, "manha"), (12, "tarde"),
     (17, "tarde"), (18, "noite"), (23, "noite"), (None, None), (24, None), (-1, None)],
)
def test_period_from_hour(hour, expected):
    assert period_from_hour(hour) == expected


@pytest.mark.parametrize(
    "desc, expected",
    [("De madrugada", "madrugada"), ("Pela manhã", "manha"), ("A tarde", "tarde"),
     ("A noite", "noite"), ("Em hora incerta", None), ("NULL", None), (None, None)],
)
def test_period_from_desc(desc, expected):
    assert period_from_desc(desc) == expected


def test_parse_hour():
    assert parse_hour(dt.time(15, 30)) == 15
    assert parse_hour("07:45:00") == 7
    assert parse_hour("NULL") is None
    assert parse_hour(None) is None
    assert parse_hour("25:00") is None


def test_decay_weight():
    assert decay_weight(0) == pytest.approx(1.0)
    assert decay_weight(365) == pytest.approx(0.5)
    assert decay_weight(730) == pytest.approx(0.25)
    assert decay_weight(-10) == pytest.approx(1.0)  # datas futuras não amplificam
    w = decay_weight(np.array([0, 365, 730]))
    assert np.allclose(w, [1.0, 0.5, 0.25])


def test_normalize_risk_log_scale():
    import numpy as np

    from pipeline.build_risk import normalize_risk

    score = np.array([0.0, 1.0, 10.0, 100.0, 1000.0, 5000.0])
    r = normalize_risk(score)
    assert r[0] == 0.0
    assert np.all(np.diff(r) > 0)  # estritamente crescente
    assert r.max() <= 1.0
    # a cauda não satura: só o topo extremo chega a 1.0
    assert (r >= 0.999).sum() == 1
