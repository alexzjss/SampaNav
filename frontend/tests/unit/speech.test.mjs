import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = {};
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
const sp = await import('../../js/speech.js');

test('sem suporte: no-op e não suportado', () => {
  assert.equal(sp.isSupported(), false);
  sp.speak('oi'); sp.cancel();
});

test('mudo persistido (padrão ligado)', () => {
  assert.equal(sp.isEnabled(), true);
  sp.setEnabled(false);
  assert.equal(store['sampanav.voice.v1'], '0');
  assert.equal(sp.isEnabled(), false);
  sp.setEnabled(true);
  assert.equal(sp.isEnabled(), true);
});

test('pickVoice prefere pt-BR, depois pt', () => {
  const v = [{ lang: 'en-US' }, { lang: 'pt-PT' }, { lang: 'pt_BR' }];
  assert.equal(sp.pickVoice(v), v[2]);
  assert.equal(sp.pickVoice(v.slice(0, 2)), v[1]);
  assert.equal(sp.pickVoice([{ lang: 'en-US' }]), null);
});

test('speak cancela a anterior e usa pt-BR', () => {
  const calls = [];
  globalThis.SpeechSynthesisUtterance = function (t) { this.text = t; };
  globalThis.speechSynthesis = { getVoices: () => [{ lang: 'pt-BR', name: 'x' }], cancel: () => calls.push('cancel'),
    speak: (u) => calls.push(u), addEventListener() {} };
  sp.speak('Vire à direita');
  assert.equal(calls[0], 'cancel');
  assert.equal(calls[1].lang, 'pt-BR');
  assert.equal(calls[1].voice.name, 'x');
  sp.setEnabled(false);
  calls.length = 0; sp.speak('mudo');
  assert.deepEqual(calls, []);
  sp.setEnabled(true);
});
