"""Limitador de taxa em memória (janela deslizante, por IP e por endpoint). Sem dependências."""

from __future__ import annotations

import hashlib
import ipaddress
import logging
import os
import threading
import time
from collections import deque
from collections.abc import Callable

from fastapi import HTTPException, Request

log = logging.getLogger("sampanav")

WINDOW_S = 60.0
DEFAULT_RATES = {"routes": 20, "geocode": 60, "risk": 120}  # requisições por minuto; 0 desliga
MAX_KEYS = 10_000  # teto de chaves (IPs) para limitar memória
PRUNE_EVERY_S = 60.0
DETAIL = "Muitas requisições; aguarde um instante e tente novamente."


def _valid_ip(raw: str) -> str | None:
    try:  # só IPs válidos viram chave (um valor arbitrário/gigante estouraria a memória do limitador)
        return str(ipaddress.ip_address(raw.strip()))
    except ValueError:
        return None


def trusted_proxies() -> int:
    try:
        return max(1, int(os.environ.get("SAMPANAV_TRUSTED_PROXIES", "2")))
    except ValueError:
        return 2


def client_ip(request: Request) -> str:
    """IP do cliente para o limitador, sem confiar no que o próprio cliente manda.

    1. Cabeçalho de borda, se configurado e presente (`SAMPANAV_CLIENT_IP_HEADER`,
       padrão `cf-connecting-ip`).
    2. X-Forwarded-For contado da direita: cada proxy anexa o IP de quem o chamou, então
       com N proxies confiáveis o IP real é a N-ésima entrada a partir do fim
       (`SAMPANAV_TRUSTED_PROXIES`, padrão 2: Cloudflare + balanceador do Render, medido em
       produção). O início da lista vem do cliente e pode ser forjado.
    3. Sem proxy, o IP da conexão.
    """
    name = os.environ.get("SAMPANAV_CLIENT_IP_HEADER", "cf-connecting-ip").strip().lower()
    if name and (ip := _valid_ip(request.headers.get(name, ""))):
        return ip
    parts = [p for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
    if parts:
        n = trusted_proxies()
        # lista mais curta que o número de proxies: a entrada mais antiga ainda foi anexada por um deles
        if ip := _valid_ip(parts[-n] if len(parts) >= n else parts[0]):
            return ip
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
    def __init__(self, rates: dict[str, int], window_s: float = WINDOW_S, clock: Callable[[], float] = time.monotonic) -> None:
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


def rate_limit(name: str) -> Callable[[Request], None]:
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
