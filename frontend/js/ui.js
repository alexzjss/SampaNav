import { debounce, fmtDuration, fmtKm, fmtDate, fmtMeters, topCategories, vsTextMinutes, MSG_RATE, levelClass, levelHint, periodRows, fmtExposure, LEVEL_LABELS, LEVEL_NOTE } from './format.js';
import { maneuverIcon } from './icons.js';
import { loadHistory, clearHistory } from './history.js';

const $ = (id) => document.getElementById(id);
const PERIOD_LABELS = { now: 'Agora', all: 'Todos', madrugada: 'Madrugada', manha: 'Manhã', tarde: 'Tarde', noite: 'Noite' };
const MODE_LABELS = { walk: 'A pé', drive: 'Carro', bike: 'Bicicleta' };
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
  const pick = (i) => { const it = items[i]; if (!it) return; seq++; run.cancel(); input.value = it.label; close(); onPick(it); };
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
    } catch (e) { if (my === seq) { items = []; render(e && e.status === 429 ? MSG_RATE : 'Não foi possível buscar endereços agora.'); } }
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
  const originIn = $('origin-input'), destIn = $('dest-input'), viaIn = $('via-input');
  const status = $('status'), errBox = $('error');
  const panel = $('panel'), toggle = $('sheet-toggle');

  const setStatus = (t) => { status.textContent = t || ''; };
  const setError = (t) => { errBox.hidden = !t; errBox.textContent = t || ''; };
  let busy = false, serverReady = true, stepsOpen = false;
  let lastRoutes = [], lastSel = null, lastPeriod = null;
  const syncCalc = () => {
    const b = $('calc');
    b.disabled = busy || !serverReady; b.setAttribute('aria-busy', String(busy));
    b.innerHTML = busy ? '<span class="spinner" aria-hidden="true"></span>Calculando…' : 'Calcular rotas';
  };
  const setBusy = (b) => { busy = b; syncCalc(); };
  let snackTimer;
  const snack = (t) => {
    const el = $('snack'); el.textContent = t; el.hidden = false;
    clearTimeout(snackTimer); snackTimer = setTimeout(() => { el.hidden = true; }, 2800);
  };

  // ---- Recentes ----
  let destFocused = false;
  function refreshRecents() {
    const list = loadHistory(), box = $('recents'), ul = $('recents-list');
    const bothEmpty = !originIn.value.trim() && !destIn.value.trim();
    const show = list.length && (bothEmpty || (destFocused && !destIn.value.trim()));
    box.hidden = !show; ul.innerHTML = '';
    if (!show) return;
    list.forEach((e, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'recent';
      b.innerHTML = `<span class="recent-route">${esc(e.o.label || 'Origem')} <span aria-hidden="true">→</span><span class="visually-hidden">para</span> ${esc(e.d.label || 'Destino')}</span>
        <span class="recent-meta">${MODE_LABELS[e.mode]} · ${PERIOD_LABELS[e.period] || ''}</span>`;
      b.addEventListener('mousedown', (ev) => ev.preventDefault()); // não tira o foco do campo
      b.addEventListener('click', () => { destFocused = false; h.onRecent(e); });
      li.appendChild(b); ul.appendChild(li);
    });
  }
  [originIn, destIn].forEach((el) => el.addEventListener('input', refreshRecents));
  const bikeNote = () => { $('bike-note').hidden = document.querySelector('input[name=mode]:checked')?.value !== 'bike'; };
  destIn.addEventListener('focus', () => { destFocused = true; refreshRecents(); });
  destIn.addEventListener('blur', () => { destFocused = false; setTimeout(refreshRecents, 150); });
  $('clear-history').addEventListener('mousedown', (ev) => ev.preventDefault());
  $('clear-history').addEventListener('click', () => { clearHistory(); refreshRecents(); snack('Histórico apagado'); });

  setupAutocomplete({ input: originIn, list: $('origin-list'), search: h.geocode, onPick: (p) => h.onPick('origin', p), onType: () => h.onTyped('origin') });
  setupAutocomplete({ input: destIn, list: $('dest-list'), search: h.geocode, onPick: (p) => h.onPick('dest', p), onType: () => h.onTyped('dest') });

  setupAutocomplete({ input: viaIn, list: $('via-list'), search: h.geocode, onPick: (p) => h.onPick('via', p), onType: () => h.onTyped('via') });
  const showVia = (on, focus = false) => {
    $('via-field').hidden = !on; $('via-add').hidden = on;
    if (!on) viaIn.value = ''; else if (focus) viaIn.focus();
  };
  $('via-add').addEventListener('click', () => showVia(true, true));
  $('via-remove').addEventListener('click', () => { showVia(false); h.onViaRemove(); $('via-add').focus(); });

  $('use-location').addEventListener('click', () => {
    if (!navigator.geolocation) { setError('Seu navegador não oferece localização.'); return; }
    const btn = $('use-location');
    if (btn.disabled) return;
    btn.disabled = true; setError(''); setStatus('Obtendo sua localização…');
    navigator.geolocation.getCurrentPosition(
      (pos) => { btn.disabled = false; setStatus(''); h.onPick('origin', { label: 'Minha localização', lat: pos.coords.latitude, lon: pos.coords.longitude }); },
      (err) => { btn.disabled = false; setStatus(''); setError(err.code === 1 ? 'Permissão de localização negada. Digite um endereço ou clique no mapa.' : 'Não foi possível obter sua localização.'); },
      { enableHighAccuracy: true, timeout: 10000 });
  });
  $('swap').addEventListener('click', () => h.onSwap());
  $('route-form').addEventListener('submit', (e) => { e.preventDefault(); h.onCalc(); });
  document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => { bikeNote(); h.onSettings(); }));
  $('period').addEventListener('change', () => h.onSettings());
  $('heat-toggle').addEventListener('change', (e) => { $('legend').hidden = !e.target.checked; h.onHeat(e.target.checked); });
  toggle.addEventListener('click', () => {
    const c = panel.classList.toggle('collapsed');
    toggle.setAttribute('aria-expanded', String(!c));
  });

  // ---- Sobre e limitações ----
  const about = $('about-dialog'), aboutBtn = $('about-open');
  if (about && typeof about.showModal === 'function') {
    aboutBtn.addEventListener('click', () => about.showModal());
    $('about-close').addEventListener('click', () => about.close());
    // clique no backdrop (alvo é o próprio <dialog>) fecha
    about.addEventListener('click', (e) => { if (e.target === about) about.close(); });
    about.addEventListener('close', () => aboutBtn.focus());
  } else aboutBtn?.remove();
  $('level-note').textContent = LEVEL_NOTE;

  $('server-retry').addEventListener('click', () => h.onServerRetry?.());
  refreshRecents();

  return {
    setStatus, setError, setBusy,
    getMode: () => document.querySelector('input[name=mode]:checked').value,
    getPeriod: () => $('period').value,
    setInput(kind, text) {
      if (kind === 'via' && text) showVia(true);
      ({ origin: originIn, dest: destIn, via: viaIn })[kind].value = text;
    },
    showVia,
    /** Remove "Bike" se o servidor informa os modos carregados e ela não está entre eles. */
    setModes(modes) {
      if (!Array.isArray(modes) || modes.includes('bike')) return;
      const el = $('mode-bike');
      if (!el) return;
      const wasBike = el.querySelector('input').checked;
      el.remove();
      if (wasBike) { const w = document.querySelector('input[name=mode][value=walk]'); if (w) w.checked = true; bikeNote(); }
    },
    setHint(t) { $('map-hint').textContent = t; },
    setMeta(m) {
      const t = m ? `${fmtDate(m.date_min)} a ${fmtDate(m.date_max)}` : 'indisponível';
      if (m && m.modes) this.setModes(m.modes);
      $('period-range').textContent = t;
      const ar = $('about-range'); if (ar) ar.textContent = t;
    },
    toast(id, show) { $(id).hidden = !show; },
    collapseSheet(c) { if (innerWidth < 768) { panel.classList.toggle('collapsed', c); toggle.setAttribute('aria-expanded', String(!c)); } },
    renderCards(routes, selectedId, period = lastPeriod) {
      lastRoutes = routes; lastSel = selectedId; lastPeriod = period;
      const focusId = document.activeElement?.classList?.contains('card') ? document.activeElement.dataset.id : null;
      const sec = $('routes-section'), ul = $('route-cards');
      sec.hidden = !routes.length; ul.innerHTML = '';
      const fastest = routes.find((r) => r.id === 'rapida') || routes[0];
      routes.forEach((r) => {
        const li = document.createElement('li');
        const cats = topCategories(r.categories);
        const sel = r.id === selectedId;
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'card'; b.dataset.id = r.id;
        b.setAttribute('aria-pressed', String(sel));
        b.innerHTML = `
          <div class="card-top"><span class="card-label">${esc(r.label)}</span>
            <span class="badge ${levelClass(r.risk_level)}" title="${esc(levelHint(r.risk_level))}">${esc((LEVEL_LABELS[r.risk_level] || r.risk_level))}</span></div>
          <p class="card-metrics">${fmtDuration(r.duration_s)}<small>${fmtKm(r.distance_m)}</small></p>
          <p class="card-vs">${esc(vsTextMinutes(r, fastest))}</p>
          <p class="card-cats">${cats.length ? 'Mais registrados: ' + esc(cats.join(', ')) : 'Poucos registros no trajeto'}</p>`;
        b.addEventListener('click', () => h.onSelect(r.id));
        li.appendChild(b);
        if (sel) li.appendChild(buildExtra(r, period));
        ul.appendChild(li);
      });
      if (focusId) ul.querySelector(`.card[data-id="${CSS.escape(focusId)}"]`)?.focus();
    },
    /** Rola o painel até as rotas (no celular elas ficam abaixo do formulário). */
    revealRoutes() {
      const body = $('panel-body'), sec = $('routes-section');
      body.scrollTop += sec.getBoundingClientRect().top - body.getBoundingClientRect().top - 8;
    },
    markSelected(id) { this.renderCards(lastRoutes, id, lastPeriod); },
    highlightStep(i) {
      document.querySelectorAll('.step').forEach((el) => {
        const on = Number(el.dataset.i) === i;
        el.classList.toggle('current', on);
        if (on) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
      });
      if (i >= 0) document.querySelector(`.step[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
    },
    snack, refreshRecents,
    setMode(m) { const r = document.querySelector(`input[name=mode][value="${m}"]`); if (r) r.checked = true; bikeNote(); },
    setPeriod(p) { if ([...$('period').options].some((o) => o.value === p)) $('period').value = p; },
    getInput: (kind) => ({ origin: originIn, dest: destIn, via: viaIn })[kind].value.trim(),
    setServerReady(r) { serverReady = r; syncCalc(); },
    /** state: 'waiting' | 'failed' | 'ok' */
    serverBanner(state) {
      $('server-banner').hidden = state === 'ok';
      $('server-banner').classList.toggle('failed', state === 'failed');
      $('server-retry').hidden = state !== 'failed';
      $('server-banner-text').textContent = state === 'failed'
        ? 'Não foi possível contatar o servidor.' : 'Acordando o servidor (pode levar até 2 min)…';
    },
  };

  function buildExtra(r, period) {
    const box = document.createElement('div');
    box.className = 'card-extra';
    const steps = Array.isArray(r.steps) ? r.steps : [];
    box.innerHTML = `<div class="card-actions">
        <button type="button" class="btn-sm primary-sm" data-act="nav">Iniciar navegação</button>
        <button type="button" class="btn-sm" data-act="share">Compartilhar</button>
        <button type="button" class="btn-sm" data-act="gpx">Baixar GPX</button>
      </div>${periodBlock(r, period)}${steps.length ? `<details class="steps"${stepsOpen ? ' open' : ''}>
        <summary>Passo a passo (${steps.length})</summary>
        <ol class="steps-list">${steps.map((s, i) => `<li><button type="button" class="step" data-i="${i}">
          <span class="step-icon">${maneuverIcon(s.maneuver, 22)}</span>
          <span class="step-text">${esc(s.instruction)}</span>
          <span class="step-dist">${s.distance_m > 0 ? fmtMeters(s.distance_m) : ''}</span></button></li>`).join('')}</ol>
      </details>` : ''}`;
    box.querySelector('[data-act=nav]').addEventListener('click', () => h.onStartNav());
    box.querySelector('[data-act=gpx]').addEventListener('click', () => h.onGpx(r));
    box.querySelector('[data-act=share]').addEventListener('click', () => h.onShare());
    box.querySelector('details')?.addEventListener('toggle', (e) => { stepsOpen = e.target.open; });
    box.querySelectorAll('.step').forEach((el) => el.addEventListener('click', () => h.onStep(steps[Number(el.dataset.i)], Number(el.dataset.i))));
    return box;
  }
}

function periodBlock(r, period) {
  const rows = periodRows(r, period);
  if (!rows.length) return '';
  return `<section class="periods" aria-label="Exposição por período"><h3>Exposição por período</h3><ul>${rows.map((p) => `
    <li class="period-row${p.current ? ' current' : ''}"${p.current ? ' aria-current="true"' : ''}>
      <span>${p.label}${p.current ? '<span class="visually-hidden"> (período atual)</span>' : ''}</span>
      <span class="period-bar" aria-hidden="true"><span style="width:${p.pct}%"></span></span>
      <span class="period-val"><b>${fmtExposure(p.value)}</b>${p.level ? esc(p.level) : ''}</span></li>`).join('')}</ul></section>`;
}
