// Registra o service worker (app shell offline) e avisa quando há versão nova. Só em https ou localhost.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  const hadController = !!navigator.serviceWorker.controller;
  const offer = () => {
    const bar = document.getElementById('update-banner');
    if (!bar) return;
    bar.hidden = false;
    document.getElementById('update-reload').onclick = () => location.reload();
  };
  // O sw.js faz skipWaiting + clients.claim: uma nova versão assume sozinha e dispara controllerchange.
  if (hadController) navigator.serviceWorker.addEventListener('controllerchange', offer);
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      if (reg.waiting && hadController) offer();
      const check = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
      setInterval(check, 60 * 60 * 1000);
    }).catch((e) => console.warn('SW não registrado:', e));
  });
}
