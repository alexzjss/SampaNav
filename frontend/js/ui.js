import { debounce, fmtDuration, fmtKm, fmtDate, topCategories, vsTextMinutes, levelClass, LEVEL_LABELS } from './format.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function setupAutocomplete({ input, list, search, onPick, onType }) {
  let items = [], active = -1, seq = 0;
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const setActive = (i) => {
    active = i;
    [...list.children].forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
    if (i >= 0) { input.setAttribute('aria-activedescendant', list.children[i].id); list.children[i].scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  };
  const pick = (i) => { const it = items[i]; if (!it) return; input.value = it.label; close(); onPick(it); };
  const render = (msg) => {
    list.innerHTML = '';
    if (msg) list.innerHTML = `<li class="empty" role="presentation">${esc(msg)}</li>`;
    items.forEach((it, i) => {
      const li = document.createElement('li');
      li.id = `${list.id}-${i}`; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', 'false');
      li.textContent = it.label;
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i); });
      list.appendChild(li);
    });
    list.hidden = false; input.setAttribute('aria-expanded', 'true'); active = -1;
  };
  const run = debounce(async (q) => {
    const my = ++seq;
    try {
      items = await search(q);
      if (my !== seq) return;
      render(items.length ? '' : 'Nenhum resultado encontrado.');
    } catch (e) { if (my === seq) { items = []; render('Não foi possível buscar endereços agora.'); } }
  }, 300);
  input.addEventListener('input', () => {
    onType?.();
    const q = input.value.trim();
    if (q.length < 3) { seq++; run.cancel(); close(); return; }
    run(q);
  });
  input.addEventListener('keydown', (e) => {
    const open = !list.hidden && items.length;
    if (e.key === 'ArrowDown' && open) { e.preventDefault(); setActive((active + 1) % items.length); }
    else if (e.key === 'ArrowUp' && open) { e.preventDefault(); setActive((active - 1 + items.length) % items.length); }
    else if (e.key === 'Enter' && open && active >= 0) { e.preventDefault(); pick(active); }
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  return { close };
}

export function setupUi(h) {
  const originIn = $('origin-input'), destIn = $('dest-input');
  const status = $('status'), errBox = $('error');
  const panel = $('panel'), toggle = $('sheet-toggle');

  const setStatus = (t) => { status.textContent = t || ''; };
  const setError = (t) => { errBox.hidden = !t; errBox.textContent = t || ''; };
  const setBusy = (b) => { $('calc').disabled = b; $('calc').textContent = b ? 'Calculando…' : 'Calcular rotas'; };

  setupAutocomplete({ input: originIn, list: $('origin-list'), search: h.geocode, onPick: (p) => h.onPick('origin', p), onType: () => h.onTyped('origin') });
  setupAutocomplete({ input: destIn, list: $('dest-list'), search: h.geocode, onPick: (p) => h.onPick('dest', p), onType: () => h.onTyped('dest') });

  $('use-location').addEventListener('click', () => {
    if (!navigator.geolocation) { setError('Seu navegador não oferece localização.'); return; }
    setError(''); setStatus('Obtendo sua localização…');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setStatus(''); h.onPick('origin', { label: 'Minha localização', lat: pos.coords.latitude, lon: pos.coords.longitude }); },
      (err) => { setStatus(''); setError(err.code === 1 ? 'Permissão de localização negada. Digite um endereço ou clique no mapa.' : 'Não foi possível obter sua localização.'); },
      { enableHighAccuracy: true, timeout: 10000 });
  });
  $('swap').addEventListener('click', () => h.onSwap());
  $('route-form').addEventListener('submit', (e) => { e.preventDefault(); h.onCalc(); });
  document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => h.onSettings()));
  $('period').addEventListener('change', () => h.onSettings());
  $('heat-toggle').addEventListener('change', (e) => { $('legend').hidden = !e.target.checked; h.onHeat(e.target.checked); });
  toggle.addEventListener('click', () => {
    const c = panel.classList.toggle('collapsed');
    toggle.setAttribute('aria-expanded', String(!c));
  });

  return {
    setStatus, setError, setBusy,
    getMode: () => document.querySelector('input[name=mode]:checked').value,
    getPeriod: () => $('period').value,
    setInput(kind, text) { (kind === 'origin' ? originIn : destIn).value = text; },
    setHint(t) { $('map-hint').textContent = t; },
    setMeta(m) {
      $('period-range').textContent = m ? `${fmtDate(m.date_min)} a ${fmtDate(m.date_max)}` : 'indisponível';
    },
    toast(id, show) { $(id).hidden = !show; },
    collapseSheet(c) { if (innerWidth < 768) { panel.classList.toggle('collapsed', c); toggle.setAttribute('aria-expanded', String(!c)); } },
    renderCards(routes, selectedId) {
      const sec = $('routes-section'), ul = $('route-cards');
      sec.hidden = !routes.length; ul.innerHTML = '';
      const fastest = routes.find((r) => r.id === 'rapida') || routes[0];
      routes.forEach((r) => {
        const li = document.createElement('li');
        const cats = topCategories(r.categories);
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'card'; b.dataset.id = r.id;
        b.setAttribute('aria-pressed', String(r.id === selectedId));
        b.innerHTML = `
          <div class="card-top"><span class="card-label">${esc(r.label)}</span>
            <span class="badge ${levelClass(r.risk_level)}">${esc((LEVEL_LABELS[r.risk_level] || r.risk_level))}</span></div>
          <p class="card-metrics">${fmtDuration(r.duration_s)}<small>${fmtKm(r.distance_m)}</small></p>
          <p class="card-vs">${esc(vsTextMinutes(r, fastest))}</p>
          <p class="card-cats">${cats.length ? 'Mais registrados: ' + esc(cats.join(', ')) : 'Poucos registros no trajeto'}</p>`;
        b.addEventListener('click', () => h.onSelect(r.id));
        li.appendChild(b); ul.appendChild(li);
      });
    },
    markSelected(id) {
      document.querySelectorAll('.card').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.id === id)));
    },
  };
}
