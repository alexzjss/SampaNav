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

test('LEVEL_HINTS cobre todos os níveis e levelHint tem fallback', () => {
  for (const k of Object.keys(f.LEVEL_LABELS)) assert.match(f.LEVEL_HINTS[k], /\S/);
  assert.match(f.LEVEL_HINTS.alto, /75%/);
  assert.match(f.LEVEL_HINTS['muito alto'], /90%/);
  assert.match(f.LEVEL_HINTS.moderado, /50%/);
  assert.equal(f.levelHint('alto'), f.LEVEL_HINTS.alto);
  assert.equal(f.levelHint('?'), f.LEVEL_NOTE);
  assert.match(f.LEVEL_NOTE, /75%.*90%/);
});

test('periodRows: barras relativas ao maior valor, nível e período atual', () => {
  const r = { exposure_by_period: { madrugada: 4, manha: 1, tarde: 2, noite: 2 },
    level_by_period: { madrugada: 'alto', manha: 'baixo', tarde: 'moderado', noite: 'moderado' } };
  const rows = f.periodRows(r, 'tarde');
  assert.deepEqual(rows.map((x) => x.key), ['madrugada', 'manha', 'tarde', 'noite']);
  assert.deepEqual(rows.map((x) => x.pct), [100, 25, 50, 50]);
  assert.deepEqual(rows.map((x) => x.current), [false, false, true, false]);
  assert.equal(rows[1].label, 'Manhã'); assert.equal(rows[0].level, 'alto');
});

test('periodRows: sem dados ou tudo zero', () => {
  assert.deepEqual(f.periodRows({}, 'noite'), []);
  assert.deepEqual(f.periodRows(null, 'noite'), []);
  const z = f.periodRows({ exposure_by_period: { madrugada: 0, manha: 0, tarde: 0, noite: 0 } }, 'now');
  assert.deepEqual(z.map((x) => x.pct), [0, 0, 0, 0]);
  assert.ok(z.every((x) => !x.current && x.level === null));
  const part = f.periodRows({ exposure_by_period: { madrugada: 2, manha: 'x' } }, 'noite');
  assert.equal(part[1].value, null); assert.equal(part[1].pct, 0); assert.equal(part[0].pct, 100);
});

test('fmtExposure', () => {
  assert.equal(f.fmtExposure(1.25), '1,3');
  assert.equal(f.fmtExposure(null), '–');
});

test('httpErrorMessage: 429 amigável, 5xx sem texto bruto', () => {
  assert.equal(f.httpErrorMessage(429, 'Too Many Requests'), 'Muitas requisições; aguarde um instante.');
  assert.equal(f.httpErrorMessage(502, 'HTTPSConnectionPool(host=photon...) timed out'), 'O servidor está indisponível no momento. Tente novamente em instantes.');
  assert.equal(f.httpErrorMessage(500, null), 'O servidor está indisponível no momento. Tente novamente em instantes.');
  assert.equal(f.httpErrorMessage(503, 'Servidor iniciando; tente novamente em instantes.'), 'Servidor iniciando; tente novamente em instantes.');
  assert.equal(f.httpErrorMessage(503, null), 'Servidor iniciando; tente novamente em instantes.');
});

test('httpErrorMessage: 400 usa o detalhe textual; 422/404 genéricos', () => {
  assert.equal(f.httpErrorMessage(400, 'Ponto fora da região de São Paulo.'), 'Ponto fora da região de São Paulo.');
  assert.equal(f.httpErrorMessage(400, [{ loc: [] }]), 'Requisição inválida. Confira os pontos escolhidos.');
  assert.equal(f.httpErrorMessage(422, [{ loc: [] }]), 'Requisição inválida. Confira os pontos escolhidos.');
  assert.equal(f.httpErrorMessage(404, 'Not Found'), 'Algo deu errado. Tente novamente.');
});

test('LINES: perfis viram linhas numeradas, com cores iguais às de base.css', async () => {
  const { readFileSync } = await import('node:fs');
  assert.deepEqual(Object.keys(f.LINES), ['rapida', 'equilibrada', 'segura']);
  assert.deepEqual(Object.values(f.LINES).map((l) => l.num), [1, 2, 3]);
  assert.equal(f.lineOf('equilibrada').name, 'Lilás');
  assert.equal(f.lineOf('toString'), null);
  assert.equal(f.lineOf('outra'), null);
  const css = readFileSync(new URL('../../css/base.css', import.meta.url), 'utf8');
  const [light, dark] = css.split('prefers-color-scheme: dark');
  for (const [id, l] of Object.entries(f.LINES)) {
    assert.ok(light.toLowerCase().includes(`--line-${id}: ${l.color.toLowerCase()}`), `${id} claro`);
    assert.ok(dark.toLowerCase().includes(`--line-${id}: ${l.dark.toLowerCase()}`), `${id} escuro`);
  }
});
