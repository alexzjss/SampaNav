export const CATEGORY_LABELS = {
  roubo_pessoa: 'Roubos a pedestres',
  furto_pessoa: 'Furtos',
  roubo_veiculo: 'Roubos de veículo',
  furto_veiculo: 'Furtos de veículo',
  lesao: 'Agressões',
  letal: 'Crimes letais e tentativas',
};
export const LEVEL_LABELS = { baixo: 'Risco baixo', moderado: 'Risco moderado', alto: 'Risco alto', 'muito alto': 'Risco muito alto' };

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
