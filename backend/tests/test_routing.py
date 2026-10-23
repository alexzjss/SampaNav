import numpy as np

from backend.app.routing import RoadGraph, RoutingError, risk_level, weighted_quantiles
from backend.tests.conftest import DEST, ORIGIN, make_arrays


def test_risk_level_thresholds():
    assert [risk_level(x) for x in (0.0, 0.15, 0.35, 0.6)] == ["baixo", "moderado", "alto", "muito alto"]


def test_snap_nearest():
    g = RoadGraph("walk", make_arrays())
    assert g.snap(*ORIGIN) == 0
    assert g.snap(*DEST) == 5


def test_alpha_zero_is_direct_and_safer_route_avoids_risk():
    g = RoadGraph("walk", make_arrays())
    routes = g.routes(ORIGIN, DEST, "all")
    fastest, other = routes[0], routes[-1]
    assert fastest.id == "rapida" and fastest.alpha == 0
    assert abs(fastest.distance_m - 5 * 102.1) < 2  # 5 passos em linha reta
    assert other.exposure < fastest.exposure
    assert other.distance_m > fastest.distance_m
    assert other.alpha > 0


def test_metrics_consistent():
    g = RoadGraph("walk", make_arrays())
    r = g.routes(ORIGIN, DEST, "all")[0]
    assert abs(r.exposure - r.distance_m * 0.9 / 1000) < 1e-3
    assert abs(r.avg_risk - 0.9) < 1e-3
    assert abs(r.duration_s - r.distance_m / 1.3) < 1


def test_dedup_returns_single_route_when_risk_uniform():
    g = RoadGraph("walk", make_arrays(risky_row0=False))
    routes = g.routes(ORIGIN, DEST, "all")
    # sem risco diferencial, alpha maior não muda o caminho: só 1 rota
    assert len(routes) == 1


def test_dedup_escalates_alpha():
    # risco moderado em linha reta: alpha=2 pode ainda coincidir; ao final nenhuma duplicata
    g = RoadGraph("walk", make_arrays())
    routes = g.routes(ORIGIN, DEST, "all")
    sets = [set(map(int, r.edges)) for r in routes]
    for i in range(len(sets)):
        for j in range(i + 1, len(sets)):
            assert len(sets[i] & sets[j]) / len(sets[j]) <= 0.9
    assert all(r.alpha <= 15 for r in routes)


def test_period_changes_route():
    g = RoadGraph("walk", make_arrays(risk_noite_only=True))
    noite = g.routes(ORIGIN, DEST, "noite")
    manha = g.routes(ORIGIN, DEST, "manha")
    assert len(noite) > 1
    assert len(manha) == 1


def test_segments_cover_route_and_group_by_risk():
    g = RoadGraph("walk", make_arrays())
    r = g.routes(ORIGIN, DEST, "all")[-1]
    segs = g.segments(r, "all")
    assert segs and all(len(s["coordinates"]) >= 2 for s in segs)
    assert segs[0]["coordinates"][0] == [round(float(r.coords[0][0]), 6), round(float(r.coords[0][1]), 6)]
    assert any(s["risk"] > 0.5 for s in g.segments(g.routes(ORIGIN, DEST, "all")[0], "all"))


def test_same_point_error():
    g = RoadGraph("walk", make_arrays())
    try:
        g.routes(ORIGIN, ORIGIN, "all")
    except RoutingError:
        pass
    else:
        raise AssertionError


def test_geometry_is_continuous():
    g = RoadGraph("walk", make_arrays())
    for r in g.routes(ORIGIN, DEST, "all"):
        c = np.asarray(r.coords)
        steps = np.hypot(np.diff(c[:, 0]) * 85000, np.diff(c[:, 1]) * 111320)
        assert steps.max() < 130


def test_risk_level_custom_thresholds():
    th = (0.2, 0.4, 0.8)
    assert [risk_level(x, th) for x in (0.1, 0.3, 0.5, 0.9)] == ["baixo", "moderado", "alto", "muito alto"]


def test_weighted_quantiles_respects_length():
    import numpy as np

    # uma rua longa de risco 0.1 domina a malha: mediana ponderada = 0.1
    values = np.array([0.1, 0.9, 0.8])
    weights = np.array([100.0, 1.0, 1.0])
    assert weighted_quantiles(values, weights, (0.5,))[0] == 0.1


def test_alternatives_must_reduce_exposure_meaningfully():
    from backend.app.routing import MIN_EXPOSURE_GAIN

    g = RoadGraph("walk", make_arrays())
    routes = g.routes(ORIGIN, DEST, "all")
    for i in range(1, len(routes)):
        best_before = min(r.exposure for r in routes[:i])
        assert routes[i].exposure <= best_before * (1 - MIN_EXPOSURE_GAIN)
