import { maneuverIcon } from './icons.js';
import { fmtMeters, fmtDuration } from './format.js';

const $ = (id) => document.getElementById(id);

/** Banner de navegação (topo do mapa). h: { onExit, onRecalc, onRecenter } */
export function setupNavBanner(h) {
  const root = $('nav-banner'), icon = $('nav-icon'), dist = $('nav-dist'), text = $('nav-text'), sub = $('nav-sub');
  const off = $('nav-off'), notice = $('nav-notice'), live = $('nav-live'), recBtn = $('nav-recenter');
  $('nav-exit').addEventListener('click', h.onExit);
  $('nav-recalc').addEventListener('click', h.onRecalc);
  recBtn.addEventListener('click', h.onRecenter);

  const set = (cls) => { root.classList.remove('is-off', 'is-arrived'); if (cls) root.classList.add(cls); };
  return {
    show(on, route) {
      root.hidden = !on;
      document.body.classList.toggle('navigating', on);
      if (on) {
        set(null); off.hidden = true; notice.hidden = true; recBtn.hidden = true;
        icon.innerHTML = maneuverIcon('depart', 36);
        dist.textContent = ''; text.textContent = 'Aguardando sinal de GPS…';
        sub.textContent = route ? `${route.label} · ${fmtDuration(route.duration_s)}` : '';
      }
    },
    update({ step, next, distNext, remaining, hasSteps }) {
      set(null);
      if (!hasSteps) {
        icon.innerHTML = maneuverIcon('continue', 36);
        dist.textContent = fmtMeters(remaining); text.textContent = 'Siga a rota até o destino'; sub.textContent = 'restantes';
        return;
      }
      const m = next || { maneuver: 'arrive', instruction: 'Chegada ao destino' };
      icon.innerHTML = maneuverIcon(m.maneuver, 36);
      dist.textContent = distNext < 20 ? 'Agora' : `Em ${fmtMeters(distNext)}`;
      text.textContent = m.instruction;
      sub.textContent = `${step ? step.instruction + ' · ' : ''}faltam ${fmtMeters(remaining)}`;
    },
    offRoute(on) {
      off.hidden = !on;
      if (on) { set('is-off'); icon.innerHTML = maneuverIcon('uturn', 36); dist.textContent = ''; text.textContent = 'Você saiu da rota'; sub.textContent = ''; }
      else if (!root.hidden) set(null);
    },
    arrived() {
      set('is-arrived'); off.hidden = true; icon.innerHTML = maneuverIcon('arrive', 36);
      dist.textContent = ''; text.textContent = 'Você chegou'; sub.textContent = 'Chegada ao destino';
    },
    recalcBusy(b) { const bt = $('nav-recalc'); bt.disabled = b; bt.textContent = b ? 'Recalculando…' : 'Recalcular'; },
    following(f) { recBtn.hidden = f; },
    notice(t) { notice.hidden = !t; notice.textContent = t || ''; },
    announce(t) { live.textContent = t; },
  };
}
