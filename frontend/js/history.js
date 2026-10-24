// Histórico das últimas buscas, só em localStorage (nada sai do navegador).
const KEY = 'sampanav.history.v1';
const MAX = 10;
const pt = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon);

export function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((e) => e && pt(e.o) && pt(e.d) && (e.mode === 'walk' || e.mode === 'drive')).slice(0, MAX);
  } catch { return []; }
}
function save(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* sem armazenamento */ } }
const same = (a, b) => a.mode === b.mode && [a.o, a.d].every((p, i) => {
  const q = i ? b.d : b.o;
  return Math.abs(p.lat - q.lat) < 1e-4 && Math.abs(p.lon - q.lon) < 1e-4;
});

export function addHistory({ o, d, mode, period }) {
  const clean = (p) => ({ lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5), label: String(p.label || '').slice(0, 120) });
  const entry = { o: clean(o), d: clean(d), mode, period: period || 'now', t: Date.now() };
  const list = [entry, ...loadHistory().filter((e) => !same(e, entry))].slice(0, MAX);
  save(list);
  return list;
}
export function clearHistory() {
  try { localStorage.removeItem(KEY); } catch { /* ignora */ }
}
