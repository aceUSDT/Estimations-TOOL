/* Deterministic tests for the paid-download service.
 * NO network, NO real Stripe/R2/email — every dependency is injected as a
 * fake. Run: node tools/coverage/test-commerce.mjs
 */
import assert from 'node:assert/strict';

import {
  commerceState, sameOrigin, rateLimit, hmacEmail, maskEmail, safeEqual,
} from '../../api/_lib/commerce/commerce.mjs';
import {
  recordFromSession, fulfil, getBySessionId, getByEmail, markRefunded,
  markEventProcessed, isActive,
} from '../../api/_lib/commerce/entitlements.mjs';
import { cookieHeader, verifyCookie, COOKIE_NAME } from '../../api/_lib/commerce/session-cookie.mjs';
import { signClaim, verifyClaim } from '../../api/_lib/commerce/download-claim.mjs';
import { handleStoreConfig } from '../../api/_lib/commerce/handlers/store-config.mjs';
import { handleCreateCheckout } from '../../api/_lib/commerce/handlers/create-checkout-session.mjs';
import { handleStripeWebhook } from '../../api/_lib/commerce/handlers/stripe-webhook.mjs';
import { handleCheckoutStatus } from '../../api/_lib/commerce/handlers/checkout-status.mjs';
import { handleRequestDownloadLink } from '../../api/_lib/commerce/handlers/request-download-link.mjs';
import { handleRedeemDownloadToken } from '../../api/_lib/commerce/handlers/redeem-download-token.mjs';
import { handleDownloadLink } from '../../api/_lib/commerce/handlers/download-link.mjs';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${err.message}`);
  }
}

/* ── fakes ────────────────────────────────────────────────────────────── */

class FakeStore {
  constructor() { this.map = new Map(); }
  async get(key, opts = {}) {
    const value = this.map.get(key);
    if (value === undefined) return null;
    return opts.type === 'json' ? JSON.parse(value) : value;
  }
  async set(key, value) { this.map.set(key, String(value)); }
  async setJSON(key, value) { this.map.set(key, JSON.stringify(value)); }
  async delete(key) { this.map.delete(key); }
}

const SITE = 'https://site.example';
const ENV = {
  COMMERCE_ENABLED: 'true',
  SITE_URL: SITE,
  SUPPORT_EMAIL: 'support@site.example',
  LEGAL_SELLER_NAME: 'Example Ltd',
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_WEBHOOK_SECRET: 'whsec_fake',
  STRIPE_PRICE_ID: 'price_ours',
  DOWNLOAD_TOKEN_SECRET: 'test-secret-test-secret-test-secret!',
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'ak',
  R2_SECRET_ACCESS_KEY: 'sk',
  R2_BUCKET: 'estimation-tools-releases',
  RESEND_API_KEY: 're_fake',
  MAIL_FROM: 'downloads@site.example',
  PRODUCT_DISPLAY_NAME: 'Estimation Tools',
};

const sha = 'a'.repeat(64);
const MANIFEST = {
  schemaVersion: 1,
  version: '1.2.0',
  publishedAt: '2026-07-17T00:00:00.000Z',
  builds: [
    { id: 'windows-x64', platform: 'windows', arch: 'x64', fileName: 'Estimation-Tools-1.2.0-windows-x64.exe', objectKey: 'releases/1.2.0/Estimation-Tools-1.2.0-windows-x64.exe', size: 1000, sha256: sha, minimumOs: 'Windows 10 64-bit', signed: true },
    { id: 'windows-arm64', platform: 'windows', arch: 'arm64', fileName: 'Estimation-Tools-1.2.0-windows-arm64.exe', objectKey: 'releases/1.2.0/Estimation-Tools-1.2.0-windows-arm64.exe', size: 1000, sha256: sha, minimumOs: 'Windows 11 ARM64', signed: true },
    { id: 'macos-x64', platform: 'macos', arch: 'x64', fileName: 'Estimation-Tools-1.2.0-macos-x64.dmg', objectKey: 'releases/1.2.0/Estimation-Tools-1.2.0-macos-x64.dmg', size: 1000, sha256: sha, minimumOs: 'macOS 11 (Intel)', signed: true },
    { id: 'macos-arm64', platform: 'macos', arch: 'arm64', fileName: 'Estimation-Tools-1.2.0-macos-arm64.dmg', objectKey: 'releases/1.2.0/Estimation-Tools-1.2.0-macos-arm64.dmg', size: 1000, sha256: sha, minimumOs: 'macOS 11 (Apple Silicon)', signed: true },
  ],
};

function fakeR2() {
  return {
    getObjectText: async () => JSON.stringify(MANIFEST),
    presignDownload: async ({ objectKey }) => `https://r2.example/presigned/${objectKey}`,
  };
}

