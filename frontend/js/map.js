import { riskColor } from './format.js';

const CENTER = [-46.63, -23.55];
const BOUNDS = [[-46.9, -24.05], [-46.3, -23.3]];
const EMPTY = { type: 'FeatureCollection', features: [] };
export const HEAT_MIN_ZOOM = 12;

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

export function createMap(handlers) {
  const map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/positron',
    center: CENTER, zoom: 11.5, maxBounds: BOUNDS, attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  const markers = { origin: null, dest: null };
  let routes = [];
  let selectedId = null;
  let ready = false;
  const whenReady = [];
  const run = (fn) => (ready ? fn() : whenReady.push(fn));

  map.on('load', () => {
    map.addSource('heat', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'heat-fill', type: 'fill', source: 'heat', paint: {
      'fill-opacity': 0.38,
      'fill-color': ['interpolate', ['linear'], ['get', 'risk'],
        0.05, '#2e9e5b', 0.35, '#f2c744', 0.65, '#ee8133', 1, '#c0262d'],
    } });
    map.addSource('routes', { type: 'geojson', data: EMPTY });
    map.addSource('selected', { type: 'geojson', data: EMPTY });
    const line = { 'line-cap': 'round', 'line-join': 'round' };
    map.addLayer({ id: 'routes-muted', type: 'line', source: 'routes', layout: line,
      paint: { 'line-color': cssVar('--route-muted'), 'line-width': 6, 'line-opacity': 0.85 } });
    map.addLayer({ id: 'selected-casing', type: 'line', source: 'selected', layout: line,
      paint: { 'line-color': cssVar('--route-casing'), 'line-width': 11 } });
    map.addLayer({ id: 'selected-line', type: 'line', source: 'selected', layout: line,
      paint: { 'line-color': ['get', 'color'], 'line-width': 6.5 } });
    ready = true;
    whenReady.splice(0).forEach((f) => f());
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      map.setPaintProperty('routes-muted', 'line-color', cssVar('--route-muted'));
      map.setPaintProperty('selected-casing', 'line-color', cssVar('--route-casing'));
    });
    handlers.onReady?.();
  });

  let routeClicked = false;
  map.on('click', 'routes-muted', (e) => {
    routeClicked = true;
    const id = e.features[0]?.properties.id;
    if (id) handlers.onRouteClick?.(id);
  });
  map.on('mouseenter', 'routes-muted', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'routes-muted', () => { map.getCanvas().style.cursor = ''; });
  map.on('click', (e) => {
    if (routeClicked) { routeClicked = false; return; }
    handlers.onMapClick?.({ lat: e.lngLat.lat, lon: e.lngLat.lng });
  });
  map.on('moveend', () => handlers.onMoveEnd?.());

  function draw() {
    const muted = routes.filter((r) => r.id !== selectedId).map((r) => ({
      type: 'Feature', properties: { id: r.id }, geometry: r.geometry }));
    const sel = routes.find((r) => r.id === selectedId);
    const segs = sel ? (sel.segments?.length ? sel.segments : [{ coordinates: sel.geometry.coordinates, risk: sel.avg_risk }]) : [];
    map.getSource('routes').setData({ type: 'FeatureCollection', features: muted });
    map.getSource('selected').setData({ type: 'FeatureCollection', features: segs.map((s) => ({
      type: 'Feature', properties: { color: riskColor(s.risk) }, geometry: { type: 'LineString', coordinates: s.coordinates } })) });
  }

  function fitRoutes() {
    const b = new maplibregl.LngLatBounds();
    routes.forEach((r) => r.geometry.coordinates.forEach((c) => b.extend(c)));
    if (b.isEmpty()) return;
    const mobile = innerWidth < 768;
    map.fitBounds(b, { duration: 600, maxZoom: 16,
      padding: mobile ? { top: 40, left: 30, right: 30, bottom: Math.round(innerHeight * 0.55) }
        : { top: 60, bottom: 60, left: 60, right: 60 } });
  }

  return {
    map,
    setPoint(kind, p) {
      markers[kind]?.remove(); markers[kind] = null;
      if (!p) return;
      const el = document.createElement('div');
      el.className = `pin ${kind}`;
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', kind === 'origin' ? 'Origem' : 'Destino');
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([p.lon, p.lat]).addTo(map);
      m.on('dragend', () => { const l = m.getLngLat(); handlers.onMarkerDrag?.(kind, { lat: l.lat, lon: l.lng }); });
      markers[kind] = m;
    },
    setRoutes(list, sel, fit = true) {
      routes = list; selectedId = sel;
      run(() => { draw(); if (fit) fitRoutes(); });
    },
    select(id) { selectedId = id; run(draw); },
    clearRoutes() { routes = []; selectedId = null; run(draw); },
    setHeat(cells) {
      run(() => {
        const h3 = window.h3;
        const features = [];
        for (const c of cells) {
          try {
            features.push({ type: 'Feature', properties: { risk: c.risk },
              geometry: { type: 'Polygon', coordinates: [h3.cellToBoundary(c.h3, true)] } });
          } catch { /* célula inválida */ }
        }
        map.getSource('heat').setData({ type: 'FeatureCollection', features });
      });
    },
    clearHeat() { run(() => map.getSource('heat').setData(EMPTY)); },
    bbox() { const b = map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((x) => +x.toFixed(5)); },
    zoom: () => map.getZoom(),
    flyTo(p) { map.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 14) }); },
  };
}
