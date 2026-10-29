import { httpErrorMessage } from './format.js';
const PARAMS = new URLSearchParams(location.search);
const MOCK = PARAMS.get('mock') === '1';
export const isMock = MOCK;
/** Base da API (config.js). Vazio = mesma origem. */
const BASE = String((window.SAMPANAV_CONFIG && window.SAMPANAV_CONFIG.apiBase) || '').replace(/\/+$/, '');
let mockMod;
async function mock() { return (mockMod ??= await import('./mock.js')); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Erro com mensagem já amigável (seguro para exibir). */
function friendly(msg, status) { const e = new Error(msg); e.friendly = true; e.status = status; return e; }
const TIMEOUT_MS = 60000;

/** fetch com 1 retry em erro de rede / 502 / 503 (servidor acordando ou reiniciando) e timeout. */
async function http(path, opts = {}, retries = 1) {
  const outer = opts.signal;
  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController();
    let timedOut = false;
    const onAbort = () => ctl.abort();
    outer?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, TIMEOUT_MS);
    let res, body = null;
    try {
      res = await fetch(BASE + path, { ...opts, signal: ctl.signal });
      if (!((res.status === 502 || res.status === 503) && attempt < retries)) { try { body = await res.json(); } catch { /* ignora */ } }
    } catch (e) {
      if (outer?.aborted) throw e;
      if (timedOut) throw friendly('O servidor demorou para responder. Tente novamente.', 0);
      if (attempt < retries) { await sleep(1500); continue; }
      throw friendly('Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.', 0);
    } finally { clearTimeout(timer); outer?.removeEventListener('abort', onAbort); }
    if ((res.status === 502 || res.status === 503) && attempt < retries) { await sleep(1500); continue; }
    if (!res.ok) throw friendly(httpErrorMessage(res.status, body && body.detail), res.status);
    return body;
  }
}

/** Uma tentativa de /api/health com timeout. */
async function healthOnce(timeoutMs = 8000) {
  if (MOCK) return (await mock()).health();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) return false;
    // O backend abre a porta antes de carregar os grafos e responde status "loading".
    const body = await res.json().catch(() => ({}));
    return body.status !== 'loading';
  } catch { return false; } finally { clearTimeout(t); }
}

/**
 * Espera o servidor responder (cold start do plano gratuito pode levar ~1 min).
 * Retry com backoff até maxMs. Retorna true/false; onWait(tentativa) a cada falha.
 */
// Render free: ~1 min para acordar o container + ~50 s para carregar os grafos.
export async function waitForServer({ maxMs = 180000, onWait } = {}) {
  const t0 = Date.now();
  for (let n = 0; ; n++) {
    let ok = false;
    try { ok = await healthOnce(); } catch { ok = false; }
    if (ok) return true;
    if (Date.now() - t0 >= maxMs) return false;
    onWait?.(n + 1);
    await sleep(Math.min(1000 * 1.5 ** n, 6000));
  }
}

export async function getMeta() { return MOCK ? (await mock()).meta() : http('/api/meta'); }
export async function geocode(q, signal) {
  return MOCK ? (await mock()).geocode(q) : http(`/api/geocode?q=${encodeURIComponent(q)}`, { signal });
}
export async function reverseGeocode(lat, lon, signal) {
  return MOCK ? (await mock()).reverse(lat, lon) : http(`/api/reverse?lat=${lat}&lon=${lon}`, { signal }, 0);
}
export async function postRoutes(payload, signal) {
  return MOCK ? (await mock()).routes(payload) : http('/api/routes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal,
  });
}
export async function getRisk(bbox, mode, period, signal) {
  const qs = new URLSearchParams({ bbox: bbox.join(','), mode, period });
  return MOCK ? (await mock()).risk(bbox, mode, period) : http(`/api/risk?${qs}`, { signal });
}