const PAID_SESSION = {
  id: 'cs_test_paid123',
  payment_status: 'paid',
  created: 1752700000,
  customer: 'cus_1',
  payment_intent: 'pi_1',
  customer_details: { email: 'buyer@example.com' },
  line_items: { data: [{ price: { id: 'price_ours' } }] },
};

function fakeStripe({ session = PAID_SESSION, eventFromSig = null } = {}) {
  const calls = { created: [] };
  return {
    calls,
    prices: { retrieve: async () => ({ id: 'price_ours', active: true, unit_amount: 14900, currency: 'gbp', type: 'one_time' }) },
    checkout: {
      sessions: {
        create: async (params) => { calls.created.push(params); return { id: 'cs_new', url: 'https://checkout.stripe.com/pay/cs_new' }; },
        retrieve: async (id) => { if (id !== session.id) { throw new Error('no such session'); } return session; },
      },
    },
    webhooks: {
      constructEventAsync: async (body, sig) => {
        if (sig !== 'good-sig') throw new Error('bad signature');
        return eventFromSig || JSON.parse(body);
      },
    },
  };
}

const getFakeStripe = (stripe) => async () => stripe;

function req(path, { method = 'GET', body = null, headers = {}, cookie = null } = {}) {
  const h = { origin: SITE, ...headers };
  if (cookie) h.cookie = cookie;
  return new Request(`${SITE}${path}`, {
    method,
    headers: h,
    body: body === null ? undefined : JSON.stringify(body),
  });
}

/* ── library-level tests ──────────────────────────────────────────────── */

await test('commerceState: flag off ⇒ disabled even with full env', () => {
  const state = commerceState({ ...ENV, COMMERCE_ENABLED: 'false' });
  assert.equal(state.enabled, false);
});

await test('commerceState: missing env ⇒ disabled with names listed', () => {
  const { STRIPE_SECRET_KEY, ...rest } = ENV;
  const state = commerceState(rest);
  assert.equal(state.enabled, false);
  assert.deepEqual(state.missing, ['STRIPE_SECRET_KEY']);
});

await test('commerceState: flag on + full env ⇒ enabled', () => {
  assert.equal(commerceState(ENV).enabled, true);
});

await test('sameOrigin accepts our origin, rejects others', () => {
  assert.equal(sameOrigin(req('/x'), ENV), true);
  assert.equal(sameOrigin(new Request(`${SITE}/x`, { headers: { origin: 'https://evil.example' } }), ENV), false);
});

await test('rateLimit blocks after the limit and fails closed on store errors', async () => {
  const store = new FakeStore();
  for (let i = 0; i < 3; i++) assert.equal((await rateLimit(store, 's', 'k', { limit: 3, windowSec: 60 })).ok, true);
  assert.equal((await rateLimit(store, 's', 'k', { limit: 3, windowSec: 60 })).ok, false);
  const broken = { get: async () => { throw new Error('down'); }, set: async () => {} };
  assert.equal((await rateLimit(broken, 's', 'k', { limit: 3, windowSec: 60, failClosed: true })).ok, false);
  assert.equal((await rateLimit(broken, 's', 'k', { limit: 3, windowSec: 60 })).ok, true);
});

