const MOCK = new URLSearchParams(location.search).get('mock') === '1';
export const isMock = MOCK;
let mockMod;
async function mock() { return (mockMod ??= await import('./mock.js')); }

async function http(path, opts) {
  let res;
  try { res = await fetch(path, opts); }
  catch (e) { if (e.name === 'AbortError') throw e; throw new Error('Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.'); }
  let body = null;
  try { body = await res.json(); } catch { /* ignora */ }
  if (!res.ok) {
    const d = body && body.detail;
    throw new Error(typeof d === 'string' ? d : Array.isArray(d) ? 'Requisição inválida. Confira os pontos escolhidos.' : `Erro do servidor (${res.status}).`);
  }
  return body;
}

export async function getMeta() { return MOCK ? (await mock()).meta() : http('/api/meta'); }
export async function geocode(q, signal) {
  return MOCK ? (await mock()).geocode(q) : http(`/api/geocode?q=${encodeURIComponent(q)}`, { signal });
}
export async function postRoutes(payload) {
  return MOCK ? (await mock()).routes(payload) : http('/api/routes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
}
export async function getRisk(bbox, mode, period, signal) {
  const qs = new URLSearchParams({ bbox: bbox.join(','), mode, period });
  return MOCK ? (await mock()).risk(bbox, mode, period) : http(`/api/risk?${qs}`, { signal });
}
