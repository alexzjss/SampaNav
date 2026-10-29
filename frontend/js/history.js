// Histórico das últimas buscas, só em localStorage (nada sai do navegador).
const KEY = 'sampanav.history.v1';
const MAX = 10;
const MODES = ['walk', 'drive', 'bike'];
const pt = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon);

export function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((e) => e && pt(e.o) && pt(e.d) && MODES.includes(e.mode)).map((e) => (e.v && !pt(e.v) ? { ...e, v: undefined } : e)).slice(0, MAX);
  } catch { return []; }
}
function save(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* sem armazenamento */ } }
const near = (p, q) => Math.abs(p.lat - q.lat) < 1e-4 && Math.abs(p.lon - q.lon) < 1e-4;
const same = (a, b) => a.mode === b.mode && near(a.o, b.o) && near(a.d, b.d)
  && (a.v && b.v ? near(a.v, b.v) : !a.v && !b.v);

export function addHistory({ o, d, v, mode, period }) {
  const clean = (p) => ({ lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5), label: String(p.label || '').slice(0, 120) });
  const entry = { o: clean(o), d: clean(d), mode, period: period || 'now', t: Date.now() };
  if (pt(v)) entry.v = clean(v);
  const list = [entry, ...loadHistory().filter((e) => !same(e, entry))].slice(0, MAX);
  save(list);
  return list;
}
export function clearHistory() {
  try { localStorage.removeItem(KEY); } catch { /* ignora */ }
}