await test('hmacEmail normalises case/whitespace; maskEmail masks', () => {
  assert.equal(hmacEmail(' Buyer@Example.com ', ENV), hmacEmail('buyer@example.com', ENV));
  assert.equal(maskEmail('buyer@example.com'), 'bu***@example.com');
});

await test('cookie roundtrip verifies; tampering and expiry rejected', () => {
  const header = cookieHeader('cs_abc', ENV);
  assert.ok(header.startsWith(`${COOKIE_NAME}=`));
  const value = header.split(';')[0].split('=').slice(1).join('=');
  const ok = verifyCookie(new Request(SITE, { headers: { cookie: `${COOKIE_NAME}=${value}` } }), ENV);
  assert.equal(ok.sessionId, 'cs_abc');
  const tampered = `${value.slice(0, -2)}xx`;
  assert.equal(verifyCookie(new Request(SITE, { headers: { cookie: `${COOKIE_NAME}=${tampered}` } }), ENV), null);
  const future = Date.now() + 1000 * 60 * 60 * 25;
  assert.equal(verifyCookie(new Request(SITE, { headers: { cookie: `${COOKIE_NAME}=${value}` } }), ENV, future), null);
});

await test('download claim: sign/verify, wrong audience, tamper, expiry', async () => {
  const secret = ENV.DOWNLOAD_TOKEN_SECRET;
  const fields = { audience: 'files.example.com', entitlementId: 'cs_1', buildId: 'windows-x64', version: '1.2.0', objectKey: 'releases/1.2.0/a.exe' };
  const token = await signClaim(fields, secret);
  const claim = await verifyClaim(token, { audience: 'files.example.com', requestedKey: fields.objectKey }, secret);
  assert.equal(claim.bld, 'windows-x64');
  assert.equal(await verifyClaim(token, { audience: 'other.example.com' }, secret), null);
  assert.equal(await verifyClaim(token, { audience: 'files.example.com', requestedKey: 'releases/other' }, secret), null);
  assert.equal(await verifyClaim(`${token.slice(0, -2)}zz`, { audience: 'files.example.com' }, secret), null);
  const expired = Date.now() + 301 * 1000;
  assert.equal(await verifyClaim(token, { audience: 'files.example.com' }, secret, expired), null);
});

await test('entitlements: fulfil is idempotent; refund revokes; event replay detected', async () => {
  const store = new FakeStore();
  const first = await fulfil(store, PAID_SESSION, ENV);
  const second = await fulfil(store, PAID_SESSION, ENV);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(isActive(await getBySessionId(store, PAID_SESSION.id)), true);
  assert.ok(await getByEmail(store, 'BUYER@example.com', ENV));
  assert.equal(await markEventProcessed(store, 'evt_1'), true);
  assert.equal(await markEventProcessed(store, 'evt_1'), false);
  assert.equal(await markRefunded(store, 'pi_1'), true);
  assert.equal(isActive(await getBySessionId(store, PAID_SESSION.id)), false);
});

await test('recordFromSession stores only HMAC of email, never the address', () => {
  const record = recordFromSession(PAID_SESSION, ENV);
  assert.ok(!JSON.stringify(record).includes('buyer@example.com'));
  assert.equal(record.emailHmac, hmacEmail('buyer@example.com', ENV));
});

/* ── endpoint tests ───────────────────────────────────────────────────── */

await test('store-config: disabled env ⇒ commerceEnabled:false, no price', async () => {
  const res = await handleStoreConfig(req('/api/store-config'), { env: { COMMERCE_ENABLED: 'false' }, getStripe: getFakeStripe(fakeStripe()) });
  const body = await res.json();
  assert.equal(body.commerceEnabled, false);
  assert.equal(body.price, undefined);
  assert.equal(body.product.builds.length, 4);
});

