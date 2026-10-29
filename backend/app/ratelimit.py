"""Limitador de taxa em memória (janela deslizante, por IP e por endpoint). Sem dependências."""

from __future__ import annotations

import hashlib
import logging
import os
import threading
import time
from collections import deque

from fastapi import HTTPException, Request

log = logging.getLogger("sampanav")

WINDOW_S = 60.0
DEFAULT_RATES = {"routes": 20, "geocode": 60, "risk": 120}  # requisições por minuto; 0 desliga
MAX_KEYS = 10_000  # teto de chaves (IPs) para limitar memória
PRUNE_EVERY_S = 60.0
DETAIL = "Muitas requisições; aguarde um instante e tente novamente."


def client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for", "")
    first = xff.split(",")[0].strip()
    if first:
        return first
    return request.client.host if request.client else "unknown"


def anon(ip: str) -> str:
    """Hash curto do IP para logs (privacidade)."""
    return hashlib.sha256(ip.encode()).hexdigest()[:8]


def load_rates(overrides: dict | None = None) -> dict[str, int]:
    rates = dict(DEFAULT_RATES)
    for name in rates:
        raw = os.environ.get(f"SAMPANAV_RATE_{name.upper()}")
        if raw is not None and raw.strip():
            try:
                rates[name] = max(0, int(raw))
            except ValueError:
                log.warning("SAMPANAV_RATE_%s inválido: %r", name.upper(), raw)
    for name, v in (overrides or {}).items():
        rates[name] = max(0, int(v))
    return rates


class RateLimiter:
    def __init__(self, rates: dict[str, int], window_s: float = WINDOW_S, clock=time.monotonic):
        self.rates = rates
        self.window = window_s
        self.clock = clock
        self._hits: dict[tuple[str, str], deque[float]] = {}
        self._lock = threading.Lock()
        self._last_prune = clock()

    def check(self, name: str, key: str) -> float | None:
        """None se permitido; senão segundos até poder tentar de novo."""
        limit = self.rates.get(name, 0)
        if limit <= 0:
            return None
        now = self.clock()
        with self._lock:
            if now - self._last_prune >= PRUNE_EVERY_S or len(self._hits) > MAX_KEYS:
                self._prune(now)
            q = self._hits.setdefault((name, key), deque())
            while q and now - q[0] >= self.window:
                q.popleft()
            if len(q) >= limit:
                return max(0.0, self.window - (now - q[0]))
            q.append(now)
            return None

    def _prune(self, now: float) -> None:
        self._last_prune = now
        for k in [k for k, q in self._hits.items() if not q or now - q[-1] >= self.window]:
            del self._hits[k]
        if len(self._hits) > MAX_KEYS:  # ainda acima do teto: descarta os mais antigos
            old = sorted(self._hits, key=lambda k: self._hits[k][-1])
            for k in old[: len(self._hits) - MAX_KEYS]:
                del self._hits[k]


def rate_limit(name: str):
    """Dependência FastAPI: aplica o limite `name` ao IP do cliente."""

    def dep(request: Request) -> None:
        lim: RateLimiter = request.app.state.limiter
        ip = client_ip(request)
        wait = lim.check(name, ip)
        if wait is not None:
            retry = max(1, int(wait) + 1)
            log.warning("429 endpoint=%s client=%s retry_after=%ds", name, anon(ip), retry)
            raise HTTPException(429, DETAIL, headers={"Retry-After": str(retry)})

    return dep
