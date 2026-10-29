import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeToGpx, gpxFilename, downloadGpx } from '../../js/gpx.js';

const when = new Date('2026-10-29T12:00:00Z');
const route = {
  id: 'equilibrada',
  label: 'Equilibrada',
  distance_m: 1234,
  duration_s: 900,
  geometry: { type: 'LineString', coordinates: [[-46.6333, -23.5505], [-46.634, -23.551], [-46.635, -23.552]] },
  steps: [
    { maneuver: 'depart', instruction: 'Siga em frente', street: 'Av. Paulista', distance_m: 100, duration_s: 60, location: [-46.6333, -23.5505], geometry_index: 0 },
    { maneuver: 'turn', instruction: 'Vire à direita', street: 'R. Augusta', distance_m: 200, duration_s: 120, location: [-46.635, -23.552], geometry_index: 2 },
  ],
};
const xml = (r = route, o = {}) => routeToGpx(r, { createdAt: when, ...o });
const count = (s, re) => (s.match(re) || []).length;

test('estrutura: cabeçalho, raiz GPX 1.1, metadata, wpts e trk', () => {
  const s = xml();
  assert.ok(s.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="SampaNav" xmlns="http://www.topografix.com/GPX/1/1">'));
  assert.ok(s.trimEnd().endsWith('</gpx>'));
  assert.match(s, /<metadata>\s*<name>SampaNav – Equilibrada<\/name>\s*<time>2026-10-29T12:00:00\.000Z<\/time>\s*<\/metadata>/);
  assert.equal(count(s, /<wpt /g), 2);
  assert.equal(count(s, /<\/wpt>/g), 2);
  assert.equal(count(s, /<trk>/g), 1);
  assert.equal(count(s, /<trkseg>/g), 1);
  assert.equal(count(s, /<\/trkseg>/g), 1);
  assert.match(s, /<trk>\s*<name>SampaNav – Equilibrada<\/name>/);
});

test('ordem lat/lon: atributos lat primeiro, valores invertidos das coordenadas [lon,lat]', () => {
  const s = xml();
  assert.match(s, /<wpt lat="-23\.550500" lon="-46\.633300">\s*<name>Siga em frente<\/name>/);
  assert.match(s, /<wpt lat="-23\.552000" lon="-46\.635000">\s*<name>Vire à direita<\/name>/);
  assert.match(s, /<trkpt lat="-23\.550500" lon="-46\.633300"\/>/);
  assert.match(s, /<trkpt lat="-23\.551000" lon="-46\.634000"\/>/);
  assert.equal(count(s, /<trkpt /g), 3);
});

test('nome customizado e desc com modo/período', () => {
  const s = xml(route, { name: 'Minha rota', mode: 'a pé', period: 'noite' });
  assert.match(s, /<name>Minha rota<\/name>/);
  assert.match(s, /<desc>a pé · noite<\/desc>/);
  assert.ok(!xml().includes('<desc>'));
});

test('escapa &, <, >, ", \' em nomes e instruções', () => {
  const r = { ...route, label: 'A & B', steps: [{ instruction: 'Vire & siga <rápido> "x" \'y\'', location: [-46.6, -23.5] }], geometry: { coordinates: [] } };
  const s = xml(r);
  assert.ok(s.includes('<name>Vire &amp; siga &lt;rápido&gt; &quot;x&quot; &apos;y&apos;</name>'));
  assert.ok(s.includes('<name>SampaNav – A &amp; B</name>'));
  assert.ok(!/<rápido>/.test(s));
  assert.equal(count(s, /<wpt /g), 1);
});

test('ignora passos sem localização válida', () => {
  const r = {
    ...route,
    steps: [
      { instruction: 'sem location' },
      { instruction: 'null', location: null },
      { instruction: 'um valor', location: [-46.6] },
      { instruction: 'nan', location: [NaN, -23.5] },
      { instruction: 'string', location: ['-46.6', '-23.5'] },
      { instruction: 'fora do range', location: [-200, -23.5] },
      { instruction: 'ok', location: [-46.6, -23.5] },
      null,
    ],
  };
  const s = xml(r);
  assert.equal(count(s, /<wpt /g), 1);
  assert.match(s, /<name>ok<\/name>/);
  assert.ok(!/sem location|nan|fora do range/.test(s));
});

test('passos vazios ou ausentes: sem wpt, trilha continua válida', () => {
  const s1 = xml({ ...route, steps: [] });
  assert.equal(count(s1, /<wpt /g), 0);
  assert.equal(count(s1, /<trkpt /g), 3);
  const s2 = xml({ id: 'x', label: 'X', geometry: { coordinates: [] } });
  assert.equal(count(s2, /<wpt /g), 0);
  assert.equal(count(s2, /<trkpt /g), 0);
  assert.match(s2, /<trkseg>\s*<\/trkseg>/);
  assert.match(s2, /<trk>/);
});

test('arredonda para 6 casas decimais', () => {
  const r = { ...route, steps: [{ instruction: 'x', location: [-46.6333333333, -23.5505199999] }], geometry: { coordinates: [[-46.1234567, 23.1234569]] } };
  const s = xml(r);
  assert.match(s, /<wpt lat="-23\.550520" lon="-46\.633333">/);
  assert.match(s, /<trkpt lat="23\.123457" lon="-46\.123457"\/>/);
});

test('gpxFilename: sanitiza id e usa data de São Paulo', () => {
  assert.equal(gpxFilename(route, when), 'sampanav-equilibrada-2026-10-29.gpx');
  assert.equal(gpxFilename({ id: 'Equilibrada Ç/../x' }, when), 'sampanav-equilibrada-c-x-2026-10-29.gpx');
  assert.equal(gpxFilename({ id: '  ' }, when), 'sampanav-rota-2026-10-29.gpx');
  assert.equal(gpxFilename({}, when), 'sampanav-rota-2026-10-29.gpx');
  // 01:00 UTC do dia 30 ainda é dia 29 em São Paulo (UTC-3)
  assert.equal(gpxFilename(route, new Date('2026-10-30T01:00:00Z')), 'sampanav-equilibrada-2026-10-29.gpx');
});

test('downloadGpx: blob GPX, link com download e revogação', async () => {
  const seen = { blob: null, revoked: [], clicks: 0, a: null };
  globalThis.URL.createObjectURL = (b) => { seen.blob = b; return 'blob:fake'; };
  globalThis.URL.revokeObjectURL = (u) => seen.revoked.push(u);
  globalThis.document = {
    body: { appendChild() {} },
    createElement: () => (seen.a = { click() { seen.clicks++; }, remove() {} }),
  };
  downloadGpx(route, { createdAt: when });
  assert.equal(seen.clicks, 1);
  assert.equal(seen.a.href, 'blob:fake');
  assert.equal(seen.a.download, 'sampanav-equilibrada-2026-10-29.gpx');
  assert.equal(seen.blob.type, 'application/gpx+xml');
  assert.equal(await seen.blob.text(), routeToGpx(route, { createdAt: when }));
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(seen.revoked, ['blob:fake']);
  delete globalThis.document;
});
