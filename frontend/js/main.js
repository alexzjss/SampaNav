import { getMeta, geocode, postRoutes, getRisk, isMock } from './api.js';
import { createMap, HEAT_MIN_ZOOM } from './map.js';
import { setupUi } from './ui.js';
import { currentPeriod } from './format.js';

const state = { origin: null, dest: null, routes: [], selected: null, heat: false };
let heatCtl = null, heatSeq = 0;

const ui = setupUi({
  geocode: (q) => geocode(q),
  onPick(kind, p) { setPoint(kind, { lat: p.lat, lon: p.lon }, p.label); mapApi.flyTo(p); },
  onTyped(kind) { setPoint(kind, null, null, false); },
  onSwap() {
    const o = state.origin, d = state.dest;
    const ol = document.getElementById('origin-input').value, dl = document.getElementById('dest-input').value;
    setPoint('origin', d, dl); setPoint('dest', o, ol);
  },
  onCalc: calculate,
  onSettings() { clearRoutes(); refreshHeat(); },
  onHeat(on) { state.heat = on; if (on) refreshHeat(); else { cancelHeat(); mapApi.clearHeat(); ui.toast('zoom-hint', false); } },
  onSelect: select,
});

const mapApi = createMap({
  onMapClick(p) {
    if (!state.origin) setPoint('origin', p, coordLabel(p));
    else setPoint('dest', p, coordLabel(p));
  },
  onMarkerDrag(kind, p) { setPoint(kind, p, coordLabel(p)); },
  onRouteClick: select,
  onMoveEnd: refreshHeat,
});

function coordLabel(p) { return `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`; }

function setPoint(kind, p, label, updateInput = true) {
  state[kind] = p;
  mapApi.setPoint(kind, p);
  if (updateInput && label != null) ui.setInput(kind, label);
  if (updateInput || p === null) { /* mudança de ponto invalida rotas */ if (state.routes.length) clearRoutes(); }
  ui.setHint(!state.origin ? 'Dica: clique no mapa para definir a origem. Arraste os marcadores para ajustar.'
    : !state.dest ? 'Agora clique no mapa para definir o destino.' : 'Pronto. Toque em "Calcular rotas".');
}

function clearRoutes() {
  state.routes = []; state.selected = null;
  mapApi.clearRoutes(); ui.renderCards([], null);
}

function select(id) {
  state.selected = id; mapApi.select(id); ui.markSelected(id);
}

async function calculate() {
  ui.setError('');
  if (!state.origin || !state.dest) { ui.setError('Defina a origem e o destino (digite um endereço ou clique no mapa).'); return; }
  ui.setBusy(true); ui.setStatus('Calculando rotas…');
  try {
    const res = await postRoutes({ origin: state.origin, destination: state.dest, mode: ui.getMode(), period: ui.getPeriod() });
    state.routes = res.routes || [];
    if (!state.routes.length) { ui.setError('Nenhuma rota encontrada para esses pontos.'); ui.setStatus(''); return; }
    state.selected = (state.routes.find((r) => r.id === 'equilibrada') || state.routes[0]).id;
    ui.renderCards(state.routes, state.selected);
    mapApi.setRoutes(state.routes, state.selected, true);
    if (res.data) ui.setMeta(res.data);
    ui.setStatus(state.routes.length === 1
      ? 'Nenhum desvio reduz a exposição de forma relevante neste trajeto; mostrando a rota mais rápida.'
      : `${state.routes.length} rotas encontradas.`);
    ui.collapseSheet(false);
  } catch (e) {
    ui.setStatus(''); ui.setError(e.message || 'Erro ao calcular rotas.');
  } finally { ui.setBusy(false); }
}

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

getMeta().then((m) => ui.setMeta(m)).catch(() => ui.setMeta(null));
if (isMock) ui.setStatus('Modo de demonstração (dados fictícios).');
