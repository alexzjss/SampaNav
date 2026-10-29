// Captura os screenshots do README contra a UI real (API de produção local).
// Uso: node tools/screenshots/capture.mjs
// Env:
//   BASE_URL     URL do app            (padrão http://127.0.0.1:8000)
//   OUT_DIR      saída bruta           (padrão tools/screenshots/.cache/raw)
//   BASEMAP      streets.geojson de basemap.py (padrão .cache/streets.geojson); BASEMAP=real usa os tiles reais
//   VENDOR_DIR   pasta com maplibre-gl-4.7.1/package e h3-js-4.1.0/package (sem acesso ao unpkg)
//   ONLY         lista de cenas separada por vírgula (ex.: hero,dark)
import { createRequire } from 'node:module';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { basemapStyle } from './basemap-style.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const OUT = process.env.OUT_DIR || path.join(HERE, '.cache/raw');
const VENDOR = process.env.VENDOR_DIR;
const BASEMAP = process.env.BASEMAP || path.join(HERE, '.cache/streets.geojson');
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;

const SE = { lat: -23.5503, lon: -46.6339, name: 'Praça da Sé' };
const MASP = { lat: -23.5614, lon: -46.6559, name: 'MASP' };
const PINHEIROS = { lat: -23.5670, lon: -46.6930, name: 'Largo da Batata' };
const IBIRA = { lat: -23.5874, lon: -46.6576, name: 'Parque Ibirapuera' };

// Sé -> MASP só devolve as 3 rotas (rápida/equilibrada/segura) em 'madrugada' nos dados atuais
const HERO_PERIOD = process.env.HERO_PERIOD || 'madrugada';
const q = (o, d, m, p = HERO_PERIOD, extra = '') =>
  `/?o=${o.lat},${o.lon}&d=${d.lat},${d.lon}&m=${m}&p=${p}&on=${encodeURIComponent(o.name)}&dn=${encodeURIComponent(d.name)}${extra}`;

const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const geojson = BASEMAP !== 'real' ? JSON.parse(await readFile(BASEMAP, 'utf8')) : null;

async function setup(context, scheme) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.error('pageerror:', e.message); });
  if (process.env.DEBUG_CAP) page.on('console', (m) => console.error('console:', m.text()));
  // expõe a instância do mapa para esperar o 'idle' (o app não expõe nada)
  await page.addInitScript(() => {
    let lib;
    Object.defineProperty(window, 'maplibregl', {
      configurable: true,
      get: () => lib,
      set(v) {
        lib = v;
        const Base = v.Map;
        v.Map = class extends Base { constructor(o) { super(o); window.__map = this; } };
      },
    });
  });
  if (VENDOR) {
    const serve = (route, p, type) => readFile(path.join(VENDOR, p)).then((body) => route.fulfill({ body, contentType: type }));
    await page.route('https://unpkg.com/maplibre-gl@4.7.1/**', (r) => {
      const f = r.request().url().split('/dist/')[1];
      return serve(r, `maplibre-gl-4.7.1/package/dist/${f}`, f.endsWith('.css') ? 'text/css' : 'text/javascript');
    });
    await page.route('https://unpkg.com/h3-js@4.1.0/**', (r) => serve(r, 'h3-js-4.1.0/package/dist/h3-js.umd.js', 'text/javascript'));
  }
  if (geojson) {
    await page.route('https://tiles.openfreemap.org/styles/**', (r) => r.fulfill({ json: basemapStyle(geojson, scheme) }));
    await page.route(/tiles\.openfreemap\.org\/(?!styles\/)/, (r) => r.fulfill({ status: 404, body: '' }));
  }
  await page.route(/photon\.komoot\.io/, (r) => r.fulfill({ json: { features: [] } }));
  return { page, errors };
}

/** Espera o mapa parar (sem animação, estilo e tiles carregados) por alguns frames seguidos. */
async function settle(page, ms = 700) {
  if (process.env.DEBUG_CAP) console.error('map', await page.evaluate(() => window.__map && ({ loaded: window.__map.loaded(), moving: window.__map.isMoving(), style: window.__map.isStyleLoaded(), tiles: window.__map.areTilesLoaded() })));
  await page.waitForFunction(() => window.__map && window.__map.loaded() && !window.__map.isMoving(), null, { timeout: 30000 });
  await page.waitForTimeout(ms);
  await page.waitForFunction(() => window.__map.loaded() && !window.__map.isMoving(), null, { timeout: 30000 });
}

