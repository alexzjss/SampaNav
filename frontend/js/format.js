export const CATEGORY_LABELS = {
  roubo_pessoa: 'Roubos a pedestres',
  furto_pessoa: 'Furtos',
  roubo_veiculo: 'Roubos de veículo',
  furto_veiculo: 'Furtos de veículo',
  lesao: 'Agressões',
  letal: 'Crimes letais e tentativas',
};
export const LEVEL_LABELS = { baixo: 'Risco baixo', moderado: 'Risco moderado', alto: 'Risco alto', 'muito alto': 'Risco muito alto' };
/** Significado de cada nível (relativo às ruas da cidade, mesmo modo/período). */
export const LEVEL_HINTS = {
  baixo: 'Risco baixo: no nível da metade menos arriscada das ruas da cidade.',
  moderado: 'Risco moderado: acima de 50% das ruas da cidade.',
  alto: 'Risco alto: acima de 75% das ruas da cidade.',
  'muito alto': 'Risco muito alto: acima de 90% das ruas da cidade.',
};
export const LEVEL_NOTE = 'Níveis comparam o trajeto com as ruas da cidade no mesmo período: moderado = acima da metade das ruas; alto = acima de 75%; muito alto = acima de 90%.';
export const levelHint = (level) => LEVEL_HINTS[level] || LEVEL_NOTE;

export function fmtDuration(s) {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}
export function fmtKm(m) { return `${(m / 1000).toFixed(1).replace('.', ',')} km`; }
export function fmtDate(iso) {
  if (!iso) return '?';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d && m ? `${d}/${m}/${y}` : iso;
}
export function topCategories(cats, n = 3) {
  return Object.entries(cats || {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k]) => CATEGORY_LABELS[k] || k);
}
export function vsText(vs) {
  if (!vs || (vs.duration_pct === 0 && vs.exposure_pct === 0)) return 'Referência: rota mais rápida';
  const exp = Math.round(-vs.exposure_pct);
  const dur = Math.round(vs.duration_pct);
  const expTxt = exp > 0 ? `${exp}% menos exposição` : exp < 0 ? `${-exp}% mais exposição` : 'mesma exposição';
  return `${expTxt} · ${dur >= 0 ? '+' : ''}${dur}% de tempo`;
}
/** Texto "X% menos exposição · +Y min" calculado com a duração da rota mais rápida. */
export function vsTextMinutes(route, fastest) {
  const vs = route.vs_fastest;
  if (!vs || route === fastest || (vs.exposure_pct === 0 && vs.duration_pct === 0)) return 'Referência: rota mais rápida';
  const exp = Math.round(-vs.exposure_pct);
  const dmin = Math.round((route.duration_s - fastest.duration_s) / 60);
  const expTxt = exp > 0 ? `${exp}% menos exposição` : exp < 0 ? `${-exp}% mais exposição` : 'mesma exposição';
  return `${expTxt} · ${dmin >= 0 ? '+' : ''}${dmin} min`;
}
export function levelClass(level) { return String(level).replace(' ', '-'); }

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

/** Período atual em America/Sao_Paulo. */
export function currentPeriod() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date())) % 24;
  return h < 6 ? 'madrugada' : h < 12 ? 'manha' : h < 18 ? 'tarde' : 'noite';
}

// Escala de risco lida das variáveis CSS (--risk-0..3), que mudam no tema escuro.
let stops = null;
function hexToRgb(h) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return null;
  let x = m[1];
  if (x.length === 3) x = [...x].map((c) => c + c).join('');
  return [0, 2, 4].map((k) => parseInt(x.slice(k, k + 2), 16));
}
const FALLBACK = [[46, 158, 91], [242, 199, 68], [238, 129, 51], [192, 38, 45]];
const POS = [0, 0.35, 0.65, 1];
/** Chame ao mudar o esquema de cores para reler as variáveis CSS. */
export function resetRiskPalette() { stops = null; }
function palette() {
  if (stops) return stops;
  const cs = getComputedStyle(document.documentElement);
  stops = POS.map((p, i) => [p, hexToRgb(cs.getPropertyValue(`--risk-${i}`)) || FALLBACK[i]]);
  return stops;
}
export function riskColor(r) {
  r = Math.min(1, Math.max(0, r));
  const S = palette();
  for (let i = 1; i < S.length; i++) {
    if (r <= S[i][0]) {
      const [a, ca] = S[i - 1], [b, cb] = S[i];
      const t = (r - a) / (b - a);
      return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * t)).join(',')})`;
    }
  }
  return `rgb(${S[S.length - 1][1].join(',')})`;
}
/** Distância curta para navegação: "35 m", "1,2 km". */
export function fmtMeters(m) {
  if (m >= 1000) return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  if (m >= 100) return `${Math.round(m / 10) * 10} m`;
  return `${Math.max(0, Math.round(m / 5) * 5)} m`;
}

export const PERIOD_KEYS = ['madrugada', 'manha', 'tarde', 'noite'];
const PERIOD_NAMES = { madrugada: 'Madrugada', manha: 'Manhã', tarde: 'Tarde', noite: 'Noite' };
/**
 * Linhas da comparação por período: { key, label, value, pct, level, current }.
 * pct = largura da barra (0-100) em relação ao maior valor; [] sem dados.
 */
export function periodRows(route, currentPeriod) {
  const ex = route?.exposure_by_period;
  if (!ex) return [];
  const vals = PERIOD_KEYS.map((k) => (Number.isFinite(ex[k]) ? ex[k] : null));
  if (vals.every((v) => v == null)) return [];
  const max = Math.max(...vals.map((v) => v ?? 0));
  return PERIOD_KEYS.map((key, i) => ({
    key, label: PERIOD_NAMES[key], value: vals[i],
    pct: vals[i] == null || max <= 0 ? 0 : Math.round((vals[i] / max) * 100),
    level: route.level_by_period?.[key] || null,
    current: key === currentPeriod,
  }));
}
/** Exposição para exibição: 1 casa decimal, vírgula. */
export function fmtExposure(v) { return v == null ? '–' : v.toFixed(1).replace('.', ','); }

export const MSG_RATE = 'Muitas requisições; aguarde um instante.';
export const MSG_GENERIC = 'Algo deu errado. Tente novamente.';
/** Mensagem amigável para uma resposta HTTP de erro: nunca expõe texto bruto de 5xx nem códigos. */
export function httpErrorMessage(status, detail) {
  if (status === 429) return MSG_RATE;
  if (status === 503) return typeof detail === 'string' && detail ? detail : 'Servidor iniciando; tente novamente em instantes.';
  if (status >= 500) return 'O servidor está indisponível no momento. Tente novamente em instantes.';
  if (status === 400 && typeof detail === 'string' && detail) return detail;
  if (status === 400 || status === 422) return 'Requisição inválida. Confira os pontos escolhidos.';
  return MSG_GENERIC;
}
