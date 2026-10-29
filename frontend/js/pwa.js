// Registra o service worker (app shell offline). Só em https ou localhost.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW não registrado:', e));
  });
}
