import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
let throwing = false;
globalThis.localStorage = {
  getItem(k) { if (throwing) throw new Error('blocked'); return store.has(k) ? store.get(k) : null; },
  setItem(k, v) { if (throwing) throw new Error('quota'); store.set(k, String(v)); },
  removeItem(k) { if (throwing) throw new Error('blocked'); store.delete(k); },
};
const { loadHistory, addHistory, clearHistory } = await import('../../js/history.js');
const KEY = 'sampanav.history.v1';
beforeEach(() => { store.clear(); throwing = false; });

const q = (n, mode = 'walk') => ({
  o: { lat: -23.5 - n * 0.01, lon: -46.6, label: `o${n}` }, d: { lat: -23.6 - n * 0.01, lon: -46.7, label: `d${n}` }, mode, period: 'now',
});

test('vazio por padrão', () => assert.deepEqual(loadHistory(), []));

test('add guarda entrada limpa (5 casas, label cortado) e mais recente primeiro', () => {
  addHistory({ o: { lat: -23.123456789, lon: -46.987654321, label: 'x'.repeat(300) }, d: { lat: 1, lon: 2 }, mode: 'drive' });
  const [e] = addHistory(q(1));
  assert.equal(e.o.label, 'o1');
  const list = loadHistory();
  assert.equal(list.length, 2);
  assert.equal(list[1].o.lat, -23.12346);
  assert.equal(list[1].o.lon, -46.98765);
  assert.equal(list[1].o.label.length, 120);
  assert.equal(list[1].d.label, '');
  assert.equal(list[1].period, 'now');
  assert.equal(typeof list[1].t, 'number');
});

test('dedupe por modo e proximidade (<1e-4), reposiciona no topo', () => {
  addHistory(q(1)); addHistory(q(2));
  const near = q(1); near.o.lat += 5e-5;
  const list = addHistory(near);
  assert.equal(list.length, 2);
  assert.equal(list[0].d.label, 'd1');
  // modo diferente não é duplicata
  assert.equal(addHistory(q(1, 'drive')).length, 3);
  // longe (>=1e-4) também não
  const far = q(1); far.o.lat += 2e-4;
  assert.equal(addHistory(far).length, 4);
});

test('máximo de 10 entradas, descartando as mais antigas', () => {
  for (let i = 0; i < 15; i++) addHistory(q(i));
  const list = loadHistory();
  assert.equal(list.length, 10);
  assert.equal(list[0].o.label, 'o14');
  assert.equal(list[9].o.label, 'o5');
});

test('clear remove tudo', () => {
  addHistory(q(1)); clearHistory();
  assert.deepEqual(loadHistory(), []);
  assert.equal(store.has(KEY), false);
});

test('JSON corrompido ou tipo errado vira lista vazia', () => {
  store.set(KEY, '{nao json');
  assert.deepEqual(loadHistory(), []);
  store.set(KEY, '{"a":1}');
  assert.deepEqual(loadHistory(), []);
  // add por cima de lixo funciona
  store.set(KEY, '{nao json');
  assert.equal(addHistory(q(1)).length, 1);
});

test('entradas inválidas são filtradas e o excesso cortado em 10', () => {
  const good = { o: { lat: 1, lon: 2 }, d: { lat: 3, lon: 4 }, mode: 'walk' };
  store.set(KEY, JSON.stringify([null, 5, { ...good, mode: 'bike' }, { ...good, o: { lat: 'a', lon: 2 } },
    { ...good, d: null }, good, ...Array(20).fill(good)]));
  const list = loadHistory();
  assert.equal(list.length, 10);
  assert.ok(list.every((e) => e.mode === 'walk'));
});

test('localStorage que lança: nada quebra', () => {
  throwing = true;
  assert.deepEqual(loadHistory(), []);
  let list;
  assert.doesNotThrow(() => { list = addHistory(q(1)); });
  assert.equal(list.length, 1); // devolve a lista em memória mesmo sem persistir
  assert.doesNotThrow(() => clearHistory());
});
