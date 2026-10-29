import { getMeta, geocode, reverseGeocode, postRoutes, getRisk, isMock, waitForServer } from './api.js';
import { createMap, HEAT_MIN_ZOOM } from './map.js';
import { setupUi } from './ui.js';
import { setupNavBanner } from './navui.js';
import { createNavigator, buildPath, project } from './nav.js';
import { currentPeriod } from './format.js';
import { downloadGpx } from './gpx.js';
import { addHistory } from './history.js';
import { readUrlState, writeUrlState, buildUrl } from './urlstate.js';

const state = { origin: null, dest: null, via: null, originLabel: '', destLabel: '', viaLabel: '', period: null, routes: [], selected: null, heat: false, serverReady: false };
let heatCtl = null, heatSeq = 0;

const ui = setupUi({
  geocode: (q) => geocode(q),
  onPick(kind, p) { setPoint(kind, { lat: p.lat, lon: p.lon }, p.label); mapApi.flyTo(p); },
  onTyped(kind) { setPoint(kind, null, null, false); },
  onViaRemove() { setPoint('via', null, null); },
  onGpx(route) { downloadGpx(route, { mode: ui.getMode(), period: state.period || ui.getPeriod() }); },
  onSwap() {
    const o = state.origin, d = state.dest;
    const ol = document.getElementById('origin-input').value, dl = document.getElementById('dest-input').value;
    setPoint('origin', d, dl); setPoint('dest', o, ol);
  },
  onCalc: () => calculate(),
  onSettings() { clearRoutes(); refreshHeat(); },
  onHeat(on) { state.heat = on; if (on) refreshHeat(); else { cancelHeat(); mapApi.clearHeat(); ui.toast('zoom-hint', false); } },
  onSelect: select,
  onRecent(e) {
    ui.setMode(e.mode); ui.setPeriod(e.period);
    setPoint('origin', { lat: e.o.lat, lon: e.o.lon }, e.o.label || coordLabel(e.o));
    setPoint('dest', { lat: e.d.lat, lon: e.d.lon }, e.d.label || coordLabel(e.d));
    if (e.v) setPoint('via', { lat: e.v.lat, lon: e.v.lon }, e.v.label || coordLabel(e.v)); else { setPoint('via', null, null); ui.showVia(false); }
    calculate();
  },
  onStep(step) { if (step?.location) mapApi.showStep(step.location); },
  onShare: share,
  onStartNav: startNav,
  onServerRetry: () => connect(),
});

const mapApi = createMap({
  onMapClick(p) {
    if (nav.isActive()) return;
    const kind = state.origin ? 'dest' : 'origin';
    setPoint(kind, p, coordLabel(p));
    resolveLabel(kind, p);
  },
  onMarkerDrag(kind, p) { setPoint(kind, p, coordLabel(p)); resolveLabel(kind, p); },
  onRouteClick: select,
  onMoveEnd: refreshHeat,
  onUserPan: () => nav.userPanned(),
});

if (isMock) window.__mapApi = mapApi; // gancho de depuração (só no modo demo)

const navBanner = setupNavBanner({
  onExit: () => nav.stop(),
  onRecalc: () => nav.recalc(),
  onRecenter: () => nav.recenter(),
});
const nav = createNavigator({
  map: mapApi,
  ui: { ...navBanner, error: (m) => ui.setError(m), highlightStep: (i) => ui.highlightStep(i) },
  recalc: recalcFrom,
  onExit() { ui.collapseSheet(false); },
});

const LABEL = { origin: 'originLabel', dest: 'destLabel', via: 'viaLabel' };
function coordLabel(p) { return `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`; }

function setPoint(kind, p, label, updateInput = true) {
  state[kind] = p;
  state[LABEL[kind]] = p ? (label ?? '') : '';
  mapApi.setPoint(kind, p);
  if (updateInput && label != null) ui.setInput(kind, label);
  ui.refreshRecents();
  if (updateInput || p === null) { /* mudança de ponto invalida rotas */ if (state.routes.length) clearRoutes(); }
  ui.setHint(!state.origin ? 'Dica: clique no mapa para definir a origem. Arraste os marcadores para ajustar.'
    : !state.dest ? 'Agora clique no mapa para definir o destino.' : 'Pronto. Toque em "Calcular rotas".');
}

