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
            "risk_level", "vs_fastest", "categories", "geometry", "segments", "steps",
        }
        assert rt["geometry"]["type"] == "LineString"
        assert rt["segments"][0]["coordinates"] and "risk" in rt["segments"][0]
        st = rt["steps"]
        assert st[0]["maneuver"] == "depart" and st[-1]["maneuver"] == "arrive"
        assert set(st[0]) == {
            "maneuver", "instruction", "street", "distance_m", "duration_s", "location", "geometry_index",
        }
        assert st[-1]["geometry_index"] == len(rt["geometry"]["coordinates"]) - 1
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
    assert client.get("/api/risk", params={"bbox": "-46.7,-23.6,-46.6,-23.5", "period": "xx"}).status_code == 422


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


def test_gzip_and_cors(data_dir, tmp_path, monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://a.example, https://b.example")
    app = create_app(processed_dir=data_dir, frontend_dir=tmp_path / "nofront")
    with TestClient(app) as c:
        r = c.post("/api/routes", json=body(), headers={"Accept-Encoding": "gzip", "Origin": "https://a.example"})
        assert r.headers["content-encoding"] == "gzip"
        assert r.headers["access-control-allow-origin"] == "https://a.example"
        r = c.get("/api/health", headers={"Origin": "https://evil.example"})
        assert "access-control-allow-origin" not in r.headers


def test_no_cors_by_default(client):
    r = client.get("/api/health", headers={"Origin": "https://a.example"})
    assert "access-control-allow-origin" not in r.headers


def test_background_load(data_dir, tmp_path):
    app = create_app(processed_dir=data_dir, frontend_dir=tmp_path / "nofront", background_load=True)
    with TestClient(app) as c:
        app.state.engine.ready.wait(10)
        assert c.get("/api/health").json()["graphs"]["walk"]["nodes"] == 36
        assert c.post("/api/routes", json=body()).status_code == 200


def test_frontend_contract_steps_cors_preflight_midblock(data_dir, tmp_path, monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://a.example")
    app = create_app(processed_dir=data_dir, frontend_dir=tmp_path / "nofront")
    with TestClient(app) as c:
        pre = c.options(
            "/api/routes",
            headers={
                "Origin": "https://a.example",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert pre.status_code == 200
        assert pre.headers["access-control-allow-origin"] == "https://a.example"
        assert "POST" in pre.headers["access-control-allow-methods"]
        assert "content-type" in pre.headers["access-control-allow-headers"].lower()
        assert c.get("/api/health").status_code == 200
        # origem no meio da quadra (fora de qualquer nó)
        o = {"lat": ORIGIN[0] - 0.0004, "lon": ORIGIN[1] + 0.0003}
        j = c.post("/api/routes", json=body(origin=o)).json()
        assert [r["id"] for r in j["routes"]][0] == "rapida"
        for rt in j["routes"]:
            st, coords = rt["steps"], rt["geometry"]["coordinates"]
            assert st[0]["maneuver"] == "depart" and st[0]["geometry_index"] == 0
            assert st[-1]["maneuver"] == "arrive" and st[-1]["distance_m"] == 0
            assert st[-1]["location"] == coords[-1]
            for s in st:
                assert isinstance(s["geometry_index"], int) and s["location"] == coords[s["geometry_index"]]


def _photon_mock(monkeypatch, handler):
    import httpx

    monkeypatch.setattr(geo, "_client", httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    geo._rcache.clear()


_FEAT = {"features": [{"geometry": {"coordinates": [-46.6333, -23.5505]},
                       "properties": {"name": "Praça da Sé", "city": "São Paulo"}}]}


def test_reverse_ok_and_cache(client, monkeypatch):
    calls = []

    def handler(req):
        import httpx

        calls.append(req)
        return httpx.Response(200, json=_FEAT)

    _photon_mock(monkeypatch, handler)
    r = client.get("/api/reverse", params={"lat": -23.55051, "lon": -46.63331})
    assert r.status_code == 200 and r.json()["label"] == "Praça da Sé, São Paulo"
    assert calls[0].url.path == "/reverse" and calls[0].url.params["limit"] == "1"
    client.get("/api/reverse", params={"lat": -23.55052, "lon": -46.63332})  # mesma célula de ~11 m
    assert len(calls) == 1


def test_reverse_empty(client, monkeypatch):
    import httpx

    _photon_mock(monkeypatch, lambda req: httpx.Response(200, json={"features": []}))
    r = client.get("/api/reverse", params={"lat": -23.55, "lon": -46.63})
    assert r.status_code == 200 and r.json() is None


def test_reverse_outside_bbox(client):
    assert client.get("/api/reverse", params={"lat": 0, "lon": 0}).status_code == 400
    assert client.get("/api/reverse", params={"lat": "x", "lon": 0}).status_code == 422


def test_reverse_upstream_failure(client, monkeypatch):
    import httpx

    _photon_mock(monkeypatch, lambda req: httpx.Response(500))
    assert client.get("/api/reverse", params={"lat": -23.55, "lon": -46.63}).status_code == 502