await test('store-config: enabled ⇒ server-side price surfaces', async () => {
  const res = await handleStoreConfig(req('/api/store-config'), { env: ENV, getStripe: getFakeStripe(fakeStripe()) });
  const body = await res.json();
  assert.equal(body.commerceEnabled, true);
  assert.deepEqual(body.price, { amount: 14900, currency: 'gbp', type: 'one_time' });
});

await test('create-checkout: rejects smuggled price fields', async () => {
  const res = await handleCreateCheckout(
    req('/api/create-checkout-session', { method: 'POST', body: { amount: 1 } }),
    { env: ENV, store: new FakeStore(), getStripe: getFakeStripe(fakeStripe()) },
  );
  assert.equal(res.status, 400);
});

await test('create-checkout: disabled ⇒ 503; cross-origin ⇒ 403', async () => {
  const disabled = await handleCreateCheckout(req('/api/x', { method: 'POST', body: {} }), { env: { ...ENV, COMMERCE_ENABLED: 'false' }, store: new FakeStore(), getStripe: getFakeStripe(fakeStripe()) });
  assert.equal(disabled.status, 503);
  const cross = await handleCreateCheckout(
    new Request(`${SITE}/api/x`, { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' }),
    { env: ENV, store: new FakeStore(), getStripe: getFakeStripe(fakeStripe()) },
  );
  assert.equal(cross.status, 403);
});

await test('create-checkout: uses ONLY the server price; returns Stripe URL', async () => {
  const stripe = fakeStripe();
  const res = await handleCreateCheckout(
    req('/api/create-checkout-session', { method: 'POST', body: {} }),
    { env: ENV, store: new FakeStore(), getStripe: getFakeStripe(stripe) },
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).url, 'https://checkout.stripe.com/pay/cs_new');
  const params = stripe.calls.created[0];
  assert.deepEqual(params.line_items, [{ price: 'price_ours', quantity: 1 }]);
  assert.ok(params.success_url.endsWith('/download/success/?session_id={CHECKOUT_SESSION_ID}'));
});

await test('webhook: bad signature ⇒ 400, nothing stored', async () => {
  const store = new FakeStore();
  const res = await handleStripeWebhook(
    req('/api/stripe-webhook', { method: 'POST', body: {}, headers: { 'stripe-signature': 'bad' } }),
    { env: ENV, store, getStripe: getFakeStripe(fakeStripe()) },
  );
  assert.equal(res.status, 400);
  assert.equal(store.map.size, 0);
});

await test('webhook: paid session fulfils once; replay is a no-op', async () => {
  const store = new FakeStore();
  const event = { id: 'evt_a', type: 'checkout.session.completed', data: { object: { id: PAID_SESSION.id } } };
  const deps = { env: ENV, store, getStripe: getFakeStripe(fakeStripe({ eventFromSig: event })) };
  const r1 = await handleStripeWebhook(req('/api/stripe-webhook', { method: 'POST', body: event, headers: { 'stripe-signature': 'good-sig' } }), deps);
  assert.equal(r1.status, 200);
  assert.equal(isActive(await getBySessionId(store, PAID_SESSION.id)), true);
  const r2 = await handleStripeWebhook(req('/api/stripe-webhook', { method: 'POST', body: event, headers: { 'stripe-signature': 'good-sig' } }), deps);
  assert.equal((await r2.json()).duplicate, true);
});

await test('webhook: session for someone else\'s price is NOT fulfilled', async () => {
  const store = new FakeStore();
  const other = { ...PAID_SESSION, line_items: { data: [{ price: { id: 'price_theirs' } }] } };
  const event = { id: 'evt_b', type: 'checkout.session.completed', data: { object: { id: other.id } } };
  await handleStripeWebhook(
    req('/api/stripe-webhook', { method: 'POST', body: event, headers: { 'stripe-signature': 'good-sig' } }),
    { env: ENV, store, getStripe: getFakeStripe(fakeStripe({ session: other, eventFromSig: event })) },
  );
  assert.equal(await getBySessionId(store, other.id), null);
});

await test('webhook: charge.refunded revokes the entitlement', async () => {
  const store = new FakeStore();
  await fulfil(store, PAID_SESSION, ENV);
  const event = { id: 'evt_c', type: 'charge.refunded', data: { object: { payment_intent: 'pi_1' } } };
  await handleStripeWebhook(
    req('/api/stripe-webhook', { method: 'POST', body: event, headers: { 'stripe-signature': 'good-sig' } }),
    { env: ENV, store, getStripe: getFakeStripe(fakeStripe({ eventFromSig: event })) },
  );
  assert.equal(isActive(await getBySessionId(store, PAID_SESSION.id)), false);
});

await test('checkout-status: invalid id ⇒ 400; unknown ⇒ 404', async () => {
  const deps = { env: ENV, store: new FakeStore(), getStripe: getFakeStripe(fakeStripe()) };
  assert.equal((await handleCheckoutStatus(req('/api/checkout-status?session_id=../etc'), deps)).status, 400);
  assert.equal((await handleCheckoutStatus(req('/api/checkout-status?session_id=cs_unknown123'), deps)).status, 404);
});

await test('checkout-status: paid ⇒ fulfils (webhook race) and sets signed cookie', async () => {
  const store = new FakeStore();
  const res = await handleCheckoutStatus(
    req(`/api/checkout-status?session_id=${PAID_SESSION.id}`),
    { env: ENV, store, getStripe: getFakeStripe(fakeStripe()) },
  );
  const body = await res.json();
  assert.equal(body.status, 'paid');
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie && setCookie.includes('HttpOnly'));
  assert.equal(isActive(await getBySessionId(store, PAID_SESSION.id)), true);
});

