// Exporta a rota para GPX 1.1: waypoints por instrução + trilha. Sem DOM na importação.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const num = (x) => Number(x).toFixed(6);
/** Coordenada GeoJSON [lon, lat] válida. */
const okLonLat = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
  && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

/** GPX 1.1 (string XML). Waypoints = passos com localização; trilha = geometria. */
export function routeToGpx(route, { name, mode, period, createdAt = new Date() } = {}) {
  const title = name || `SampaNav – ${route.label || 'rota'}`;
  const desc = [mode, period].filter(Boolean).join(' · ');
  const wpts = (route.steps || []).filter((s) => okLonLat(s?.location)).map((s) => {
    const [lon, lat] = s.location;
    return `  <wpt lat="${num(lat)}" lon="${num(lon)}">\n    <name>${esc(s.instruction)}</name>\n  </wpt>`;
  });
  const pts = (route.geometry?.coordinates || []).filter(okLonLat)
    .map(([lon, lat]) => `      <trkpt lat="${num(lat)}" lon="${num(lon)}"/>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="SampaNav" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <metadata>',
    `    <name>${esc(title)}</name>`,
    ...(desc ? [`    <desc>${esc(desc)}</desc>`] : []),
    `    <time>${createdAt.toISOString()}</time>`,
    '  </metadata>',
    ...wpts,
    '  <trk>',
    `    <name>${esc(title)}</name>`,
    '    <trkseg>',
    ...pts,
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n');
}

const slug = (id) => String(id ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'rota';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Ex.: sampanav-equilibrada-2026-10-29.gpx (data no fuso de São Paulo). */
export function gpxFilename(route, date = new Date()) {
  return `sampanav-${slug(route.id)}-${dayFmt.format(date)}.gpx`;
}

/** Baixa a rota como .gpx. Único ponto que toca o DOM. */
export function downloadGpx(route, opts = {}) {
  const createdAt = opts.createdAt || new Date();
  const blob = new Blob([routeToGpx(route, { ...opts, createdAt })], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = gpxFilename(route, createdAt);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
