import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const setUrl = (s) => { globalThis.location = new URL('http://example.com/app/' + s); };
setUrl('');
const { readUrlState, buildUrl, writeUrlState } = await import('../../js/urlstate.js');
beforeEach(() => setUrl(''));

const base = 'o=-23.55,-46.63&d=-23.56,-46.65';

test('sem parâmetros ou sem destino: null', () => {
  assert.equal(readUrlState(), null);
  setUrl('?o=-23.55,-46.63');
  assert.equal(readUrlState(), null);
});

test('estado válido com defaults', () => {
  setUrl('?' + base);
  assert.deepEqual(readUrlState(), {
    o: { lat: -23.55, lon: -46.63 }, d: { lat: -23.56, lon: -46.65 },
    mode: 'walk', period: 'now', route: null, oLabel: null, dLabel: null, v: null, vLabel: null,
  });
});

test('pontos inválidos: formato, fora de faixa, NaN', () => {
  for (const bad of ['abc,def', '-23.5', '91,0', '0,181', '-23.5,-46.6,1', ',', '1e2,3', '-23.,-46.']) {
    setUrl(`?o=${bad}&d=-23.56,-46.65`);
    assert.equal(readUrlState(), null, bad);
  }
  setUrl('?o=90,180&d=-90,-180');
  assert.ok(readUrlState());
});

test('modo e período: valores inválidos caem no padrão', () => {
  setUrl(`?${base}&m=drive&p=noite`);
  let s = readUrlState();
  assert.equal(s.mode, 'drive'); assert.equal(s.period, 'noite');
  setUrl(`?${base}&m=skate&p=meia-noite`);
  s = readUrlState();
  assert.equal(s.mode, 'walk'); assert.equal(s.period, 'now');
  setUrl(`?${base}&m=bike`);
  assert.equal(readUrlState().mode, 'bike');
  for (const p of ['now', 'all', 'madrugada', 'manha', 'tarde', 'noite']) {
    setUrl(`?${base}&p=${p}`);
    assert.equal(readUrlState().period, p);
  }
});

test('id da rota respeita o regex', () => {
  setUrl(`?${base}&r=segura`);
  assert.equal(readUrlState().route, 'segura');
  setUrl(`?${base}&r=a-b_9`);
  assert.equal(readUrlState().route, 'a-b_9');
  for (const bad of ['a b', '<x>', 'x'.repeat(33), 'a/b', '']) {
    setUrl(`?${base}&r=${encodeURIComponent(bad)}`);
    assert.equal(readUrlState().route, null, bad);
  }
});

test('rótulos: trim, limite de 120 e vazio vira null', () => {
  setUrl(`?${base}&on=${encodeURIComponent('  Sé  ')}&dn=${'x'.repeat(200)}`);
  let s = readUrlState();
  assert.equal(s.oLabel, 'Sé');
  assert.equal(s.dLabel.length, 120);
  setUrl(`?${base}&on=%20%20&dn=`);
  s = readUrlState();
  assert.equal(s.oLabel, null); assert.equal(s.dLabel, null);
});

test('buildUrl sem estado remove só os parâmetros próprios', () => {
  setUrl(`?${base}&m=drive&mock=1&r=x&on=a&dn=b&p=all`);
  assert.equal(buildUrl(null), 'http://example.com/app/?mock=1');
  setUrl(`?${base}`);
  assert.equal(buildUrl(null), 'http://example.com/app/');
});

test('buildUrl: formato, rótulos opcionais e preserva mock=1', () => {
  setUrl('?mock=1&simgps=1');
  const url = buildUrl({ origin: { lat: -23.5, lon: -46.6 }, dest: { lat: -23.56, lon: -46.65 }, mode: 'walk', period: 'now' });
  const q = new URL(url).searchParams;
  assert.equal(q.get('o'), '-23.50000,-46.60000');
  assert.equal(q.get('d'), '-23.56000,-46.65000');
  assert.equal(q.get('mock'), '1'); assert.equal(q.get('simgps'), '1');
  assert.equal(q.has('r'), false); assert.equal(q.has('on'), false);
  assert.ok(url.startsWith('http://example.com/app/?'));
});

test('round-trip buildUrl -> readUrlState', () => {
  const s = { origin: { lat: -23.55051, lon: -46.63331 }, dest: { lat: -23.5614, lon: -46.6559 },
    mode: 'drive', period: 'tarde', route: 'equilibrada', originLabel: 'Praça da Sé, São Paulo', destLabel: 'Av. Paulista & Cia' };
  setUrl('?mock=1');
  const url = buildUrl(s);
  globalThis.location = new URL(url);
  assert.deepEqual(readUrlState(), {
    o: s.origin, d: s.dest, mode: 'drive', period: 'tarde', route: 'equilibrada',
    oLabel: s.originLabel, dLabel: s.destLabel, v: null, vLabel: null,
  });
  assert.equal(new URL(url).searchParams.get('mock'), '1');
});

test('buildUrl substitui parâmetros próprios existentes', () => {
  setUrl(`?${base}&r=velha&on=velho`);
  const url = buildUrl({ origin: { lat: 1, lon: 2 }, dest: { lat: 3, lon: 4 }, mode: 'walk', period: 'all' });
  const q = new URL(url).searchParams;
  assert.equal(q.getAll('o').length, 1);
  assert.equal(q.get('o'), '1.00000,2.00000');
  assert.equal(q.has('r'), false); assert.equal(q.has('on'), false);
});

test('writeUrlState chama history.replaceState e tolera exceção', () => {
  const calls = [];
  globalThis.history = { replaceState: (...a) => calls.push(a) };
  writeUrlState({ origin: { lat: 1, lon: 2 }, dest: { lat: 3, lon: 4 }, mode: 'walk', period: 'now' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], 'http://example.com/app/?o=1.00000%2C2.00000&d=3.00000%2C4.00000&m=walk&p=now');
  globalThis.history = { replaceState() { throw new Error('SecurityError'); } };
  assert.doesNotThrow(() => writeUrlState(null));
});

test('parada (v/vn): leitura, inválida vira null, round-trip e remoção', () => {
  setUrl(`?${base}&v=-23.551,-46.64&vn=${encodeURIComponent('Praça X')}`);
  let s = readUrlState();
  assert.deepEqual(s.v, { lat: -23.551, lon: -46.64 }); assert.equal(s.vLabel, 'Praça X');
  setUrl(`?${base}&v=abc`);
  s = readUrlState();
  assert.equal(s.v, null); assert.equal(s.vLabel, null);
  const st = { origin: { lat: 1, lon: 2 }, dest: { lat: 3, lon: 4 }, via: { lat: -23.5512, lon: -46.64 }, viaLabel: 'Parada A', mode: 'bike', period: 'noite' };
  setUrl('?mock=1');
  const url = buildUrl(st);
  const q = new URL(url).searchParams;
  assert.equal(q.get('v'), '-23.55120,-46.64000'); assert.equal(q.get('vn'), 'Parada A'); assert.equal(q.get('m'), 'bike');
  globalThis.location = new URL(url);
  s = readUrlState();
  assert.deepEqual(s.v, { lat: -23.5512, lon: -46.64 }); assert.equal(s.vLabel, 'Parada A'); assert.equal(s.mode, 'bike');
  const q2 = new URL(buildUrl({ ...st, via: null })).searchParams;
  assert.equal(q2.has('v'), false); assert.equal(q2.has('vn'), false);
  assert.equal(new URL(buildUrl(null)).searchParams.has('v'), false);
});
