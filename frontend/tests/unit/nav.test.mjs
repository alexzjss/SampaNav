// nav.js lê location.search no topo do módulo: stub antes do import dinâmico.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.location = new URL('http://localhost/');
const nav = await import('../../js/nav.js');
const { haversine, bearing, buildPath, project } = nav;

const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b} (±${eps})`);
// 1 grau de latitude em metros no raio usado pelo módulo
const DEG = (Math.PI / 180) * 6371008.8;

test('constantes de navegação', () => {
  assert.equal(nav.OFF_ROUTE_M, 40);
  assert.equal(nav.OFF_ROUTE_FIXES, 3);
  assert.equal(nav.ARRIVE_M, 25);
});

test('haversine: zero, simetria e 1 grau de latitude', () => {
  assert.equal(haversine(-23.55, -46.63, -23.55, -46.63), 0);
  close(haversine(0, 0, 1, 0), DEG, 1);
  close(haversine(-23.55, -46.63, -23.56, -46.65), haversine(-23.56, -46.65, -23.55, -46.63), 1e-6);
});

test('haversine: pontos antípodas não dão NaN', () => {
  const d = haversine(0, 0, 0, 180);
  assert.ok(Number.isFinite(d));
  close(d, Math.PI * 6371008.8, 1);
});

test('bearing: pontos cardeais', () => {
  close(bearing(0, 0, 1, 0), 0, 1e-6);
  close(bearing(0, 0, 0, 1), 90, 1e-6);
  close(bearing(0, 0, -1, 0), 180, 1e-6);
  close(bearing(0, 0, 0, -1), 270, 1e-6);
});

test('buildPath: acumulados, total e caminho vazio/unitário', () => {
  const p = buildPath([[0, 0], [0, 1], [0, 2]]);
  assert.equal(p.cum.length, 3);
  assert.equal(p.cum[0], 0);
  close(p.cum[1], DEG, 1);
  close(p.total, 2 * DEG, 2);
  assert.equal(p.total, p.cum[2]);
  assert.deepEqual(buildPath([[0, 0]]), { coords: [[0, 0]], cum: [0], total: 0 });
  assert.equal(buildPath([]).total, 0);
});

// reta leste-oeste a ~lat -23.55, 0.01 grau de lon por segmento
const lat0 = -23.55;
const line = buildPath([[-46.64, lat0], [-46.63, lat0], [-46.62, lat0]]);

test('project: ponto sobre a rota', () => {
  const r = project(line, lat0, -46.635);
  assert.equal(r.seg, 0);
  close(r.dist, 0, 0.01);
  close(r.along, line.cum[1] / 2, 0.5);
});

test('project: ponto deslocado ao norte mede a distância perpendicular', () => {
  const r = project(line, lat0 + 30 / DEG, -46.625);
  assert.equal(r.seg, 1);
  close(r.dist, 30, 0.1);
  close(r.along, line.cum[1] + line.cum[2] / 2 - line.cum[1] / 2, 0.5);
});

test('project: antes do início e depois do fim grampeia nas pontas', () => {
  const a = project(line, lat0, -46.7);
  assert.equal(a.along, 0);
  const b = project(line, lat0, -46.5);
  close(b.along, line.total, 1e-6);
  assert.equal(b.seg, 1);
});

test('project: segmento degenerado (pontos repetidos) não gera NaN', () => {
  const p = buildPath([[-46.63, lat0], [-46.63, lat0], [-46.62, lat0]]);
  const r = project(p, lat0, -46.63);
  assert.ok(Number.isFinite(r.dist) && Number.isFinite(r.along));
});

test('project: rota que cruza a si mesma usa lastAlong para desempatar', () => {
  // quadrado em volta do cruzamento: sai de A, vai e volta passando de novo por X (-46.63, lat0)
  const X = [-46.63, lat0], d = 0.002;
  const path = buildPath([
    [X[0] - d, X[1]], [X[0] + d, X[1]],          // cruza X (1ª vez), segmento 0
    [X[0] + d, X[1] + d], [X[0] - d, X[1] + d],  // volta pelo norte
    [X[0], X[1] + d], [X[0], X[1] - d],          // desce cruzando X (2ª vez), seg 4
  ]);
  // sem histórico: prefere o menor progresso (1ª passagem)
  const first = project(path, X[1], X[0], 0);
  assert.equal(first.seg, 0);
  // já avançou muito: o trecho antigo volta mais de 30 m, então escolhe a 2ª passagem
  const late = project(path, X[1], X[0], path.cum[4] + 200);
  assert.equal(late.seg, 4);
  assert.ok(late.along > first.along);
});

test('project: sem candidato dentro da janela cai no mais próximo', () => {
  const r = project(line, lat0, -46.635, 1e9);
  assert.equal(r.seg, 0);
  close(r.dist, 0, 0.01);
});

test('etaInfo: tempo proporcional à distância restante e chegada', () => {
  const now = new Date('2026-01-01T12:00:00Z');
  const e = nav.etaInfo({ duration_s: 1200 }, 500, 1000, now);
  assert.equal(e.remainingS, 600);
  assert.equal(e.arrival.toISOString(), '2026-01-01T12:10:00.000Z');
  assert.equal(nav.etaInfo({ duration_s: 1200 }, 2000, 1000, now).remainingS, 1200); // limita ao total
  assert.equal(nav.etaInfo({ duration_s: 1200 }, -5, 1000, now).remainingS, 0);
  assert.equal(nav.etaInfo({}, 10, 1000, now), null);
  assert.equal(nav.etaInfo({ duration_s: 60 }, 10, 0, now), null);
});

test('turnNowM e shortManeuver', () => {
  assert.equal(nav.turnNowM({ distance_m: 1000, duration_s: 720 }), 30); // a pé
  assert.equal(nav.turnNowM({ distance_m: 1000, duration_s: 100 }), 60); // carro
  assert.equal(nav.turnNowM({}), 40);
  assert.equal(nav.shortManeuver({ maneuver: 'right', instruction: 'x' }), 'Vire à direita');
  assert.equal(nav.shortManeuver({ maneuver: 'waypoint', instruction: 'Chegada à parada; siga em frente' }), 'Parada');
  assert.equal(nav.shortManeuver({ maneuver: 'foo', instruction: 'Siga' }), 'Siga');
});
