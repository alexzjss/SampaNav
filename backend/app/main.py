"""API FastAPI do SampaNav. Também serve o frontend estático em /."""

from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from backend.app import geocode as geo
from backend.app.ratelimit import RateLimiter, load_rates, rate_limit
from backend.app.routing import PROFILES, Engine, EngineBusy, RoutingError
from pipeline.config import DATA_PROCESSED, PERIODS, ROOT, SP_BBOX

log = logging.getLogger("sampanav")
if not log.handlers and not logging.getLogger().handlers:  # uvicorn não configura loggers da aplicação
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(levelname)s:     %(name)s: %(message)s"))
    log.addHandler(_h)
    log.setLevel(logging.INFO)

Mode = Literal["walk", "drive", "bike"]
PeriodName = Literal["all", "madrugada", "manha", "tarde", "noite"]
PeriodQuery = Literal["now", "all", "madrugada", "manha", "tarde", "noite"]


class Point(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class RouteRequest(BaseModel):
    origin: Point
    destination: Point
    mode: Mode = "walk"
    period: PeriodQuery = "now"
    via: Point | None = None  # parada opcional entre origem e destino


class VsFastest(BaseModel):
    duration_pct: float
    exposure_pct: float


class LineString(BaseModel):
    type: Literal["LineString"] = "LineString"
    coordinates: list[list[float]]


class Segment(BaseModel):
    coordinates: list[list[float]]
    risk: float


class Step(BaseModel):
    maneuver: Literal[
        "depart", "continue", "slight-left", "left", "sharp-left",
        "slight-right", "right", "sharp-right", "uturn", "waypoint", "arrive",
    ]
    instruction: str
    street: str = ""
    distance_m: float
    duration_s: int
    location: list[float]
    geometry_index: int


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
    steps: list[Step] = []
    exposure_by_period: dict[str, float] = {}
    level_by_period: dict[str, str] = {}


class DataInfo(BaseModel):
    date_min: str | None = None
    date_max: str | None = None
    source: str = "SSP-SP"


class RouteResponse(BaseModel):
    mode: Mode
    period: PeriodName
    routes: list[RouteOut]
    via: Point | None = None
    data: DataInfo


class GeocodeItem(BaseModel):
    label: str
    lat: float
    lon: float


class RiskCell(BaseModel):
    h3: str
    risk: float


class ProfileInfo(BaseModel):
    id: str
    label: str
    alpha: float


class MetaResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    profiles: list[ProfileInfo]
    periods: list[str]
    generated_at: str | None = None
    date_min: str | None = None
    date_max: str | None = None
    n_occurrences: int | None = None
    categories: list[str] | dict | None = None
    weights: dict | None = None
    synthetic: bool | None = None


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


def allowed_origins() -> list[str]:
    return [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]


def create_app(
    processed_dir: Path | None = None,
    frontend_dir: Path | None = None,
    background_load: bool | None = None,
    rate_limits: dict | None = None,
) -> FastAPI:
    """background_load: carrega os grafos numa thread depois de abrir a porta (deploy com pouca CPU).
    Padrão: variável SAMPANAV_BACKGROUND_LOAD=1; nos testes, carga síncrona.
    rate_limits: {"routes"|"geocode"|"risk": req/min por IP, 0 desliga}; sobrepõe SAMPANAV_RATE_*."""
    processed = Path(processed_dir or os.environ.get("SAMPANAV_DATA_DIR") or DATA_PROCESSED)
    if background_load is None:
        background_load = os.environ.get("SAMPANAV_BACKGROUND_LOAD", "") == "1"

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if background_load:
            app.state.engine = Engine(processed, load=False)
            threading.Thread(target=app.state.engine.load, name="engine-load", daemon=True).start()
        else:
            app.state.engine = Engine(processed)
        yield
        await geo.close()

    app = FastAPI(title="SampaNav", version="1.2.0", lifespan=lifespan)
    app.state.limiter = RateLimiter(load_rates(rate_limits))
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    origins = allowed_origins()
    if origins:
        app.add_middleware(
            CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"]
        )

    def engine() -> Engine:
        return app.state.engine

    @app.get("/api/health")
    def health():
        e = engine()
        graphs = {
            m: {"nodes": g.n_nodes, "edges": g.n_edges} if (g := e.graphs.get(m)) else {"nodes": 0, "edges": 0}
            for m in ("walk", "drive", "bike")
        }
        status = "loading" if not e.ready.is_set() else ("ok" if not e.missing else "degraded")
        out = {"status": status, "graphs": graphs}
        if e.missing:
            out["missing"] = e.missing
            out["detail"] = (
                "Grafos ausentes: rode `uv run python -m pipeline.build_graph` para gerar data/processed/graph_*.npz."
            )
        out["risk_source"] = e.risk_path.name if e.risk_path else None
        return out

    @app.get("/api/meta", response_model=MetaResponse)
    def meta():
        m = dict(engine().meta)
        m["profiles"] = [{"id": i, "label": lbl, "alpha": a} for i, lbl, a in PROFILES]
        m["periods"] = list(PERIODS)
        m["modes"] = list(engine().graphs)
        return m

    @app.get("/api/geocode", response_model=list[GeocodeItem], dependencies=[Depends(rate_limit("geocode"))])
    async def geocode_ep(q: str = Query("", max_length=200)):
        try:
            return await geo.geocode(q)
        except geo.GeocodeError as e:
            raise HTTPException(502, str(e)) from e

    @app.get("/api/reverse", response_model=GeocodeItem | None, dependencies=[Depends(rate_limit("geocode"))])
    async def reverse_ep(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180)):
        if not (SP_BBOX[0] <= lon <= SP_BBOX[2] and SP_BBOX[1] <= lat <= SP_BBOX[3]):
            raise HTTPException(400, "Ponto fora da região de São Paulo.")
        try:
            return await geo.reverse(lat, lon)
        except geo.GeocodeError as e:
            raise HTTPException(502, str(e)) from e

    @app.post("/api/routes", response_model=RouteResponse, dependencies=[Depends(rate_limit("routes"))])
    def routes(req: RouteRequest):
        e = engine()
        if not e.ready.is_set():
            raise HTTPException(503, "Servidor iniciando; tente novamente em instantes.")
        period = resolve_period(req.period)
        try:
            routes = e.compute(
                req.mode, (req.origin.lat, req.origin.lon), (req.destination.lat, req.destination.lon), period,
                (req.via.lat, req.via.lon) if req.via else None,
            )
        except RoutingError as ex:
            raise HTTPException(400, str(ex)) from ex
        except EngineBusy as ex:
            log.warning("503 fila de cálculo cheia: %s", ex)
            raise HTTPException(
                503, "Servidor ocupado; tente novamente em instantes.", headers={"Retry-After": "5"}
            ) from ex
        return {
            "mode": req.mode,
            "period": period,
            "routes": routes,
            "via": req.via.model_dump() if req.via else None,
            "data": {"date_min": e.meta.get("date_min"), "date_max": e.meta.get("date_max"), "source": "SSP-SP"},
        }

    @app.get("/api/risk", response_model=list[RiskCell], dependencies=[Depends(rate_limit("risk"))])
    def risk(bbox: str, mode: Mode = "walk", period: PeriodQuery = "now"):
        try:
            b = [float(x) for x in bbox.split(",")]
            if len(b) != 4:
                raise ValueError
        except ValueError:
            raise HTTPException(400, "bbox deve ser minLon,minLat,maxLon,maxLat") from None
        p = resolve_period(period)
        return engine().risk_store.cells_in_bbox("walk" if mode == "bike" else mode, p, b)

    fe = Path(frontend_dir) if frontend_dir else ROOT / "frontend"
    if fe.is_dir():
        app.mount("/", StaticFiles(directory=fe, html=True), name="frontend")
    return app


app = create_app()
