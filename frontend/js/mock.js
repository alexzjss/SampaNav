// Respostas falsas seguindo o contrato de docs/ARQUITETURA.md (uso: ?mock=1).
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const SE = { lat: -23.5505, lon: -46.6333 };
const PLACES = [
  { label: 'Catedral da Sé, Praça da Sé, São Paulo', lat: -23.5505, lon: -46.6333 },
  { label: 'Avenida Paulista, Bela Vista, São Paulo', lat: -23.5614, lon: -46.6559 },
  { label: 'Estação Consolação, Rua Augusta, São Paulo', lat: -23.5578, lon: -46.6603 },
  { label: 'Parque Ibirapuera, Av. Pedro Álvares Cabral, São Paulo', lat: -23.5874, lon: -46.6576 },
  { label: 'Estação da Luz, Bom Retiro, São Paulo', lat: -23.5343, lon: -46.6365 },
  { label: 'Mercado Municipal, Rua da Cantareira, São Paulo', lat: -23.5412, lon: -46.6290 },
  { label: 'Largo da Batata, Pinheiros, São Paulo', lat: -23.5670, lon: -46.6914 },
  { label: 'Vila Madalena, São Paulo', lat: -23.5546, lon: -46.6911 },
];
const T0 = Date.now();
const COLD_S = Number(new URLSearchParams(location.search).get('cold')) || 0; // ?cold=N simula N s de cold start
export async function health() {
  await delay(60);
  return Date.now() - T0 >= COLD_S * 1000;
}
export async function meta() {
  await delay(100);
  return { generated_at: '2026-10-20T12:00:00', date_min: '2024-09-01', date_max: '2026-08-31', n_occurrences: 123456,
    profiles: ['rapida', 'equilibrada', 'segura'], periods: ['all', 'madrugada', 'manha', 'tarde', 'noite'] };
}
export async function geocode(q) {
  await delay(200);
  const n = q.toLowerCase();
  return PLACES.filter((p) => p.label.toLowerCase().includes(n)).slice(0, 6);
}
export async function reverse(lat, lon) {
  await delay(200);
  const near = PLACES.find((p) => Math.abs(p.lat - lat) < 0.003 && Math.abs(p.lon - lon) < 0.003);
  return near ? { ...near } : { label: `Rua Exemplo, ${Math.abs(Math.round(lat * 1e4) % 1000)}, São Paulo`, lat, lon };
}
function line(a, b, bend, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, w = Math.sin(Math.PI * t) * bend;
    pts.push([a.lon + (b.lon - a.lon) * t + w * (b.lat - a.lat) * -1, a.lat + (b.lat - a.lat) * t + w * (b.lon - a.lon)]);
  }
  return pts;
}
function dist(c) {
  let d = 0;
  for (let i = 1; i < c.length; i++) {
    const dx = (c[i][0] - c[i - 1][0]) * 102000, dy = (c[i][1] - c[i - 1][1]) * 111000;
    d += Math.hypot(dx, dy);
  }
  return d;
}
const STREETS = ['Rua Direita', 'Av. Paulista', 'Rua Augusta', 'Rua da Consolação', 'Av. Brigadeiro Luís Antônio', 'Rua Haddock Lobo', 'Alameda Santos'];
const TURNS = ['right', 'left', 'slight-right', 'left', 'sharp-right', 'slight-left'];
const VERB = {
  right: 'Vire à direita', left: 'Vire à esquerda', 'slight-right': 'Vire levemente à direita',
  'slight-left': 'Vire levemente à esquerda', 'sharp-right': 'Faça uma curva fechada à direita',
  'sharp-left': 'Faça uma curva fechada à esquerda', uturn: 'Faça o retorno',
};
const fmtM = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m / 10) * 10} m`);
/** Passos no formato da seção 9 do contrato (maneuver, instruction, street, distance_m, duration_s, location, geometry_index). */
function makeSteps(coords, speed, seed) {
  const n = coords.length - 1;
  const idx = [0, 4, 9, 14, 19, n].filter((v, i, a) => a.indexOf(v) === i);
  return idx.map((gi, k) => {
    const last = k === idx.length - 1;
    const street = STREETS[(k + seed) % STREETS.length];
    const maneuver = k === 0 ? 'depart' : last ? 'arrive' : TURNS[(k + seed) % TURNS.length];
    const d = last ? 0 : dist(coords.slice(gi, idx[k + 1] + 1));
    const len = fmtM(d);
    const instruction = last ? 'Chegada ao destino'
      : k === 0 ? `Siga pela ${street} por ${len}`
      : `${VERB[maneuver]} na ${street}`;
    return { maneuver, instruction, street: last ? '' : street, distance_m: +d.toFixed(1), duration_s: Math.round(d / speed),
      location: coords[gi], geometry_index: gi };
  });
}
export async function routes({ origin, destination, mode, period }) {
  await delay(500);
  const inSp = (p) => p.lat > -24.01 && p.lat < -23.35 && p.lon > -46.83 && p.lon < -46.36;
  if (!inSp(origin) || !inSp(destination)) {
    const e = new Error('Origem ou destino fora do município de São Paulo.'); throw e;
  }
  const defs = [
    ['rapida', 'Mais rápida', 0, 0, 0.55, { roubo_pessoa: 41, furto_pessoa: 120, lesao: 9 }],
    ['equilibrada', 'Equilibrada', 2, 0.07, 0.38, { furto_pessoa: 80, roubo_pessoa: 22, roubo_veiculo: 4 }],
    ['segura', 'Mais segura', 6, -0.09, 0.2, { furto_pessoa: 44, lesao: 6, letal: 1 }],
  ];
  const speed = mode === 'walk' ? 1.3 : 7;
  let base;
  const out = defs.map(([id, label, alpha, bend, avg, cats], i) => {
    const coords = line(origin, destination, bend);
    const d = dist(coords) * (1 + i * 0.06);
    const dur = d / speed;
    const exposure = (d / 1000) * avg;
    if (i === 0) base = { dur, exposure };
    const level = avg < 0.15 ? 'baixo' : avg < 0.35 ? 'moderado' : avg < 0.6 ? 'alto' : 'muito alto';
    const k = 6, segs = [];
    for (let s = 0; s < k; s++) {
      const a = Math.floor((s * (coords.length - 1)) / k), b = Math.floor(((s + 1) * (coords.length - 1)) / k);
      const r = Math.min(1, Math.max(0, avg + Math.sin(s * 2.1 + i) * 0.25));
      segs.push({ coordinates: coords.slice(a, b + 1), risk: +r.toFixed(2) });
    }
    return { id, label, alpha, distance_m: +d.toFixed(1), duration_s: Math.round(dur), exposure: +exposure.toFixed(2),
      avg_risk: avg, risk_level: level,
      vs_fastest: { duration_pct: +(((dur / base.dur) - 1) * 100).toFixed(1), exposure_pct: +(((exposure / base.exposure) - 1) * 100).toFixed(1) },
      categories: cats, geometry: { type: 'LineString', coordinates: coords }, segments: segs,
      steps: new URLSearchParams(location.search).has('nosteps') ? undefined : makeSteps(coords, speed, i) };
  });
  return { mode, period: period === 'now' ? 'noite' : period, routes: out,
    data: { date_min: '2024-09-01', date_max: '2026-08-31', source: 'SSP-SP' } };
}
export async function risk(bbox) {
  await delay(150);
  const h3 = window.h3;
  const cells = new Set();
  const c = h3.latLngToCell(SE.lat, SE.lon, 9);
  h3.gridDisk(c, 14).forEach((x) => cells.add(x));
  const out = [];
  for (const cell of cells) {
    const [la, lo] = h3.cellToLatLng(cell);
    if (lo < bbox[0] || lo > bbox[2] || la < bbox[1] || la > bbox[3]) continue;
    const r = Math.min(1, Math.max(0, 0.5 + 0.5 * Math.sin(la * 900) * Math.cos(lo * 800)) * (1.1 - Math.hypot(la - SE.lat, lo - SE.lon) * 18));
    if (r >= 0.05) out.push({ h3: cell, risk: +r.toFixed(2) });
  }
  return out;
}
