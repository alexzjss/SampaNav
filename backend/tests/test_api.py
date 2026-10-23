import pytest
from fastapi.testclient import TestClient

from backend.app import geocode as geo
from backend.app.main import create_app, resolve_period
from backend.tests.conftest import DEST, ORIGIN


@pytest.fixture
def client(data_dir, tmp_path):
    app = create_app(processed_dir=data_dir, frontend_dir=tmp_path / "nofront")
    with TestClient(app) as c:
        yield c


def body(**kw):
    b = {
        "origin": {"lat": ORIGIN[0], "lon": ORIGIN[1]},
        "destination": {"lat": DEST[0], "lon": DEST[1]},
        "mode": "walk",
        "period": "noite",
    }
    b.update(kw)
    return b


def test_health_degraded_when_drive_missing(client):
    j = client.get("/api/health").json()
    assert j["status"] == "degraded"
    assert j["graphs"]["walk"]["nodes"] == 36
    assert j["graphs"]["drive"]["nodes"] == 0


def test_meta(client):
    j = client.get("/api/meta").json()
    assert [p["id"] for p in j["profiles"]] == ["rapida", "equilibrada", "segura"]
    assert j["periods"] == ["all", "madrugada", "manha", "tarde", "noite"]


def test_routes_contract(client):
    r = client.post("/api/routes", json=body())
    assert r.status_code == 200
    j = r.json()
    assert j["mode"] == "walk" and j["period"] == "noite"
    assert j["routes"][0]["id"] == "rapida"
    assert j["routes"][0]["vs_fastest"] == {"duration_pct": 0.0, "exposure_pct": 0.0}
    for rt in j["routes"]:
        assert set(rt) >= {
            "id", "label", "alpha", "distance_m", "duration_s", "exposure", "avg_risk",
            "risk_level", "vs_fastest", "categories", "geometry", "segments",
        }
        assert rt["geometry"]["type"] == "LineString"
        assert rt["segments"][0]["coordinates"] and "risk" in rt["segments"][0]
    assert j["routes"][-1]["vs_fastest"]["exposure_pct"] < 0
    assert set(j["data"]) >= {"date_min", "date_max", "source"}


def test_routes_now_resolves_period(client):
    j = client.post("/api/routes", json=body(period="now")).json()
    assert j["period"] in ("madrugada", "manha", "tarde", "noite")


def test_routes_out_of_sp(client):
    r = client.post("/api/routes", json=body(origin={"lat": -22.9, "lon": -43.2}))
    assert r.status_code == 400 and "detail" in r.json()


def test_routes_missing_graph_is_400(client):
    assert client.post("/api/routes", json=body(mode="drive")).status_code == 400


def test_routes_no_road_nearby(client):
    r = client.post("/api/routes", json=body(origin={"lat": -23.4, "lon": -46.4}))
    assert r.status_code == 400


def test_risk_endpoint_empty_without_parquet(client):
    r = client.get("/api/risk", params={"bbox": "-46.7,-23.6,-46.6,-23.5", "mode": "walk", "period": "noite"})
    assert r.status_code == 200 and r.json() == []
    assert client.get("/api/risk", params={"bbox": "x"}).status_code == 400


def test_geocode_proxy(client, monkeypatch):
    async def fake(q):
        return [{"label": "Sé, São Paulo", "lat": -23.55, "lon": -46.63}]

    monkeypatch.setattr(geo, "geocode", fake)
    assert client.get("/api/geocode", params={"q": "sé"}).json()[0]["label"].startswith("Sé")


def test_geocode_parse():
    out = geo.parse(
        {"features": [{"geometry": {"coordinates": [-46.63, -23.55]},
                       "properties": {"name": "Sé", "city": "São Paulo", "district": "Sé"}}]}
    )
    assert out == [{"label": "Sé, São Paulo", "lat": -23.55, "lon": -46.63}]


def test_resolve_period():
    from datetime import datetime

    assert [resolve_period("now", datetime(2026, 1, 1, h)) for h in (2, 8, 14, 22)] == [
        "madrugada", "manha", "tarde", "noite",
    ]
