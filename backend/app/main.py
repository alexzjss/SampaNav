"""API FastAPI do SampaNav. Também serve o frontend estático em /."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend.app import geocode as geo
from backend.app.routing import PROFILES, Engine, RoutingError
from pipeline.config import DATA_PROCESSED, PERIODS, ROOT

Mode = Literal["walk", "drive"]
PeriodName = Literal["all", "madrugada", "manha", "tarde", "noite"]


class Point(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class RouteRequest(BaseModel):
    origin: Point
    destination: Point
    mode: Mode = "walk"
    period: Literal["now", "all", "madrugada", "manha", "tarde", "noite"] = "now"


class VsFastest(BaseModel):
    duration_pct: float
    exposure_pct: float


class LineString(BaseModel):
    type: Literal["LineString"] = "LineString"
    coordinates: list[list[float]]


class Segment(BaseModel):
    coordinates: list[list[float]]
    risk: float


class RouteOut(BaseModel):
    id: str
    label: str
    alpha: float
    distance_m: float
    duration_s: int
    exposure: float
    avg_risk: float
    risk_level: str
    vs_fastest: VsFastest
    categories: dict[str, int]
    geometry: LineString
    segments: list[Segment]


class DataInfo(BaseModel):
    date_min: str | None = None
    date_max: str | None = None
    source: str = "SSP-SP"


class RouteResponse(BaseModel):
    mode: Mode
    period: PeriodName
    routes: list[RouteOut]
    data: DataInfo


class GeocodeItem(BaseModel):
    label: str
    lat: float
    lon: float


class RiskCell(BaseModel):
    h3: str
    risk: float


def resolve_period(period: str, now: datetime | None = None) -> str:
    if period != "now":
        return period
    if now is None:
        try:
            from zoneinfo import ZoneInfo

            now = datetime.now(ZoneInfo("America/Sao_Paulo"))
        except Exception:  # sem tzdata: SP está em UTC-3 (sem horário de verão)
            now = datetime.now(timezone(timedelta(hours=-3)))
    h = now.hour
    if h < 6:
        return "madrugada"
    if h < 12:
        return "manha"
    if h < 18:
        return "tarde"
    return "noite"


def create_app(processed_dir: Path | None = None, frontend_dir: Path | None = None) -> FastAPI:
    processed = Path(processed_dir or os.environ.get("SAMPANAV_DATA_DIR") or DATA_PROCESSED)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.engine = Engine(processed)
        yield
        await geo.close()

    app = FastAPI(title="SampaNav", version="0.1.0", lifespan=lifespan)

    def engine() -> Engine:
        return app.state.engine

    @app.get("/api/health")
    def health():
        e = engine()
        graphs = {
            m: {"nodes": g.n_nodes, "edges": g.n_edges} if (g := e.graphs.get(m)) else {"nodes": 0, "edges": 0}
            for m in ("walk", "drive")
        }
        out = {"status": "ok" if not e.missing else "degraded", "graphs": graphs}
        if e.missing:
            out["missing"] = e.missing
            out["detail"] = (
                "Grafos ausentes: rode `uv run python -m pipeline.build_graph` para gerar data/processed/graph_*.npz."
            )
        out["risk_source"] = e.risk_path.name if e.risk_path else None
        return out

    @app.get("/api/meta")
    def meta():
        m = dict(engine().meta)
        m["profiles"] = [{"id": i, "label": lbl, "alpha": a} for i, lbl, a in PROFILES]
        m["periods"] = list(PERIODS)
        return m

    @app.get("/api/geocode", response_model=list[GeocodeItem])
    async def geocode_ep(q: str = Query("", max_length=200)):
        try:
            return await geo.geocode(q)
        except geo.GeocodeError as e:
            raise HTTPException(502, str(e))

    @app.post("/api/routes", response_model=RouteResponse)
    def routes(req: RouteRequest):
        e = engine()
        period = resolve_period(req.period)
        try:
            routes = e.compute(
                req.mode, (req.origin.lat, req.origin.lon), (req.destination.lat, req.destination.lon), period
            )
        except RoutingError as ex:
            raise HTTPException(400, str(ex))
        return {
            "mode": req.mode,
            "period": period,
            "routes": routes,
            "data": {"date_min": e.meta.get("date_min"), "date_max": e.meta.get("date_max"), "source": "SSP-SP"},
        }

    @app.get("/api/risk", response_model=list[RiskCell])
    def risk(bbox: str, mode: Mode = "walk", period: str = "now"):
        try:
            b = [float(x) for x in bbox.split(",")]
            if len(b) != 4:
                raise ValueError
        except ValueError:
            raise HTTPException(400, "bbox deve ser minLon,minLat,maxLon,maxLat")
        p = resolve_period(period)
        if p not in PERIODS:
            raise HTTPException(400, "período inválido")
        return engine().risk_store.cells_in_bbox(mode, p, b)

    fe = Path(frontend_dir) if frontend_dir else ROOT / "frontend"
    if fe.is_dir():
        app.mount("/", StaticFiles(directory=fe, html=True), name="frontend")
    return app


app = create_app()