/** Troca só o rótulo do ponto (não invalida rotas já calculadas). */
function setLabel(kind, label) {
  state[LABEL[kind]] = label;
  ui.setInput(kind, label);
}

/** Geocodificação reversa em segundo plano; falha silenciosa mantém as coordenadas. */
const revSeq = { origin: 0, dest: 0, via: 0 };
async function resolveLabel(kind, p) {
  const seq = ++revSeq[kind];
  if (!state.serverReady) return;
  try {
    const r = await reverseGeocode(p.lat, p.lon);
    if (r && r.label && seq === revSeq[kind] && state[kind] === p) setLabel(kind, r.label);
  } catch { /* mantém coordenadas */ }
}

function clearRoutes() {
  if (nav.isActive()) nav.stop();
  state.routes = []; state.selected = null;
  mapApi.clearRoutes(); mapApi.clearStep(); ui.renderCards([], null);
  writeUrlState(null);
}

function syncUrl() {
  if (!state.origin || !state.dest || !state.routes.length) return;
  writeUrlState(shareState());
}
function shareState() {
  const keep = (l) => (l && l !== 'Minha localização' && !/^-?\d+\.\d+, ?-?\d+\.\d+$/.test(l) ? l : '');
  return { origin: state.origin, dest: state.dest, via: state.via, viaLabel: keep(state.viaLabel), mode: ui.getMode(), period: ui.getPeriod(), route: state.selected,
    originLabel: keep(state.originLabel), destLabel: keep(state.destLabel) };
}

function select(id) {
  state.selected = id; mapApi.select(id); mapApi.clearStep(); ui.markSelected(id); syncUrl();
}

async function share() {
  const url = buildUrl(shareState());
  const text = 'Rota no SampaNav';
  if (navigator.share) {
    try { await navigator.share({ title: 'SampaNav', text, url }); return; }
    catch (e) { if (e.name === 'AbortError') return; /* cai no fallback */ }
  }
  try { await navigator.clipboard.writeText(url); ui.snack('Link copiado'); }
  catch { window.prompt('Copie o link:', url); }
}

async function fetchRoutes(origin, via) {
  return postRoutes({ origin, destination: state.dest, via: via === undefined ? state.via : via, mode: ui.getMode(), period: ui.getPeriod() });
}

async function calculate(preferId = null) {
  ui.setError('');
  if (!state.serverReady) { ui.setError('O servidor ainda está acordando. Aguarde um instante.'); return; }
  if (!state.origin || !state.dest) { ui.setError('Defina a origem e o destino (digite um endereço ou clique no mapa).'); return; }
  if (nav.isActive()) nav.stop();
  ui.setBusy(true); ui.setStatus('Calculando rotas…');
  try {
    const res = await fetchRoutes(state.origin);
    state.routes = res.routes || [];
    state.period = res.period || null;
    if (!state.routes.length) { ui.setError('Nenhuma rota encontrada para esses pontos.'); ui.setStatus(''); return; }
    const pick = (preferId && state.routes.find((r) => r.id === preferId)) || state.routes.find((r) => r.id === 'equilibrada') || state.routes[0];
    state.selected = pick.id;
    mapApi.clearStep();
    ui.renderCards(state.routes, state.selected, state.period);
    mapApi.setRoutes(state.routes, state.selected, true);
    if (res.data) ui.setMeta(res.data);
    ui.setStatus(state.routes.length === 1
      ? 'Nenhum desvio reduz a exposição de forma relevante neste trajeto; mostrando a rota mais rápida.'
      : `${state.routes.length} rotas encontradas.`);
    ui.collapseSheet(false);
    addHistory({ o: { ...state.origin, label: state.originLabel || coordLabel(state.origin) },
      v: state.via && { ...state.via, label: state.viaLabel || coordLabel(state.via) },
      d: { ...state.dest, label: state.destLabel || coordLabel(state.dest) }, mode: ui.getMode(), period: ui.getPeriod() });
    ui.refreshRecents();
    syncUrl();
  } catch (e) {
    ui.setStatus(''); ui.setError(e.message || 'Erro ao calcular rotas.');
  } finally { ui.setBusy(false); }
}

