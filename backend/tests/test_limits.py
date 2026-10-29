import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.ratelimit import RateLimiter
from backend.tests.conftest import DEST, ORIGIN

BODY = {
    "origin": {"lat": ORIGIN[0], "lon": ORIGIN[1]},
    "destination": {"lat": DEST[0], "lon": DEST[1]},
    "mode": "walk",
}
MSG = "Muitas requisições; aguarde um instante e tente novamente."


def make(data_dir, tmp_path, **limits):
    return TestClient(create_app(processed_dir=data_dir, frontend_dir=tmp_path / "nofront", rate_limits=limits))


def test_429_after_limit(data_dir, tmp_path):
    with make(data_dir, tmp_path, risk=3) as c:
        q = {"bbox": "-46.7,-23.6,-46.6,-23.5"}
        assert [c.get("/api/risk", params=q).status_code for _ in range(3)] == [200] * 3
        r = c.get("/api/risk", params=q)
        assert r.status_code == 429 and r.json() == {"detail": MSG}
        assert int(r.headers["Retry-After"]) >= 1
        assert c.get("/api/health").status_code == 200  # não limitado


def test_keyed_by_forwarded_for(data_dir, tmp_path):
    with make(data_dir, tmp_path, routes=1) as c:
        h1, h2 = {"X-Forwarded-For": "1.1.1.1, 10.0.0.1"}, {"X-Forwarded-For": "2.2.2.2"}
        assert c.post("/api/routes", json=BODY, headers=h1).status_code == 200
        assert c.post("/api/routes", json=BODY, headers=h1).status_code == 429
        assert c.post("/api/routes", json=BODY, headers=h2).status_code == 200


def test_disabled_with_zero(data_dir, tmp_path):
    with make(data_dir, tmp_path, routes=0) as c:
        assert all(c.post("/api/routes", json=BODY).status_code == 200 for _ in range(5))


def test_env_override(data_dir, tmp_path, monkeypatch):
    monkeypatch.setenv("SAMPANAV_RATE_ROUTES", "1")
    with make(data_dir, tmp_path) as c:
        assert c.post("/api/routes", json=BODY).status_code == 200
        assert c.post("/api/routes", json=BODY).status_code == 429


def test_window_expiry_and_prune():
    t = [0.0]
    lim = RateLimiter({"x": 2}, window_s=10, clock=lambda: t[0])
    assert lim.check("x", "a") is None and lim.check("x", "a") is None
    assert lim.check("x", "a") == pytest.approx(10)
    t[0] = 11
    assert lim.check("x", "a") is None
    t[0] = 200
    lim.check("x", "b")
    assert list(lim._hits) == [("x", "b")]


def test_engine_busy_503(data_dir, tmp_path, monkeypatch):
    monkeypatch.setenv("SAMPANAV_ROUTE_QUEUE_TIMEOUT", "0.05")
    with make(data_dir, tmp_path, routes=0) as c:
        with c.app.state.engine._lock:
            r = c.post("/api/routes", json=BODY)
        assert r.status_code == 503 and r.headers["Retry-After"] == "5"
        assert "ocupado" in r.json()["detail"]
        assert c.post("/api/routes", json=BODY).status_code == 200
