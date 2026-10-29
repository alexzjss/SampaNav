// Service worker: app shell em cache. Nunca guarda /api/, config.js nem requisições de outras origens.
const CACHE = 'sampanav-shell-v4';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'css/base.css', 'css/layout.css', 'css/components.css', 'css/about.css',
  'js/main.js', 'js/pwa.js', 'js/ui.js', 'js/format.js', 'js/gpx.js', 'js/icons.js', 'js/history.js', 'js/api.js', 'js/map.js', 'js/mock.js', 'js/nav.js', 'js/navui.js', 'js/speech.js', 'js/urlstate.js', 'config.js',
  'img/logo.svg', 'img/favicon.svg', 'img/icon-192.png',
];

self.addEventListener('install', (e) => {
  // addAll falha se um arquivo faltar; tolera para não impedir a instalação
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('sampanav-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function put(req, res) {
  if (res.ok && res.type === 'basic') { const c = await caches.open(CACHE); await c.put(req, res.clone()); }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/api/')) return;

  if (url.pathname.endsWith('/config.js')) { // sempre rede; cache só offline
    e.respondWith(fetch(req).then((r) => put(req, r)).catch(() => caches.match(req).then((m) => m || Response.error())));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => put(req, r)).catch(() => caches.match(req).then((m) => m || caches.match('index.html')).then((m) => m || Response.error())));
    return;
  }
  // rede primeiro (versões consistentes entre index/JS/CSS) com cache de reserva offline; imagens: cache primeiro
  if (/\.(png|svg|webp|ico)$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then((m) => m || fetch(req).then((r) => put(req, r)).catch(() => Response.error())));
    return;
  }
  e.respondWith(fetch(req).then((r) => put(req, r)).catch(() => caches.match(req).then((m) => m || Response.error())));
});