async function open(browser, opts, url, scheme = 'light') {
  const context = await browser.newContext({ ...opts, serviceWorkers: 'block', colorScheme: scheme, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const { page, errors } = await setup(context, scheme);
  await page.goto(BASE + url, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.getElementById('calc').disabled, null, { timeout: 180000 });
  await page.locator('#route-cards .card').first().waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('#route-cards .card').length >= 2, null, { timeout: 30000 })
    .catch(async (e) => { console.error('status:', await page.locator('#status').innerText(), await page.locator('#error').innerText(), await page.locator('#route-cards .card').count()); throw e; });
  await settle(page);
  return { context, page, errors };
}

// .map-toast: avisos transitórios fora da foto. contain:paint: contorna um artefato do Chromium headless
// (faixa em branco sobre o canvas do mapa no layout de celular, causado pelo scroller do painel).
const clean = (page) => page.addStyleTag({ content: '.map-toast{display:none!important}.panel-body{contain:paint}' });

const scenes = {
  async hero(browser, scheme = 'light', name = 'hero-desktop') {
    const { context, page } = await open(browser, DESKTOP, q(SE, MASP, 'walk'), scheme);
    await expandCard(page);
    await settle(page, 300);
    await shot(page, name);
    await context.close();
  },
  async dark(browser) { await scenes.hero(browser, 'dark', 'dark'); },
  async heatmap(browser) {
    const { context, page } = await open(browser, DESKTOP, q(SE, MASP, 'walk'));
    await page.evaluate(() => window.__map.jumpTo({ center: [-46.645, -23.552], zoom: 13.2 }));
    await page.locator('#heat-toggle').check({ force: true });
    await page.waitForFunction(() => document.getElementById('map-loading').hidden, null, { timeout: 30000 });
    await page.waitForTimeout(800);
    await settle(page, 600);
    // painel rolado até o fim: interruptor e legenda do mapa de risco
    await page.evaluate(() => { const b = document.querySelector('#panel-body'); b.scrollTop = b.scrollHeight; });
    await shot(page, 'heatmap');
    await context.close();
  },
  async mobile(browser) {
    const { context, page } = await open(browser, MOBILE, q(SE, MASP, 'walk'));
    await shot(page, 'mobile');
    await context.close();
  },
  async bike(browser) {
    const { context, page } = await open(browser, DESKTOP, q(PINHEIROS, IBIRA, 'bike', 'noite'));
    await expandCard(page);
    // painel rolado até a nota de bicicleta (modo Bike, período e primeiros cartões)
    await page.evaluate(() => {
      const body = document.querySelector('#panel-body');
      body.scrollTop += document.querySelector('#bike-note').getBoundingClientRect().top - body.getBoundingClientRect().top - 6;
    });
    await settle(page, 300);
    await shot(page, 'bike');
    await context.close();
  },
  async navigation(browser) {
    const { context, page } = await open(browser, MOBILE, q(SE, MASP, 'walk', HERO_PERIOD, '&simgps=1'));
    await startNav(page);
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.__simgps.speed = 10; }); // avança um pouco além da saída
    await page.waitForTimeout(5000);
    await page.evaluate(() => { window.__simgps.paused = true; }); // congela para o mapa assentar
    await page.waitForTimeout(1800);
    await shot(page, 'navigation');
    await context.close();
  },
  async about(browser) {
    const { context, page } = await open(browser, DESKTOP, q(SE, MASP, 'walk'));
    await page.click('#about-open');
    await page.locator('#about-dialog[open]').waitFor();
    await page.waitForFunction(() => !/carregando/.test(document.getElementById('about-range').textContent), null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, 'about');
    await context.close();
  },
  async gif(browser) {
    const dir = path.join(OUT, 'video');
    await rm(dir, { recursive: true, force: true });
    const context = await browser.newContext({ ...MOBILE, serviceWorkers: 'block', deviceScaleFactor: 1, colorScheme: 'light', locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo', recordVideo: { dir, size: { width: 390, height: 844 } } });
    const { page } = await setup(context, 'light');
    const t0 = Date.now();
    await page.goto(BASE + q(SE, MASP, 'walk', HERO_PERIOD, '&simgps=1'), { waitUntil: 'load' });
    await page.waitForFunction(() => !document.getElementById('calc').disabled, null, { timeout: 180000 });
    await page.locator('#route-cards .card').first().waitFor({ timeout: 60000 });
    await settle(page, 500);
    await clean(page);
    await startNav(page);
    const start = (Date.now() - t0) / 1000;
    await page.waitForTimeout(1500);
    await page.evaluate(() => { if (window.__simgps) window.__simgps.speed = 30; });
    await page.waitForTimeout(8500);
    const video = page.video();
    await context.close();
    const file = await video.path();
    await mkdir(OUT, { recursive: true });
    const { copyFile, writeFile } = await import('node:fs/promises');
    await copyFile(file, path.join(OUT, 'navigation.webm'));
    await writeFile(path.join(OUT, 'navigation.start'), String(start.toFixed(2)));
  },
};

async function expandCard(page) {
  // o cartão selecionado já mostra "Exposição por período"; garante que está visível no painel
  await page.locator('.periods').first().waitFor({ timeout: 10000 });
  // rola o painel até a seção "Rotas": cartões (com o selecionado expandido) logo abaixo do cabeçalho
  await page.evaluate(() => {
    const body = document.querySelector('#panel-body');
    const top = document.querySelector('#routes-section').getBoundingClientRect().top - body.getBoundingClientRect().top;
    body.scrollTop += top - 6;
  });
}

async function startNav(page) {
  await page.locator('[data-act=nav]').scrollIntoViewIfNeeded();
  await page.click('[data-act=nav]');
  await page.locator('#nav-banner:not([hidden])').waitFor({ timeout: 15000 });
}

async function shot(page, name) {
  await clean(page);
  await page.evaluate(() => {
    document.activeElement?.blur();
    // foco/scrollIntoView podem rolar o documento (overflow:hidden) e deixar uma faixa em branco no topo
    for (const el of [document.scrollingElement, document.body, document.querySelector('.app'), document.querySelector('.map-wrap')]) if (el) { el.scrollTop = 0; el.scrollLeft = 0; }
  });
  await mkdir(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('ok', name);
}

const browser = await chromium.launch();
if (process.env.DEBUG_CAP) browser.on("disconnected", () => {});
let failed = false;
try {
  for (const [name, fn] of Object.entries(scenes)) {
    if (ONLY && !ONLY.has(name)) continue;
    try { await fn(browser); } catch (e) { failed = true; console.error(`FALHOU ${name}: ${e.message.split('\n')[0]}`); }
  }
} finally { await browser.close(); }
process.exit(failed ? 1 : 0);
