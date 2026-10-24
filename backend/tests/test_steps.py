"""Passos de navegação: classificação, fusão e texto, num grafo/rota sintéticos."""

import numpy as np
import pytest

from backend.app.routing import RoadGraph
from backend.app.steps import COSLAT, M_PER_DEG, build_steps, classify, fmt_dist, instruction
from backend.tests.conftest import DEST, LAT0, LON0, ORIGIN, STEP, make_arrays


def xy_to_ll(pts):
    pts = np.asarray(pts, float)
    return np.column_stack([-46.63 + pts[:, 0] / (COSLAT * M_PER_DEG), -23.55 + pts[:, 1] / M_PER_DEG])


def polyline(vertices, names, per_edge_pts=None):
    """Aresta k vai de vertices[k] a vertices[k+1]. Retorna kwargs de build_steps."""
    coords = xy_to_ll(vertices)
    k = len(vertices) - 1
    seg = np.hypot(*np.diff(np.asarray(vertices, float), axis=0).T)
    return dict(
        coords=coords,
        edge_starts=np.arange(k),
        names=names,
        lengths=seg,
        times=seg / 1.3,
        mode="walk",
    )


@pytest.mark.parametrize(
    "angle,expected",
    [
        (0, "continue"), (19, "continue"), (-19, "continue"),
        (20, "slight-right"), (-59, "slight-left"),
        (60, "right"), (-90, "left"), (134, "right"),
        (135, "sharp-right"), (-169, "sharp-left"),
        (170, "uturn"), (-180, "uturn"),
    ],
)
def test_classify_thresholds(angle, expected):
    assert classify(angle) == expected


def test_right_turn_onto_other_street():
    # 100 m para leste na Rua A, depois 100 m para o sul na Av. B => vire à direita
    st = build_steps(**polyline([(0, 0), (100, 0), (100, -100)], ["Rua A", "Avenida B"]))
    assert [s["maneuver"] for s in st] == ["depart", "right", "arrive"]
    assert st[0]["instruction"] == "Siga pela Rua A por 100 m"
    assert st[1]["instruction"] == "Vire à direita na Avenida B"
    assert st[1]["street"] == "Avenida B" and st[1]["geometry_index"] == 1
    assert st[1]["location"] == [round(float(xy_to_ll([(100, 0)])[0, 0]), 6), round(float(xy_to_ll([(100, 0)])[0, 1]), 6)]
    assert st[-1]["instruction"] == "Chegada ao destino" and st[-1]["geometry_index"] == 2


def test_left_turn_and_sharp_and_uturn():
    left = build_steps(**polyline([(0, 0), (100, 0), (100, 100)], ["Rua A", "Rua B"]))
    assert left[1]["maneuver"] == "left" and left[1]["instruction"] == "Vire à esquerda na Rua B"
    sharp = build_steps(**polyline([(0, 0), (100, 0), (20, -50)], ["Rua A", "Rua B"]))
    assert sharp[1]["maneuver"] == "sharp-right"
    u = build_steps(**polyline([(0, 0), (100, 0), (0, 3)], ["Rua A", "Rua B"]))
    assert u[1]["maneuver"] == "uturn" and u[1]["instruction"].startswith("Faça o retorno")


def test_same_name_edges_are_merged_and_straight_name_change_is_continue():
    st = build_steps(**polyline([(0, 0), (60, 0), (120, 3), (200, 3), (300, 3)], ["Rua A", "Rua A", "Rua B", "Rua B"]))
    assert [s["maneuver"] for s in st] == ["depart", "continue", "arrive"]
    assert st[0]["distance_m"] == pytest.approx(120.0, abs=0.5)
    assert st[1]["instruction"] == "Continue pela Rua B por 180 m"
    assert st[1]["duration_s"] == round(st[1]["distance_m"] / 1.3)


def test_unnamed_edges_merge_only_when_straight():
    st = build_steps(**polyline([(0, 0), (100, 0), (200, 0), (200, -100)], ["", "", ""]))
    assert [s["maneuver"] for s in st] == ["depart", "right", "arrive"]
    assert st[0]["instruction"] == "Siga pelo caminho por 200 m"
    assert st[1]["instruction"] == "Vire à direita no caminho"
    drive = polyline([(0, 0), (100, 0)], [""])
    drive["mode"] = "drive"
    assert build_steps(**drive)[0]["instruction"] == "Siga pela via sem nome por 100 m"


def test_short_unnamed_link_is_absorbed():
    # Rua A -> ligação sem nome de 10 m -> Rua B: um único giro, na Rua B
    st = build_steps(**polyline([(0, 0), (100, 0), (100, -10), (100, -110)], ["Rua A", "", "Rua B"]))
    assert [s["maneuver"] for s in st] == ["depart", "right", "arrive"]
    assert st[1]["street"] == "Rua B" and st[1]["distance_m"] == pytest.approx(110, abs=0.5)


def test_text_helpers():
    assert fmt_dist(7) == "7 m" and fmt_dist(124) == "120 m" and fmt_dist(1250) == "1,2 km"
    assert instruction("continue", "Rua Augusta", 300, "walk") == "Continue pela Rua Augusta por 300 m"
    assert instruction("left", "Largo São Francisco", 0, "walk") == "Vire à esquerda no Largo São Francisco"
    assert instruction("right", "Paulista", 0, "walk") == "Vire à direita em Paulista"
    assert instruction("sharp-left", "Rua X", 0, "drive") == "Faça uma curva fechada à esquerda na Rua X"


def test_steps_on_roadgraph_with_names():
    a = make_arrays(risky_row0=False)
    eu, ev = a["edge_u"], a["edge_v"]
    table = ["", "Rua Leste", "Rua Sul"]
    # arestas horizontais (mesma linha) = Rua Leste; verticais = Rua Sul
    a["edge_name"] = np.where(a["node_lat"][eu] == a["node_lat"][ev], 1, 2).astype(np.int32)
    a["name_table"] = np.array(table)
    g = RoadGraph("walk", a)
    # origem no canto (0,0) -> destino (2,3): rota passa por alguma curva
    r = g.routes(ORIGIN, (LAT0 - 2 * STEP, LON0 + 3 * STEP), "all")[0]
    st = g.steps(r)
    assert st[0]["maneuver"] == "depart" and st[-1]["maneuver"] == "arrive"
    assert abs(sum(s["distance_m"] for s in st) - r.distance_m) < 1.0
    assert all(0 <= s["geometry_index"] < len(r.coords) for s in st)
    assert [s["geometry_index"] for s in st] == sorted(s["geometry_index"] for s in st)
    assert {s["street"] for s in st} <= {"", "Rua Leste", "Rua Sul"}
    # sem nomes no grafo (formato antigo) ainda gera passos
    g2 = RoadGraph("walk", make_arrays(risky_row0=False))
    r2 = g2.routes(ORIGIN, DEST, "all")[0]
    assert [s["maneuver"] for s in g2.steps(r2)] == ["depart", "arrive"]
