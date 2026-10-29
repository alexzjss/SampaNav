"""Regressões da revisão de correção (entrada inválida, XFF, carga em segundo plano, textos)."""

import time

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from backend.app import geocode as geo
from backend.app.main import create_app
from backend.app.ratelimit import client_ip
from backend.app.steps import fmt_dist
from backend.tests.conftest import DEST, ORIGIN


def _req(headers: dict[str, str], host: str = "9.9.9.9") -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "headers": raw, "client": (host, 1234)})


def test_nan_in_body_is_422_not_500(data_dir, tmp_path):
    app = create_app(processed_dir=data_dir, frontend_dir=tmp_path / "nofront")
    raw = (
        f'{{"origin":{{"lat":NaN,"lon":{ORIGIN[1]}}},"destination":{{"lat":{DEST[0]},"lon":{DEST[1]}}}}}'
    ).encode()
    with TestClient(app) as c:
        r = c.post("/api/routes", content=raw, headers={"content-type": "application/json"})
        assert r.status_code == 422
        assert r.json()["detail"][0]["loc"] == ["body", "origin", "lat"]


def test_client_ip_xff_valid_and_garbage():
    assert client_ip(_req({"x-forwarded-for": "1.2.3.4, 10.0.0.1"})) == "1.2.3.4"
    assert client_ip(_req({"x-forwarded-for": "2001:db8::1"})) == "2001:db8::1"
    # valor arbitrário/gigante vira chave do limitador: cai no IP da conexão
    assert client_ip(_req({"x-forwarded-for": "x" * 5000})) == "9.9.9.9"
    assert client_ip(_req({"x-forwarded-for": "not-an-ip, 1.2.3.4"})) == "9.9.9.9"
    assert client_ip(_req({})) == "9.9.9.9"


def test_fmt_dist_rounding_boundary():
    assert fmt_dist(999.6) == "1,0 km"
    assert fmt_dist(996) == "1,0 km"
    assert fmt_dist(994) == "990 m"
    assert fmt_dist(1000) == "1,0 km"


def test_background_load_failure_is_reported(tmp_path):
    (tmp_path / "graph_walk.npz").write_bytes(b"lixo")
    app = create_app(processed_dir=tmp_path, frontend_dir=tmp_path / "nofront", background_load=True)
    with TestClient(app) as c:
        for _ in range(50):
            h = c.get("/api/health").json()
            if h["status"] != "loading":
                break
            time.sleep(0.1)
        assert h["status"] == "error"
        body = {
            "origin": {"lat": ORIGIN[0], "lon": ORIGIN[1]},
            "destination": {"lat": DEST[0], "lon": DEST[1]},
        }
        assert c.post("/api/routes", json=body).status_code == 503


def test_geocode_parse_null_properties():
    payload = {
        "features": [
            {"geometry": {"coordinates": [-46.6, -23.5]}, "properties": None},
            {"geometry": {"coordinates": [-46.6, -23.5]}, "properties": {"name": "Praça da Sé"}},
        ]
    }
    assert geo.parse(payload) == [{"label": "Praça da Sé", "lat": -23.5, "lon": -46.6}]


def test_lighting_main_without_source(monkeypatch):
    from pipeline import lighting

    monkeypatch.setattr(lighting, "load_light", lambda force=False: None)
    monkeypatch.setattr("sys.argv", ["lighting"])
    lighting.main()  # não deve levantar AttributeError (None.describe)


def test_extract_city_without_ibge_column(tmp_path):
    openpyxl = pytest.importorskip("openpyxl")
    from pipeline import config as C
    from pipeline.build_risk import extract_city

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Dados"
    ws.append([*C.OCC_COLUMNS, "NOME_MUNICIPIO_CIRCUNSCRICAO"])
    for city in ("S.PAULO", "OSASCO", "S.PAULO"):
        ws.append([*[f"v{i}" for i in range(len(C.OCC_COLUMNS))], city])
    p = tmp_path / "SPDadosCriminais_2099.xlsx"
    wb.save(p)
    assert len(extract_city(p)) == 2
