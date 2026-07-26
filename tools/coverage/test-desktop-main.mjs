/* Regression test: the desktop shell's security boundaries (desktop/main.cjs).
 *
 * Electron is stubbed, so this runs in plain node: what is pinned here is the
 * private `estimation://app` protocol handler (path traversal, MIME types, the
 * HTML content-security policy, missing/unreadable assets) and the navigation
 * guard that keeps the packaged app off the open web.
 */
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.resolve(HERE, '../../desktop/main.cjs');
const REPO = path.resolve(HERE, '../..');
const require = Module.createRequire(import.meta.url);

/* minimal Electron surface: main.cjs only registers handlers at load time */
const noop = () => {};
const electron = {
  app: { setName: noop, setAppUserModelId: noop, on: noop, quit: noop, isPackaged: false, whenReady: () => new Promise(() => {}) },
  BrowserWindow: Object.assign(function BrowserWindow() {}, { getAllWindows: () => [] }),
  Menu: { setApplicationMenu: noop, buildFromTemplate: (t) => t },
  protocol: { registerSchemesAsPrivileged: noop, handle: async () => {} },
  shell: { openExternal: noop },
  session: { defaultSession: { setPermissionRequestHandler: noop } },
};
const load = Module._load;
Module._load = function stubbedLoad(request, ...rest) {
  return request === 'electron' ? electron : load.call(this, request, ...rest);
};
const loadMain = () => { delete require.cache[require.resolve(MAIN)]; return require(MAIN); };

let fail = 0;
const check = (name, cond, detail) => {
  if (!cond) { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); fail++; }
};

delete process.env.ESTIMATION_DEV_URL;
let main = loadMain();

/* ---------- localDevelopmentUrl ------------------------------------------ */
check('dev url: loopback http accepted', main.localDevelopmentUrl('http://127.0.0.1:8765/') === 'http://127.0.0.1:8765/');
check('dev url: localhost accepted', main.localDevelopmentUrl('http://localhost:8765/').startsWith('http://localhost:8765'));
check('dev url: remote host rejected', main.localDevelopmentUrl('http://example.com/') === '');
check('dev url: non-http scheme rejected', main.localDevelopmentUrl('file:///etc/passwd') === '');
check('dev url: unset and malformed values rejected', main.localDevelopmentUrl('') === '' && main.localDevelopmentUrl('not a url') === '');

/* ---------- safeAssetPath ------------------------------------------------ */
check('assets: unpackaged root is the repo', main.webRoot() === REPO);
check('assets: root maps to index.html', main.safeAssetPath('estimation://app/') === path.join(REPO, 'index.html'));
check('assets: nested asset resolved under the root', main.safeAssetPath('estimation://app/vendor/pdf.mjs') === path.join(REPO, 'vendor/pdf.mjs'));
check('assets: percent-encoded path decoded', main.safeAssetPath('estimation://app/assets/a%20b.png') === path.join(REPO, 'assets/a b.png'));
check('assets: dot-segments are normalised inside the root', main.safeAssetPath('estimation://app/../../etc/passwd') === path.join(REPO, 'etc/passwd'));
check('assets: encoded traversal escaping the root refused', main.safeAssetPath('estimation://app/x/%2e%2e%2f%2e%2e%2fetc/passwd') === null);
check('assets: encoded absolute path refused', main.safeAssetPath('estimation://app/%2e%2e%2f%2e%2e%2f%2e%2e%2ftmp') === null);
check('assets: another host on the private scheme refused', main.safeAssetPath('estimation://evil/index.html') === null);
check('assets: foreign scheme refused', main.safeAssetPath('https://app/index.html') === null);

/* ---------- handleAppRequest --------------------------------------------- */
let res = await main.handleAppRequest({ url: 'estimation://app/index.html' });
let body = await res.text();
check('serve: index.html served', res.status === 200 && body.includes('<html'));
check('serve: html content-type', res.headers.get('content-type') === 'text/html; charset=utf-8');
const csp = res.headers.get('content-security-policy') || '';
check('serve: html carries a CSP', csp.includes("default-src 'self' data: blob:") && csp.includes("object-src 'none'") && csp.includes("frame-ancestors 'none'"));
check('serve: assets are not cached across builds', res.headers.get('cache-control') === 'no-cache');

res = await main.handleAppRequest({ url: 'estimation://app/report-core.js' });
check('serve: js content-type', res.status === 200 && res.headers.get('content-type') === 'application/javascript; charset=utf-8');
check('serve: non-html responses carry no CSP header', res.headers.get('content-security-policy') === null);

res = await main.handleAppRequest({ url: 'estimation://app/package-lock.json' });
check('serve: json content-type', res.headers.get('content-type') === 'application/json; charset=utf-8');

res = await main.handleAppRequest({ url: 'estimation://app/netlify.toml' });
check('serve: unknown extension falls back to octet-stream', res.headers.get('content-type') === 'application/octet-stream');

res = await main.handleAppRequest({ url: 'estimation://app/x/%2e%2e%2f%2e%2e%2fetc/passwd' });
check('serve: refused path → 404', res.status === 404);

res = await main.handleAppRequest({ url: 'estimation://app/does-not-exist.js' });
check('serve: missing asset → 404', res.status === 404 && (await res.text()) === 'Not found');

res = await main.handleAppRequest({ url: 'estimation://app/vendor' });
check('serve: unreadable asset (a directory) → 500', res.status === 500 && (await res.text()).includes('Could not read'));

/* ---------- allowedNavigation -------------------------------------------- */
check('navigation: in-app url allowed', main.allowedNavigation('estimation://app/index.html') === true);
check('navigation: other host on the private scheme blocked', main.allowedNavigation('estimation://evil/index.html') === false);
check('navigation: external http blocked without a dev url', main.allowedNavigation('https://example.com/') === false);
check('navigation: malformed url blocked', main.allowedNavigation('::::') === false);

process.env.ESTIMATION_DEV_URL = 'http://127.0.0.1:8765/';
main = loadMain();
check('navigation: dev origin allowed when ESTIMATION_DEV_URL is set', main.allowedNavigation('http://127.0.0.1:8765/index.html') === true);
check('navigation: a different dev port is still blocked', main.allowedNavigation('http://127.0.0.1:9999/index.html') === false);
check('navigation: external http blocked with a dev url set', main.allowedNavigation('https://example.com/') === false);

process.env.ESTIMATION_DEV_URL = 'https://example.com/';
main = loadMain();
check('navigation: a remote ESTIMATION_DEV_URL is ignored', main.allowedNavigation('https://example.com/') === false);
delete process.env.ESTIMATION_DEV_URL;

Module._load = load;
if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('PASS: desktop asset protocol, CSP, and navigation guard.');
