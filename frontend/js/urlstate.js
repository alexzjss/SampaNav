// Estado compartilhável na URL: ?o=lat,lon&d=lat,lon&m=walk|drive|bike&p=período&r=id&on=rótulo&dn=rótulo&v=lat,lon&vn=rótulo
const OWN = ['o', 'd', 'm', 'p', 'r', 'on', 'dn', 'v', 'vn'];
const PERIODS = ['now', 'all', 'madrugada', 'manha', 'tarde', 'noite'];

function parsePt(s) {
  const m = /^(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(s || '');
  if (!m) return null;
  const lat = +m[1], lon = +m[2];
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}
const fmtPt = (p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;

/** Lê e valida o estado da URL; null se não houver origem e destino válidos. */
export function readUrlState() {
  const q = new URLSearchParams(location.search);
  const o = parsePt(q.get('o')), d = parsePt(q.get('d'));
  if (!o || !d) return null;
  const m = q.get('m'), p = q.get('p'), r = q.get('r');
  const label = (k) => (q.get(k) || '').trim().slice(0, 120) || null;
  return {
    o, d,
    v: parsePt(q.get('v')),
    mode: m === 'drive' || m === 'bike' ? m : 'walk',
    period: PERIODS.includes(p) ? p : 'now',
    route: r && /^[\w-]{1,32}$/.test(r) ? r : null,
    oLabel: label('on'), dLabel: label('dn'), vLabel: label('vn'),
  };
}

/** URL completa do estado atual (preserva parâmetros alheios, como mock=1). */
export function buildUrl(s) {
  const q = new URLSearchParams(location.search);
  OWN.forEach((k) => q.delete(k));
  if (s) {
    q.set('o', fmtPt(s.origin)); q.set('d', fmtPt(s.dest));
    q.set('m', s.mode); q.set('p', s.period);
    if (s.route) q.set('r', s.route);
    if (s.originLabel) q.set('on', s.originLabel);
    if (s.destLabel) q.set('dn', s.destLabel);
    if (s.via) { q.set('v', fmtPt(s.via)); if (s.viaLabel) q.set('vn', s.viaLabel); }
  }
  const qs = q.toString();
  return `${location.origin}${location.pathname}${qs ? '?' + qs : ''}`;
}

export function writeUrlState(s) {
  try { history.replaceState(null, '', buildUrl(s)); } catch { /* ignora */ }
}
