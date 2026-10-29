// Modo de navegação: acompanha a posição do usuário sobre a geometria da rota.
import { fmtMeters } from './format.js';
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
export const OFF_ROUTE_M = 40, OFF_ROUTE_FIXES = 3, ARRIVE_M = 25;

export function haversine(aLat, aLon, bLat, bLon) {
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function bearing(aLat, aLon, bLat, bLon) {
  const y = Math.sin(rad(bLon - aLon)) * Math.cos(rad(bLat));
  const x = Math.cos(rad(aLat)) * Math.sin(rad(bLat)) - Math.sin(rad(aLat)) * Math.cos(rad(bLat)) * Math.cos(rad(bLon - aLon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * ETA simples: tempo da rota escalado pela fração de distância restante.
 * Retorna { remainingM, remainingS, arrival: Date } (null sem duração).
 */
export function etaInfo(route, remainingM, totalM, now = new Date()) {
  const dur = route?.duration_s;
  if (!(dur >= 0) || !(totalM > 0)) return null;
  const rem = Math.min(Math.max(remainingM, 0), totalM);
  const remainingS = (dur * rem) / totalM;
  return { remainingM: rem, remainingS, arrival: new Date(now.getTime() + remainingS * 1000) };
}

/** Distância (m) do "Vire agora": a pé 30, de carro 60 (pela velocidade média), 40 sem dados. */
export function turnNowM(route) {
  const v = route?.duration_s > 0 && route?.distance_m > 0 ? route.distance_m / route.duration_s : 0;
  return !v ? 40 : v > 4 ? 60 : 30;
}

/** coords = [[lon,lat],...] -> comprimentos acumulados (m) por vértice. */
export function buildPath(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversine(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]));
  }
  return { coords, cum, total: cum[cum.length - 1] || 0 };
}

/**
 * Projeta (lat,lon) na polilinha. Retorna { dist, seg, along }.
 * Entre trechos igualmente próximos (rota que cruza a si mesma) prefere o que não
 * volta mais que 30 m em relação ao progresso anterior (lastAlong).
 */
export function project(path, lat, lon, lastAlong = 0) {
  const { coords, cum } = path;
  const ky = (Math.PI / 180) * R, kx = ky * Math.cos(rad(lat));
  const cand = [];
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = (coords[i][0] - lon) * kx, ay = (coords[i][1] - lat) * ky;
    const dx = (coords[i + 1][0] - lon) * kx - ax, dy = (coords[i + 1][1] - lat) * ky - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / l2)) : 0;
    const dist = Math.hypot(ax + t * dx, ay + t * dy);
    const along = cum[i] + t * (cum[i + 1] - cum[i]);
    cand.push([dist, i, along]);
    if (dist < best) best = dist;
  }
  let pick = null;
  for (const c of cand) {
    if (c[0] <= best + 15 && c[2] >= lastAlong - 30 && (!pick || c[2] < pick[2])) pick = c;
  }
  if (!pick) pick = cand.reduce((a, b) => (b[0] < a[0] ? b : a), cand[0] || [0, 0, 0]);
  return { dist: pick[0], seg: pick[1], along: pick[2] };
}

// ---- Fonte de posição: GPS real ou simulado (?simgps=1, para testes) ----
const SIM = new URLSearchParams(location.search).has('simgps');

function pointAt(path, m) {
  const { coords, cum } = path;
  m = Math.min(Math.max(m, 0), path.total);
  let i = 0;
  while (i < coords.length - 2 && cum[i + 1] < m) i++;
  const seg = cum[i + 1] - cum[i] || 1, t = (m - cum[i]) / seg;
  const a = coords[i], b = coords[i + 1];
  return { lon: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t,
    heading: bearing(a[1], a[0], b[1], b[0]) };
}

/** Gancho de depuração: window.__simgps = { speed, paused, along, north, east, seek(m) }. */
function simWatch(path, onFix) {
  const sim = window.__simgps = { speed: 14, paused: false, along: 0, north: 0, east: 0, tickMs: 500,
    seek(m) { this.along = m; } };
  const tick = () => {
    if (!sim.paused) sim.along = Math.min(path.total, sim.along + sim.speed * sim.tickMs / 1000);
    const p = pointAt(path, sim.along);
    onFix({ lat: p.lat + sim.north / 111195, lon: p.lon + sim.east / (111195 * Math.cos(rad(p.lat))),
      accuracy: 5, heading: p.heading, speed: sim.paused ? 0 : sim.speed });
  };
  tick();
  const id = setInterval(tick, sim.tickMs);
  return () => clearInterval(id);
}