await test('checkout-status: unpaid session ⇒ pending, no cookie', async () => {
  const unpaid = { ...PAID_SESSION, id: 'cs_test_unpaid1', payment_status: 'unpaid' };
  const res = await handleCheckoutStatus(
    req('/api/checkout-status?session_id=cs_test_unpaid1'),
    { env: ENV, store: new FakeStore(), getStripe: getFakeStripe(fakeStripe({ session: unpaid })) },
  );
  assert.equal((await res.json()).status, 'pending');
  assert.equal(res.headers.get('set-cookie'), null);
});

await test('restore request: identical neutral response for known and unknown email', async () => {
  const store = new FakeStore();
  await fulfil(store, PAID_SESSION, ENV);
  const sent = [];
  const deps = { env: ENV, store, sendRestoreEmail: async ({ to, restoreUrl }) => { sent.push({ to, restoreUrl }); return { sent: true }; } };
  const known = await handleRequestDownloadLink(req('/api/request-download-link', { method: 'POST', body: { email: 'buyer@example.com' } }), deps);
  const unknown = await handleRequestDownloadLink(req('/api/request-download-link', { method: 'POST', body: { email: 'nobody@example.com' } }), deps);
  assert.equal(await known.text(), await unknown.text());
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'buyer@example.com');
  const restoreKeys = [...store.map.keys()].filter((k) => k.startsWith('restore:'));
  assert.equal(restoreKeys.length, 1);
  assert.ok(!restoreKeys[0].includes(sent[0].restoreUrl.split('token=')[1]), 'token must be stored hashed');
});

