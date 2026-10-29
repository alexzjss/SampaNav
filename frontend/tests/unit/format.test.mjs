import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// riskColor lê CSS vars: valores vazios forçam a paleta FALLBACK.
globalThis.document = { documentElement: {} };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
const f = await import('../../js/format.js');

test('fmtDuration', () => {
  assert.equal(f.fmtDuration(0), '1 min');
  assert.equal(f.fmtDuration(29), '1 min');
  assert.equal(f.fmtDuration(90), '2 min');
  assert.equal(f.fmtDuration(59 * 60), '59 min');
  assert.equal(f.fmtDuration(3600), '1 h 00 min');
  assert.equal(f.fmtDuration(3600 + 5 * 60), '1 h 05 min');
  assert.equal(f.fmtDuration(7500), '2 h 05 min');
});

test('fmtKm usa vírgula decimal', () => {
  assert.equal(f.fmtKm(0), '0,0 km');
  assert.equal(f.fmtKm(1234), '1,2 km');
  assert.equal(f.fmtKm(12960), '13,0 km');
});

test('fmtDate', () => {
  assert.equal(f.fmtDate('2026-10-20T12:00:00'), '20/10/2026');
  assert.equal(f.fmtDate('2024-09-01'), '01/09/2024');
  assert.equal(f.fmtDate(''), '?');
  assert.equal(f.fmtDate(null), '?');
  assert.equal(f.fmtDate('lixo'), 'lixo');
});

test('fmtMeters', () => {
  assert.equal(f.fmtMeters(0), '0 m');
  assert.equal(f.fmtMeters(-5), '0 m');
  assert.equal(f.fmtMeters(12), '10 m');
  assert.equal(f.fmtMeters(13), '15 m');
  assert.equal(f.fmtMeters(99), '100 m');
  assert.equal(f.fmtMeters(149), '150 m');
  assert.equal(f.fmtMeters(999), '1000 m');
  assert.equal(f.fmtMeters(1000), '1,0 km');
  assert.equal(f.fmtMeters(1250), '1,3 km');
});

test('topCategories: ordena, ignora zeros, limita e usa rótulos', () => {
  const cats = { furto_pessoa: 80, roubo_pessoa: 22, lesao: 0, roubo_veiculo: 4, letal: 1, outra: 50 };
  assert.deepEqual(f.topCategories(cats), ['Furtos', 'outra', 'Roubos a pedestres']);
  assert.deepEqual(f.topCategories(cats, 1), ['Furtos']);
  assert.deepEqual(f.topCategories(cats, 10).length, 5);
  assert.deepEqual(f.topCategories(null), []);
  assert.deepEqual(f.topCategories({}), []);
});

test('vsText', () => {
  assert.equal(f.vsText(null), 'Referência: rota mais rápida');
  assert.equal(f.vsText({ duration_pct: 0, exposure_pct: 0 }), 'Referência: rota mais rápida');
  assert.equal(f.vsText({ duration_pct: 7.4, exposure_pct: -30.2 }), '30% menos exposição · +7% de tempo');
  assert.equal(f.vsText({ duration_pct: -3, exposure_pct: 12 }), '12% mais exposição · -3% de tempo');
  assert.equal(f.vsText({ duration_pct: 5, exposure_pct: 0.2 }), 'mesma exposição · +5% de tempo');
});

test('vsTextMinutes', () => {
  const fastest = { duration_s: 600, vs_fastest: { duration_pct: 0, exposure_pct: 0 } };
  const safe = { duration_s: 900, vs_fastest: { duration_pct: 50, exposure_pct: -40 } };
  assert.equal(f.vsTextMinutes(fastest, fastest), 'Referência: rota mais rápida');
  assert.equal(f.vsTextMinutes({ duration_s: 1 }, fastest), 'Referência: rota mais rápida'); // sem vs_fastest
  assert.equal(f.vsTextMinutes(safe, fastest), '40% menos exposição · +5 min');
  const worse = { duration_s: 480, vs_fastest: { duration_pct: -20, exposure_pct: 10 } };
  assert.equal(f.vsTextMinutes(worse, fastest), '10% mais exposição · -2 min');
  const same = { duration_s: 600, vs_fastest: { duration_pct: 0, exposure_pct: 0 } };
  assert.equal(f.vsTextMinutes(same, fastest), 'Referência: rota mais rápida');
});

test('levelClass e rótulos', () => {
  assert.equal(f.levelClass('muito alto'), 'muito-alto');
  assert.equal(f.levelClass('baixo'), 'baixo');
  for (const k of ['baixo', 'moderado', 'alto', 'muito alto']) assert.ok(f.LEVEL_LABELS[k]);
});

test('debounce: só a última chamada dispara; cancel impede', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const d = f.debounce((x) => calls.push(x), 100);
  d(1); t.mock.timers.tick(50); d(2); t.mock.timers.tick(99);
  assert.deepEqual(calls, []);
  t.mock.timers.tick(1);
  assert.deepEqual(calls, [2]);
  d(3); d.cancel(); t.mock.timers.tick(500);
  assert.deepEqual(calls, [2]);
});

test('currentPeriod devolve um período válido e segue o horário de São Paulo', (t) => {
  assert.ok(['madrugada', 'manha', 'tarde', 'noite'].includes(f.currentPeriod()));
  // São Paulo = UTC-3 (sem horário de verão desde 2019)
  const cases = [['2026-06-01T02:59:00Z', 'noite'], ['2026-06-01T03:00:00Z', 'madrugada'],
    ['2026-06-01T08:59:00Z', 'madrugada'], ['2026-06-01T09:00:00Z', 'manha'],
    ['2026-06-01T15:00:00Z', 'tarde'], ['2026-06-01T21:00:00Z', 'noite']];
  for (const [iso, want] of cases) {
    t.mock.timers.enable({ apis: ['Date'], now: new Date(iso) });
    assert.equal(f.currentPeriod(), want, iso);
    t.mock.timers.reset();
  }
});

test('riskColor: pontas, grampeamento e interpolação (paleta FALLBACK)', () => {
  assert.equal(f.riskColor(0), 'rgb(46,158,91)');
  assert.equal(f.riskColor(1), 'rgb(192,38,45)');
  assert.equal(f.riskColor(-5), f.riskColor(0));
  assert.equal(f.riskColor(9), f.riskColor(1));
  assert.equal(f.riskColor(0.35), 'rgb(242,199,68)');
  assert.equal(f.riskColor(0.65), 'rgb(238,129,51)');
  // ponto médio entre os dois primeiros stops (0 e 0.35)
  assert.equal(f.riskColor(0.175), 'rgb(144,179,80)');
  f.resetRiskPalette();
  assert.equal(f.riskColor(0), 'rgb(46,158,91)');
});

test('riskColor lê variáveis CSS quando válidas (e hex curto)', () => {
  const vars = { '--risk-0': '#000', '--risk-1': '#ff0000', '--risk-2': 'inválido', '--risk-3': '#ffffff' };
  globalThis.getComputedStyle = () => ({ getPropertyValue: (k) => vars[k] });
  f.resetRiskPalette();
  assert.equal(f.riskColor(0), 'rgb(0,0,0)');
  assert.equal(f.riskColor(0.35), 'rgb(255,0,0)');
  assert.equal(f.riskColor(0.65), 'rgb(238,129,51)'); // inválido -> fallback
  assert.equal(f.riskColor(1), 'rgb(255,255,255)');
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
  f.resetRiskPalette();
});
