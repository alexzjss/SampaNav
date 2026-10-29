"""Proxy assíncrono para o Photon (komoot) restrito à bbox de São Paulo."""

from __future__ import annotations

from collections import OrderedDict

import httpx

from pipeline.config import SP_BBOX

PHOTON_URL = "https://photon.komoot.io/api/"
USER_AGENT = "SampaNav/1.0 (+https://github.com/alexzjss/SampaNav)"
CACHE_SIZE = 512


class GeocodeError(Exception):
    pass


_cache: OrderedDict[str, list[dict]] = OrderedDict()
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=8.0, headers={"User-Agent": USER_AGENT})
    return _client


async def close() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def _label(p: dict) -> str:
    street = p.get("street")
    if street and p.get("housenumber"):
        street = f"{street}, {p['housenumber']}"
    parts = [p.get("name"), street, p.get("district") or p.get("locality"), p.get("city")]
    out: list[str] = []
    for x in parts:
        if x and x not in out:
            out.append(x)
    return ", ".join(out)


def parse(payload: dict) -> list[dict]:
    res, seen = [], set()
    for f in payload.get("features", []):
        try:
            lon, lat = f["geometry"]["coordinates"][:2]
        except (KeyError, TypeError, ValueError):
            continue
        label = _label(f.get("properties", {}))
        if not label or label in seen:
            continue
        seen.add(label)
        res.append({"label": label, "lat": float(lat), "lon": float(lon)})
    return res


async def geocode(q: str) -> list[dict]:
    q = " ".join(q.split())
    if len(q) < 3:
        return []
    key = q.lower()
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    params = {
        "q": q,
        "bbox": ",".join(str(x) for x in SP_BBOX),
        "lang": "default",
        "limit": 6,
    }
    try:
        r = await _get_client().get(PHOTON_URL, params=params)
        r.raise_for_status()
        result = parse(r.json())
    except (httpx.HTTPError, ValueError) as e:
        raise GeocodeError(f"Falha ao consultar o serviço de geocodificação: {e}") from e
    _cache[key] = result
    while len(_cache) > CACHE_SIZE:
        _cache.popitem(last=False)
    return result
