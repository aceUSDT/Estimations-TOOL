/* Browser test for the /download/ store: serves the real static pages with a
 * FAKE /api implementation and drives buy → success → download-link and the
 * restore flow in Chromium. No Stripe, no network beyond localhost.
 * Run: node tools/coverage/test-store-page.mjs   (needs playwright + chromium)
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 8791;

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };

/* Mutable fake-API state so one server covers both scenarios. */
const fake = {
  enabled: true,
  requests: [],
  price: { amount: 14900, currency: 'gbp', type: 'one_time' },
};

const CONFIG = () => ({
  commerceEnabled: fake.enabled,
  product: { name: 'Estimation Tools', builds: [] },
  supportEmail: 'support@example.test',
  sellerName: 'Example Ltd',
  ...(fake.enabled ? { price: fake.price } : { reason: 'coming-soon' }),
});

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const sendJson = (status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  fake.requests.push(`${req.method} ${url.pathname}`);

  if (url.pathname === '/api/store-config') return sendJson(200, CONFIG());
  if (url.pathname === '/api/create-checkout-session' && req.method === 'POST') {
    // Simulate Stripe: jump straight to the success URL with a session id.
    return sendJson(200, { url: `http://127.0.0.1:${PORT}/download/success/?session_id=cs_test_paid123` });
  }
  if (url.pathname === '/api/checkout-status') {
    if (url.searchParams.get('session_id') !== 'cs_test_paid123') return sendJson(404, { error: 'unknown session' });
    return sendJson(200, { status: 'paid', downloadsReady: true }, { 'set-cookie': 'fake_dl=1; Path=/' });
  }
  if (url.pathname === '/api/download-link' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const { platform, arch } = JSON.parse(body || '{}');
      if (!(req.headers.cookie || '').includes('fake_dl=1')) return sendJson(401, { error: 'no session' });
      if (platform === 'linux') return sendJson(400, { error: 'unknown platform/arch' });
      return sendJson(200, {
        url: `http://127.0.0.1:${PORT}/fake-artifact/${platform}-${arch}.bin`,
        fileName: `Estimation-Tools-1.2.0-${platform}-${arch}.bin`,
        version: '1.2.0', size: 52428800, sha256: 'f'.repeat(64), signed: true,
        minimumOs: 'test', expiresIn: 300,
      });
    });
    return undefined;
  }
  if (url.pathname === '/api/request-download-link' && req.method === 'POST') {
    return sendJson(200, { ok: true, message: 'If that email bought a licence, a download link is on its way.' });
  }
  if (url.pathname.startsWith('/fake-artifact/')) {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    return res.end('fake');
  }

  // static files
  let file = join(root, decodeURIComponent(url.pathname));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  return res.end(readFileSync(file));
});

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL  ${name}\n      ${err.message}`); }
}

const { chromium } = await import(resolve(root, 'node_modules/playwright/index.mjs'));
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });

const shots = process.env.STORE_SHOTS_DIR || '';

try {
  await test('disabled commerce ⇒ coming-soon store, buy buttons stay disabled', async () => {
    fake.enabled = false;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://127.0.0.1:${PORT}/download/`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('[data-price]').first().textContent(), 'Coming soon');
    assert.equal(await page.locator('[data-buy]').first().isDisabled(), true);
    await page.close();
  });

  await test('enabled commerce ⇒ server price renders and buy → checkout → success → paid', async () => {
    fake.enabled = true;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://127.0.0.1:${PORT}/download/`, { waitUntil: 'networkidle' });
    const price = await page.locator('[data-price]').first().textContent();
    assert.ok(/149/.test(price), `price should render 149.00, got "${price}"`);
    assert.ok((await page.locator('footer [data-seller]').textContent()).includes('Example Ltd'));
    if (shots) await page.screenshot({ path: `${shots}/store-1440.png`, fullPage: true });

    await page.locator('.hero [data-buy]').click();
    await page.waitForURL('**/download/success/**');
    await page.locator('#readyState:not(.hidden)').waitFor({ timeout: 15000 });
    assert.ok((await page.locator('.note.green').textContent()).includes('Payment confirmed'));
    if (shots) await page.screenshot({ path: `${shots}/success-1440.png`, fullPage: true });

    // download button → POST /api/download-link → sha-256 surfaced → file fetched
    const before = fake.requests.length;
    await page.locator('.dl-card[data-platform="windows"][data-arch="x64"] [data-download]').click();
    await page.waitForRequest('**/fake-artifact/windows-x64.bin', { timeout: 10000 });
    const meta = await page.locator('.dl-card[data-platform="windows"][data-arch="x64"] .meta').textContent();
    assert.ok(meta.includes('SHA-256'), 'card must show the file hash');
    assert.ok(meta.includes('50.0 MB'), 'card must show the size');
    assert.ok(fake.requests.slice(before).includes('POST /api/download-link'));
    await page.close();
  });

  await test('restore page posts email and shows the neutral confirmation', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`http://127.0.0.1:${PORT}/download/restore/`, { waitUntil: 'networkidle' });
    await page.fill('#email', 'buyer@example.test');
    await page.locator('#restoreForm button[type=submit]').click();
    await page.locator('#restoreDone:not(.hidden)').waitFor({ timeout: 5000 });
    const msg = await page.locator('#restoreDone').textContent();
    assert.ok(msg.includes('If that email bought a licence'));
    if (shots) await page.screenshot({ path: `${shots}/restore-390.png`, fullPage: true });
    await page.close();
  });

  await test('store page is responsive at 390×844 (no horizontal scroll)', async () => {
    fake.enabled = true;
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`http://127.0.0.1:${PORT}/download/`, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `horizontal overflow of ${overflow}px`);
    if (shots) await page.screenshot({ path: `${shots}/store-390.png`, fullPage: true });
    await page.close();
  });
} finally {
  await browser.close();
  server.close();
}

console.log(`\nstore page tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
