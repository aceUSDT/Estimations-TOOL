/* Static integrity checks for the /download/ store pages.
 * No network, no browser. Run: node tools/coverage/test-store-static.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_BUILDS } from '../../netlify/functions/lib/release-store.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL  ${name}\n      ${err.message}`); }
}

const PAGES = [
  'download/index.html',
  'download/success/index.html',
  'download/restore/index.html',
  'download/legal/index.html',
];
const ALL_FILES = [...PAGES, 'download/store.css', 'download/store.js'];

test('all store files exist', () => {
  for (const f of ALL_FILES) assert.ok(existsSync(resolve(root, f)), `${f} missing`);
});

test('marketing screenshot referenced by the store page exists', () => {
  const html = read('download/index.html');
  const m = html.match(/src="\.\.\/(assets\/marketing\/[^"]+)"/);
  assert.ok(m, 'store page must embed a marketing image');
  assert.ok(existsSync(resolve(root, m[1])), `${m[1]} missing`);
});

test('no secrets or key material in any store file', () => {
  const bad = /sk_live|sk_test|whsec_|price_[A-Za-z0-9]{8,}|AKIA[A-Z0-9]{6,}|api[_-]?key\s*[:=]\s*['"][A-Za-z0-9]/i;
  for (const f of ALL_FILES) assert.ok(!bad.test(read(f)), `${f} contains secret-like content`);
});

test('front-end talks only to relative /api/ endpoints', () => {
  const js = read('download/store.js');
  const fetches = [...js.matchAll(/api\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(fetches.length >= 4, 'expected several api() calls');
  for (const url of fetches) assert.ok(url.startsWith('/api/'), `non-API fetch: ${url}`);
  assert.ok(!/fetch\(\s*['"]https?:/.test(js), 'absolute-URL fetch found in store.js');
});

test('no hardcoded provider hostnames in customer-facing pages', () => {
  const banned = /netlify\.app|workers\.dev|r2\.cloudflarestorage|github\.com|checkout\.stripe\.com/;
  for (const f of ALL_FILES) assert.ok(!banned.test(read(f)), `${f} leaks a provider hostname`);
});

test('store + success pages carry one card per supported build', () => {
  for (const f of ['download/index.html', 'download/success/index.html']) {
    const html = read(f);
    const cards = [...html.matchAll(/data-platform="([a-z]+)"\s+data-arch="([a-z0-9]+)"/g)]
      .map((m) => `${m[1]}-${m[2]}`).sort();
    const expected = SUPPORTED_BUILDS.map((b) => b.id).sort();
    assert.deepEqual(cards, expected, `${f} cards ≠ SUPPORTED_BUILDS`);
  }
});

test('every page links legal terms and loads shared css/js', () => {
  for (const f of PAGES) {
    const html = read(f);
    if (f !== 'download/legal/index.html') assert.ok(/legal\//.test(html), `${f} missing legal link`);
    assert.ok(/store\.css/.test(html), `${f} missing store.css`);
    assert.ok(/store\.js/.test(html), `${f} missing store.js`);
  }
});

test('success and restore pages are noindex (unique-URL pages)', () => {
  for (const f of ['download/success/index.html', 'download/restore/index.html']) {
    assert.ok(/name="robots" content="noindex"/.test(read(f)), `${f} missing noindex`);
  }
});

test('app header links to the store', () => {
  assert.ok(/href="\.\/download\/"/.test(read('index.html')), 'Get desktop app link missing from app');
});

test('store page shows a disabled/coming-soon state by default (buttons disabled in markup)', () => {
  const html = read('download/index.html');
  const buys = [...html.matchAll(/<button[^>]*data-buy[^>]*>/g)];
  assert.ok(buys.length >= 1);
  for (const b of buys) assert.ok(/disabled/.test(b[0]), 'buy buttons must start disabled until config says otherwise');
});

console.log(`\nstore static tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
