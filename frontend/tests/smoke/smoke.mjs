// Smoke test no modo mock (?mock=1): carrega a página, escolhe origem/destino pelo
// autocomplete e confere os cartões de rota. Usa a lib `playwright` direta (sem runner).
// Uso: python3 -m http.server 8000 --directory frontend & node frontend/tests/smoke/smoke.mjs
// Env: SMOKE_URL (padrão http://localhost:8000/?mock=1)
//      SMOKE_VENDOR_DIR: sem acesso a unpkg/tiles, serve maplibre-gl e h3-js locais
//      (pastas maplibre-gl-4.7.1/package e h3-js-4.1.0/package, como saem do `npm pack`).
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const URL_ = process.env.SMOKE_URL || 'http://localhost:8000/?mock=1';
const VENDOR = process.env.SMOKE_VENDOR_DIR;

let failed = false;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed = true; };

const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  if (VENDOR) {
    const file = (p) => path.join(VENDOR, p);
    const serve = (route, p, type) => readFile(file(p)).then((body) => route.fulfill({ body, contentType: type }));
    await page.route('https://unpkg.com/maplibre-gl@4.7.1/**', (r) => {
      const f = r.request().url().split('/dist/')[1];
      return serve(r, `maplibre-gl-4.7.1/package/dist/${f}`, f.endsWith('.css') ? 'text/css' : 'text/javascript');
    });
    await page.route('https://unpkg.com/h3-js@4.1.0/**', (r) => serve(r, 'h3-js-4.1.0/package/dist/h3-js.umd.js', 'text/javascript'));
    // estilo vazio: o mapa dispara 'load' sem depender dos tiles
    await page.route('https://tiles.openfreemap.org/**', (r) => r.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  }

  await page.goto(URL_, { waitUntil: 'load' });
  check((await page.title()) === 'SampaNav', 'título da página');

  // health do mock libera o botão
  await page.waitForFunction(() => !document.getElementById('calc').disabled, null, { timeout: 15000 });
  check(true, 'botão "Calcular rotas" habilitado');

  async function pick(inputId, text) {
    await page.fill(`#${inputId}`, text);
    const opt = page.locator(`#${inputId.replace('-input', '-list')} li[role=option]`).first();
    await opt.waitFor({ timeout: 10000 });
    await opt.click();
  }
  await pick('origin-input', 'Catedral');
  await pick('dest-input', 'Paulista');

  await page.click('#calc');
  const cards = page.locator('#route-cards .card');
  await cards.first().waitFor({ timeout: 15000 });
  const n = await cards.count();
  check(n === 3, `3 cartões de rota (obtido ${n})`);
  check(await page.locator('#routes-section').isVisible(), 'seção de rotas visível');
  check((await page.locator('#error').isHidden()), 'sem mensagem de erro');
  check(/rotas encontradas/.test(await page.locator('#status').innerText()), 'status "rotas encontradas"');
  check(new URL(page.url()).searchParams.has('o'), 'URL compartilhável atualizada (?o=…)');

  check(errors.length === 0, `sem erros no console${errors.length ? ':\n  ' + errors.join('\n  ') : ''}`);
} catch (e) {
  console.error(`FAIL ${e.message.split('\n')[0]}`);
  errors.forEach((x) => console.error(`  ${x}`));
  failed = true;
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