function geoWatch(path, onFix, onError) {
  if (SIM) return simWatch(path, onFix);
  const id = navigator.geolocation.watchPosition(
    (pos) => onFix({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy,
      heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null, speed: pos.coords.speed }),
    onError, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  return () => navigator.geolocation.clearWatch(id);
}

/**
 * deps: { map (mapApi), ui (navui), recalc(pos) -> Promise<route>, onExit() }
 */
const lcFirst = (t) => (t ? t[0].toLowerCase() + t.slice(1) : t);
const MAN = { left: 'Vire à esquerda', right: 'Vire à direita', 'slight-left': 'Siga à esquerda', 'slight-right': 'Siga à direita',
  'sharp-left': 'Vire acentuadamente à esquerda', 'sharp-right': 'Vire acentuadamente à direita', uturn: 'Faça o retorno', waypoint: 'Parada', arrive: 'Você chegou' };
/** Frase curta para o "agora": usa o tipo de manobra, senão a instrução. */
export function shortManeuver(step) {
  return MAN[step?.maneuver] || step?.instruction || '';
}

export function createNavigator({ map, ui, recalc, onExit }) {
  let route = null, path = null, steps = [], stopWatch = null, wake = null;
  let active = false, arrived = false, offCount = 0, lastAlong = 0, lastFix = null, prevFix = null;
  let following = true, offRoute = false, curStep = -1, announced = '', nowSpoken = false, gotFix = false, busy = false;

  async function lock() {
    try {
      if (!('wakeLock' in navigator) || wake || document.visibilityState !== 'visible') return;
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    } catch { wake = null; }
  }
  function unlock() { try { wake?.release(); } catch { /* ignora */ } wake = null; }
  const onVis = () => { if (active && document.visibilityState === 'visible') lock(); };

  function onError(err) {
    if (!gotFix) {
      const msg = !navigator.geolocation ? 'Seu navegador não oferece localização.'
        : err?.code === 1 ? 'Permissão de localização negada. Ative a localização do navegador para usar a navegação.'
          : 'Não foi possível obter sua localização. Verifique o GPS e tente novamente.';
      stop(); ui.error(msg);
    } else ui.notice('Sinal de GPS fraco ou indisponível…');
  }

  function onFixes(fix) {
    if (!active) return;
    gotFix = true; ui.notice('');
    prevFix = lastFix; lastFix = fix;
    let heading = fix.heading;
    if (heading == null && prevFix && haversine(prevFix.lat, prevFix.lon, fix.lat, fix.lon) > 3) {
      heading = bearing(prevFix.lat, prevFix.lon, fix.lat, fix.lon);
    }
    map.setUser(fix, heading);
    if (following) map.follow(fix);

    const end = path.coords[path.coords.length - 1];
    const toEnd = haversine(fix.lat, fix.lon, end[1], end[0]);
    if (toEnd < ARRIVE_M) { arrive(); return; }

    const pr = project(path, fix.lat, fix.lon, lastAlong);
    if (pr.dist > OFF_ROUTE_M && !(fix.accuracy > 100)) offCount++; else if (pr.dist <= OFF_ROUTE_M) offCount = 0;
    if (offCount >= OFF_ROUTE_FIXES) {
      if (!offRoute) { offRoute = true; ui.offRoute(true); ui.announce('Você saiu da rota. Recalcular?', true); }
      return;
    }
    if (offRoute && pr.dist <= OFF_ROUTE_M) { offRoute = false; ui.offRoute(false); }
    if (offRoute) return;
    lastAlong = pr.along;

    let cur = -1;
    steps.forEach((s, i) => { if (s.geometry_index <= pr.seg) cur = i; });
    const next = steps[cur + 1] || null;
    const distNext = next ? Math.max(0, path.cum[Math.min(next.geometry_index, path.cum.length - 1)] - pr.along) : 0;
    if (cur !== curStep) { curStep = cur; ui.highlightStep(cur); }
    const key = `${cur}`;
    const remaining = Math.max(0, path.total - pr.along);
    ui.update({ step: steps[cur] || null, next, distNext, remaining, hasSteps: steps.length > 0,
      eta: etaInfo(route, remaining, path.total) });
    if (key !== announced) {
      announced = key; nowSpoken = false;
      const t = next ? next.instruction : 'Siga a rota';
      ui.announce(next && distNext >= 40 ? `Em ${fmtMeters(distNext)}, ${lcFirst(t)}` : t, true);
    } else if (next && !nowSpoken && distNext < turnNowM(route)) {
      nowSpoken = true; ui.announce(shortManeuver(next), true);
    }
  }

  function arrive() {
    arrived = true; stopWatch?.(); stopWatch = null;
    ui.arrived(); ui.announce('Você chegou ao destino', true);
  }

  function begin(r) {
    stopWatch?.();
    route = r; path = buildPath(r.geometry.coordinates);
    steps = (r.steps || []).filter((s) => Number.isInteger(s.geometry_index)).sort((a, b) => a.geometry_index - b.geometry_index);
    arrived = false; offCount = 0; offRoute = false; lastAlong = 0; curStep = -1; announced = ''; nowSpoken = false;
    ui.offRoute(false);
    stopWatch = geoWatch(path, onFixes, onError);
  }

  async function start(r) {
    if (!SIM && !navigator.geolocation) { ui.error('Seu navegador não oferece localização.'); return false; }
    if (!r?.geometry?.coordinates?.length) return false;
    active = true; following = true; gotFix = false; lastFix = prevFix = null;
    ui.show(true, r);
    begin(r);
    lock(); document.addEventListener('visibilitychange', onVis);
    return true;
  }

  function stop() {
    const was = active;
    active = false; stopWatch?.(); stopWatch = null; unlock();
    document.removeEventListener('visibilitychange', onVis);
    map.removeUser(); ui.show(false); ui.silence?.(); ui.highlightStep(-1);
    if (was) onExit?.();
  }

  async function doRecalc() {
    if (busy || !lastFix) return;
    busy = true; ui.recalcBusy(true);
    try {
      const r = await recalc({ lat: lastFix.lat, lon: lastFix.lon });
      if (active && r) { begin(r); ui.show(true, r); ui.notice(''); }
    } catch (e) { ui.notice(e?.friendly && e.message ? e.message : 'Não foi possível recalcular a rota.'); }
    finally { busy = false; ui.recalcBusy(false); }
  }

  function recenter() { following = true; ui.following(true); if (lastFix) map.follow(lastFix); }
  function userPanned() { if (active && following) { following = false; ui.following(false); } }

  return { start, stop, recalc: doRecalc, recenter, userPanned, isActive: () => active };
}
