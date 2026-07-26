/* Shared Chromium harness for the end-to-end checks.
 *
 * Every CDN asset is served from local disk so the checks stay hermetic (the
 * sandbox proxy MITMs TLS, which Chromium rejects). Same files, same versions
 * as the deployed app. */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { COVERAGE_DIR } from './paths.mjs';

export const APP_URL = 'http://127.0.0.1:8765/?test=1';

const NODE_MODULES = path.join(COVERAGE_DIR, 'node_modules');
const VENDOR = path.join(COVERAGE_DIR, 'vendor');
const CDN_PATTERN = /https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|tessdata\.projectnaptha\.com)\/.*/;

const mime = (name) => name.endsWith('.wasm') ? 'application/wasm'
  : name.endsWith('.gz') ? 'application/gzip'
  : 'application/javascript';

function localAsset(base) {
  if (base === 'pdf.min.js' || base === 'pdf.worker.min.js') return path.join(VENDOR, base);
  if (base === 'tesseract.min.js') return path.join(NODE_MODULES, 'tesseract.js/dist/tesseract.min.js');
  if (base === 'worker.min.js') return path.join(NODE_MODULES, 'tesseract.js/dist/worker.min.js');
  if (base.startsWith('tesseract-core')) return path.join(NODE_MODULES, 'tesseract.js-core', base);
  if (base.endsWith('.traineddata.gz')) return path.join(VENDOR, 'eng.traineddata.gz');
  return null;
}

export async function routeVendoredCdn(page) {
  await page.route(CDN_PATTERN, async (route) => {
    const url = route.request().url();
    const base = url.split('?')[0].split('/').pop();
    const file = localAsset(base);
    if (file && fs.existsSync(file)) {
      await route.fulfill({ status: 200, contentType: mime(base), body: fs.readFileSync(file) });
    } else {
      console.log('[route] no local file for', url);
      await route.abort();
    }
  });
}

/* Launch Chromium with the CDN routes and error logging the checks rely on. */
export async function launchAppPage({ logConsoleErrors = false } = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await routeVendoredCdn(page);
  if (logConsoleErrors) {
    page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });
  }
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
  return { browser, ctx, page };
}

/* Open the app and create a fresh project (boot() seeds demo projects first). */
export async function openNewProject(page, name) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('typeof state !== "undefined"');
  await page.waitForSelector('.proj-card.new', { timeout: 30000 });
  await page.click('.proj-card.new');
  await page.fill('#mName', name);
  await page.click('#mOk');
  await page.waitForFunction(`state.cur && state.cur.name === ${JSON.stringify(name)}`);
}