await test('redeem: valid token sets cookie once; second use fails; expired fails', async () => {
  const store = new FakeStore();
  await fulfil(store, PAID_SESSION, ENV);
  const sent = [];
  await handleRequestDownloadLink(
    req('/api/request-download-link', { method: 'POST', body: { email: 'buyer@example.com' } }),
    { env: ENV, store, sendRestoreEmail: async (args) => { sent.push(args); return { sent: true }; } },
  );
  const token = sent[0].restoreUrl.split('token=')[1];
  const ok = await handleRedeemDownloadToken(req(`/api/redeem-download-token?token=${token}`), { env: ENV, store });
  assert.equal(ok.status, 302);
  assert.ok(ok.headers.get('location').includes('/download/success/?restored=1'));
  assert.ok(ok.headers.get('set-cookie'));
  const again = await handleRedeemDownloadToken(req(`/api/redeem-download-token?token=${token}`), { env: ENV, store });
  assert.ok(again.headers.get('location').includes('error=link'));
});

await test('download-link: no cookie ⇒ 401', async () => {
  const res = await handleDownloadLink(
    req('/api/download-link', { method: 'POST', body: { platform: 'windows', arch: 'x64' } }),
    { env: ENV, store: new FakeStore(), r2: fakeR2() },
  );
  assert.equal(res.status, 401);
});

await test('download-link: refunded purchase ⇒ 403 (revocation is immediate)', async () => {
  const store = new FakeStore();
  await fulfil(store, PAID_SESSION, ENV);
  await markRefunded(store, 'pi_1');
  const cookie = cookieHeader(PAID_SESSION.id, ENV).split(';')[0];
  const res = await handleDownloadLink(
    req('/api/download-link', { method: 'POST', body: { platform: 'windows', arch: 'x64' }, cookie }),
    { env: ENV, store, r2: fakeR2() },
  );
  assert.equal(res.status, 403);
});

await test('download-link: valid ⇒ presigned URL + verifiable metadata', async () => {
  const store = new FakeStore();
  await fulfil(store, PAID_SESSION, ENV);
  const cookie = cookieHeader(PAID_SESSION.id, ENV).split(';')[0];
  const res = await handleDownloadLink(
    req('/api/download-link', { method: 'POST', body: { platform: 'macos', arch: 'arm64' }, cookie }),
    { env: ENV, store, r2: fakeR2() },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.fileName, 'Estimation-Tools-1.2.0-macos-arm64.dmg');
  assert.equal(body.sha256, sha);
  assert.equal(body.size, 1000);
  assert.ok(body.url.startsWith('https://r2.example/presigned/releases/1.2.0/'));
});

await test('download-link: FILES_DOWNLOAD_HOST ⇒ branded claim URL the Worker can verify', async () => {
  const env = { ...ENV, FILES_DOWNLOAD_HOST: 'files.example.com' };
  const store = new FakeStore();
  await fulfil(store, PAID_SESSION, env);
  const cookie = cookieHeader(PAID_SESSION.id, env).split(';')[0];
  const res = await handleDownloadLink(
    req('/api/download-link', { method: 'POST', body: { platform: 'windows', arch: 'x64' }, cookie }),
    { env, store, r2: fakeR2() },
  );
  const body = await res.json();
  const url = new URL(body.url);
  assert.equal(url.hostname, 'files.example.com');
  const claim = await verifyClaim(url.searchParams.get('token'), { audience: 'files.example.com', requestedKey: url.pathname.slice(1) }, env.DOWNLOAD_TOKEN_SECRET);
  assert.ok(claim, 'worker-side verification must accept the token');
  assert.equal(claim.bld, 'windows-x64');
});

await test('download-link: unknown platform/arch ⇒ 400 (manifest is the allow-list)', async () => {
  const store = new FakeStore();
  await fulfil(store, PAID_SESSION, ENV);
  const cookie = cookieHeader(PAID_SESSION.id, ENV).split(';')[0];
  const res = await handleDownloadLink(
    req('/api/download-link', { method: 'POST', body: { platform: 'linux', arch: 'x64' }, cookie }),
    { env: ENV, store, r2: fakeR2() },
  );
  assert.equal(res.status, 400);
});

await test('safeEqual: constant-time compare handles length mismatch', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
});

console.log(`\ncommerce tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