// ---- Navegação ----
function startNav() {
  const r = state.routes.find((x) => x.id === state.selected);
  if (!r) return;
  ui.setError(''); mapApi.clearStep();
  ui.collapseSheet(true);
  nav.start(r).then((ok) => { if (!ok) ui.collapseSheet(false); });
}

/** A posição já passou da parada? Projeta na rota atual e compara com o passo "waypoint". */
function viaPassed(pos) {
  const r = state.routes.find((x) => x.id === state.selected);
  const wp = r?.steps?.find((s) => s.maneuver === 'waypoint' && Number.isInteger(s.geometry_index));
  if (!wp) return false;
  const pr = project(buildPath(r.geometry.coordinates), pos.lat, pos.lon, 0);
  return pr.seg >= wp.geometry_index;
}

/** Recalcula a partir da posição atual até o mesmo destino, mantendo o perfil se existir. */
async function recalcFrom(pos) {
  const keepId = state.selected;
  // mantém a parada só se ainda não foi passada (progresso < geometry_index do passo "waypoint")
  const via = state.via && !viaPassed(pos) ? state.via : null;
  const res = await fetchRoutes(pos, via);
  const routes = res.routes || [];
  if (!routes.length) throw new Error('Nenhuma rota encontrada a partir daqui.');
  state.routes = routes; state.period = res.period || state.period;
  if (state.via && !via) { state.via = null; state.viaLabel = ''; mapApi.setPoint('via', null); ui.showVia(false); }
  const pick = routes.find((r) => r.id === keepId) || routes.find((r) => r.id === 'equilibrada') || routes[0];
  state.selected = pick.id;
  state.origin = { lat: pos.lat, lon: pos.lon }; state.originLabel = 'Minha localização';
  mapApi.setPoint('origin', state.origin); ui.setInput('origin', 'Minha localização');
  ui.renderCards(routes, pick.id, state.period);
  mapApi.setRoutes(routes, pick.id, false);
  syncUrl();
  return pick;
}

// ---- Mapa de risco ----
function cancelHeat() { heatCtl?.abort(); heatSeq++; }

async function refreshHeat() {
  if (!state.heat) return;
  if (mapApi.zoom() < HEAT_MIN_ZOOM) {
    cancelHeat(); mapApi.clearHeat(); ui.toast('zoom-hint', true); ui.toast('map-loading', false); return;
  }
  ui.toast('zoom-hint', false);
  cancelHeat();
  heatCtl = new AbortController();
  const my = heatSeq; ui.toast('map-loading', true);
  const period = ui.getPeriod() === 'now' ? currentPeriod() : ui.getPeriod();
  try {
    const cells = await getRisk(mapApi.bbox(), ui.getMode(), period, heatCtl.signal);
    if (my !== heatSeq) return;
    mapApi.setHeat(cells);
    ui.toast('map-loading', false);
  } catch (e) {
    if (e.name === 'AbortError' || my !== heatSeq) return;
    ui.toast('map-loading', false); ui.setError(e.message);
  }
}

// ---- Inicialização: cold start + link compartilhado ----
let connecting = false;
async function connect() {
  if (connecting) return state.serverReady;
  connecting = true;
  ui.setServerReady(false);
  let done = false;
  setTimeout(() => { if (!done) ui.serverBanner('waiting'); }, 1000); // evita piscar quando o servidor responde rápido
  const ok = await waitForServer({ maxMs: 90000 });
  done = true; connecting = false;
  if (!ok) { ui.serverBanner('failed'); return false; }
  state.serverReady = true; ui.setServerReady(true); ui.serverBanner('ok');
  getMeta().then((m) => ui.setMeta(m)).catch(() => ui.setMeta(null));
  return true;
}

async function boot() {
  if (isMock) ui.setStatus('Modo de demonstração (dados fictícios).');
  const shared = readUrlState();
  if (shared) {
    ui.setMode(shared.mode); ui.setPeriod(shared.period);
    setPoint('origin', shared.o, shared.oLabel || coordLabel(shared.o));
    setPoint('dest', shared.d, shared.dLabel || coordLabel(shared.d));
    if (shared.v) setPoint('via', shared.v, shared.vLabel || coordLabel(shared.v));
  }
  const ok = await connect();
  if (ok && shared) calculate(shared.route);
}
boot();
