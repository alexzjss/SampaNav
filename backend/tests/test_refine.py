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


def test_client_ip_ignores_spoofable_xff_prefix(monkeypatch):
    # cadeia medida no Render: "<cliente>, <borda Cloudflare>, <rede interna>"; com o
    # cliente forjando, o valor dele vem antes: "6.6.6.6,<cliente>, <borda>, <interna>"
    chain = "6.6.6.6,160.79.106.134, 104.22.160.30, 10.194.65.31"
    assert client_ip(_req({"x-forwarded-for": chain})) == "160.79.106.134"
    assert client_ip(_req({"x-forwarded-for": "160.79.106.21, 104.22.100.19, 10.197.204.143"})) == "160.79.106.21"
    assert client_ip(_req({"x-forwarded-for": "2001:db8::1"})) == "2001:db8::1"  # lista curta
    monkeypatch.setenv("SAMPANAV_TRUSTED_PROXIES", "1")
    assert client_ip(_req({"x-forwarded-for": "6.6.6.6, 1.2.3.4"})) == "1.2.3.4"
    monkeypatch.delenv("SAMPANAV_TRUSTED_PROXIES")
    # valor arbitrário/gigante vira chave do limitador: cai no IP da conexão
    assert client_ip(_req({"x-forwarded-for": "x" * 5000})) == "9.9.9.9"
    assert client_ip(_req({"x-forwarded-for": "lixo, 172.70.1.1, 10.0.0.1"})) == "9.9.9.9"
    assert client_ip(_req({})) == "9.9.9.9"


def test_client_ip_prefers_edge_header(monkeypatch):
    h = {"cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "10.0.0.5, 172.70.1.1"}
    assert client_ip(_req(h)) == "203.0.113.7"
    # cabeçalho de borda inválido: segue para o X-Forwarded-For
    assert client_ip(_req({"cf-connecting-ip": "lixo", "x-forwarded-for": "10.0.0.5, 172.70.1.1, 10.9.0.1"})) == "10.0.0.5"
    monkeypatch.setenv("SAMPANAV_CLIENT_IP_HEADER", "true-client-ip")
    assert client_ip(_req({"true-client-ip": "198.51.100.2", "cf-connecting-ip": "203.0.113.7"})) == "198.51.100.2"


def test_spoofed_xff_does_not_bypass_limit(data_dir, tmp_path):
    app = create_app(processed_dir=data_dir, frontend_dir=tmp_path / "nofront", rate_limits={"routes": 1})
    body = {"origin": {"lat": ORIGIN[0], "lon": ORIGIN[1]}, "destination": {"lat": DEST[0], "lon": DEST[1]}}
    with TestClient(app) as c:
        codes = [
            c.post("/api/routes", json=body,
                   headers={"x-forwarded-for": f"10.0.0.{i},203.0.113.7, 172.70.{i}.1, 10.9.0.1"}).status_code
            for i in range(3)
        ]
    assert codes == [200, 429, 429]


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
