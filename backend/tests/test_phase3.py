"""Fase 3: bicicleta, parada (via) e exposição por período."""

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.routing import BIKE_CYCLEWAY_MS, BIKE_PUSH_MS, BIKE_SPEED_MS, RoadGraph
from backend.tests.conftest import DEST, LAT0, LON0, ORIGIN, STEP, make_arrays

VIA = (LAT0 - 3 * STEP, LON0 + 2 * STEP)  # nó (3, 2)


@pytest.fixture
def client(data_dir, tmp_path):
    with TestClient(create_app(processed_dir=data_dir, frontend_dir=tmp_path / "nofront")) as c:
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


def with_highway():
    a = make_arrays()
    # arestas da linha 0 = footway (empurrar), colunas = cycleway, resto = residential
    horiz = a["node_lat"][a["edge_u"]] == a["node_lat"][a["edge_v"]]
    row0 = a["node_lat"][a["edge_u"]] == LAT0
    hw = np.where(row0 & horiz, 1, np.where(~horiz, 2, 3)).astype(np.uint8)
    a["edge_highway"] = hw
    a["highway_table"] = np.array(["", "footway", "cycleway", "residential"])
    return a, hw


def test_bike_travel_times():
    a, hw = with_highway()
    w = RoadGraph("walk", a)
    b = w.bike_view()
    assert b.mode == "bike" and b.risk_mode == "walk"
    assert b.g is w.g and b.coords is w.coords and b.risk is w.risk  # compartilhado, sem cópia
    assert w.mode == "walk"
    L = w.length.astype(np.float64)
    assert np.allclose(b.ttime[hw == 3], L[hw == 3] / BIKE_SPEED_MS, rtol=1e-4)
    assert np.allclose(b.ttime[hw == 2], L[hw == 2] / BIKE_CYCLEWAY_MS, rtol=1e-4)
    assert np.allclose(b.ttime[hw == 1], L[hw == 1] / BIKE_PUSH_MS, rtol=1e-4)
    assert (b.ttime[hw != 1] < w.ttime[hw != 1]).all()


def test_bike_without_highway_is_faster_than_walk():
    w = RoadGraph("walk", make_arrays())
    b = w.bike_view()
    rw = w.routes(ORIGIN, DEST, "noite")[0]
    rb = b.routes(ORIGIN, DEST, "noite")[0]
    assert rb.duration_s < rw.duration_s
    assert abs(rb.distance_m - rw.distance_m) < 1e-6


def test_bike_api(client):
    h = client.get("/api/health").json()
    assert h["graphs"]["bike"] == h["graphs"]["walk"]
    assert "bike" not in h["missing"] and "drive" in h["missing"]
    assert client.get("/api/meta").json()["modes"] == ["walk", "bike"]
    w = client.post("/api/routes", json=body()).json()
    r = client.post("/api/routes", json=body(mode="bike"))
    assert r.status_code == 200
    j = r.json()
    assert j["mode"] == "bike" and j["via"] is None
    assert j["routes"][0]["duration_s"] < w["routes"][0]["duration_s"]
    assert j["routes"][0]["steps"][-1]["maneuver"] == "arrive"
    assert j["routes"][0]["exposure"] == w["routes"][0]["exposure"]
    cells = client.get("/api/risk", params={"bbox": "-46.7,-23.6,-46.6,-23.5", "mode": "bike", "period": "noite"})
    assert cells.status_code == 200


def test_via(client):
    r = client.post("/api/routes", json=body(via={"lat": VIA[0], "lon": VIA[1]}))
    assert r.status_code == 200
    j = r.json()
    assert j["via"] == {"lat": VIA[0], "lon": VIA[1]}
    for rt in j["routes"]:
        coords = rt["geometry"]["coordinates"]
        wps = [s for s in rt["steps"] if s["maneuver"] == "waypoint"]
        assert len(wps) == 1
        wp = wps[0]
        assert coords[wp["geometry_index"]] == pytest.approx([VIA[1], VIA[0]], abs=1e-6)
        assert wp["location"] == pytest.approx([VIA[1], VIA[0]], abs=1e-6)
        assert rt["steps"][0]["maneuver"] == "depart" and rt["steps"][-1]["maneuver"] == "arrive"
        idx = [s["geometry_index"] for s in rt["steps"]]
        assert idx == sorted(idx)
    direct = client.post("/api/routes", json=body()).json()["routes"][0]
    assert j["routes"][0]["distance_m"] > direct["distance_m"]


def test_via_same_as_origin_is_ignored(client):
    j = client.post("/api/routes", json=body(via={"lat": ORIGIN[0], "lon": ORIGIN[1]})).json()
    assert all(s["maneuver"] != "waypoint" for rt in j["routes"] for s in rt["steps"])


def test_via_outside_bbox(client):
    r = client.post("/api/routes", json=body(via={"lat": 0.0, "lon": 0.0}))
    assert r.status_code == 400
    assert "fora da cidade" in r.json()["detail"]


def test_exposure_by_period(client):
    j = client.post("/api/routes", json=body()).json()
    for rt in j["routes"]:
        assert set(rt["exposure_by_period"]) == {"madrugada", "manha", "tarde", "noite"}
        assert set(rt["level_by_period"]) == set(rt["exposure_by_period"])
        assert rt["exposure_by_period"]["noite"] == pytest.approx(rt["exposure"], abs=1e-3)
        assert rt["level_by_period"]["noite"] == rt["risk_level"]
