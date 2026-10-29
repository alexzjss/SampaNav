// Estilo MapLibre mínimo (sem texto/glifos) desenhado a partir do GeoJSON de ruas gerado por basemap.py.
const THEMES = {
  light: {
    bg: '#e8eaed', minor: '#f7f7f8', minorCase: '#d9dce1', path: '#d4d8de',
    tertiary: '#ffffff', secondary: '#ffffff', primary: '#ffffff', trunk: '#fbfbfc', motorway: '#fbfbfc',
    casing: '#c9ced6', majorCase: '#bfc5ce',
  },
  dark: {
    bg: '#171a21', minor: '#262a33', minorCase: '#1d2027', path: '#2a2e38',
    tertiary: '#323743', secondary: '#383d4a', primary: '#3e4452', trunk: '#444b5a', motorway: '#4a5262',
    casing: '#12141a', majorCase: '#0f1116',
  },
};

const w = (...stops) => ({ base: 1.4, stops });

export function basemapStyle(geojson, scheme = 'light') {
  const t = THEMES[scheme] || THEMES.light;
  const src = 'streets';
  const cls = (c) => ['==', ['get', 'c'], c];
  const line = (id, c, color, width, extra = {}) => ({
    id, type: 'line', source: src, filter: cls(c),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': width, ...extra },
  });
  const layers = [
    { id: 'bg', type: 'background', paint: { 'background-color': t.bg } },
    line('path', 'path', t.path, w([13, 0], [15, 0.5], [18, 1.4]), { 'line-opacity': 0.9 }),
    line('minor-case', 'minor', t.minorCase, w([12, 0.6], [13, 1.5], [14, 2.1], [16, 4.6], [19, 12])),
    line('tertiary-case', 'tertiary', t.majorCase, w([10, 0.8], [13, 2.6], [16, 7], [19, 17])),
    line('secondary-case', 'secondary', t.majorCase, w([10, 1.2], [13, 3.4], [16, 8], [19, 19])),
    line('primary-case', 'primary', t.majorCase, w([9, 1.4], [13, 4.2], [16, 9.5], [19, 22])),
    line('trunk-case', 'trunk', t.majorCase, w([9, 1.6], [13, 4.8], [16, 10.5], [19, 24])),
    line('motorway-case', 'motorway', t.majorCase, w([9, 1.8], [13, 5.4], [16, 11.5], [19, 26])),
    line('minor', 'minor', t.minor, w([12, 0.3], [13, 0.9], [14, 1.4], [16, 3.4], [19, 10.5])),
    line('tertiary', 'tertiary', t.tertiary, w([10, 0.4], [13, 1.8], [16, 5.6], [19, 15])),
    line('secondary', 'secondary', t.secondary, w([10, 0.8], [13, 2.6], [16, 6.6], [19, 17])),
    line('primary', 'primary', t.primary, w([9, 1], [13, 3.4], [16, 8], [19, 20])),
    line('trunk', 'trunk', t.trunk, w([9, 1.2], [13, 4], [16, 9], [19, 22])),
    line('motorway', 'motorway', t.motorway, w([9, 1.4], [13, 4.6], [16, 10], [19, 24])),
  ];
  return { version: 8, name: `sampanav-${scheme}`, sources: { [src]: { type: 'geojson', data: geojson, tolerance: 0.6 } }, layers };
}
