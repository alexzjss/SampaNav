// Voz da navegação (Web Speech API). Sem suporte: tudo vira no-op.
const KEY = 'sampanav.voice.v1';
const synth = () => (typeof globalThis.speechSynthesis !== 'undefined' && typeof globalThis.SpeechSynthesisUtterance !== 'undefined' ? globalThis.speechSynthesis : null);

export const isSupported = () => !!synth();

export function isEnabled() {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
}
export function setEnabled(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignora */ }
  if (!on) cancel();
}

/** Prefere pt-BR; senão qualquer 'pt'. */
export function pickVoice(voices) {
  const l = (v) => String(v.lang || '').replace('_', '-').toLowerCase();
  return voices.find((v) => l(v) === 'pt-br') || voices.find((v) => l(v).startsWith('pt')) || null;
}

let voice = null, hooked = false;
function loadVoice(s) {
  voice = pickVoice(s.getVoices?.() || []);
  if (!hooked && s.addEventListener) { hooked = true; s.addEventListener('voiceschanged', () => { voice = pickVoice(s.getVoices()); }); }
}

export function cancel() { try { synth()?.cancel(); } catch { /* ignora */ } }

/** Fala `text` (cancela a fala anterior). Respeita o mudo. */
export function speak(text) {
  const s = synth();
  if (!s || !text || !isEnabled()) return;
  try {
    loadVoice(s);
    s.cancel();
    const u = new globalThis.SpeechSynthesisUtterance(text);
    u.lang = 'pt-BR';
    if (voice) u.voice = voice;
    s.speak(u);
  } catch { /* ignora */ }
}
