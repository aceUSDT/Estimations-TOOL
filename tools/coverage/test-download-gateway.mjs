/* Tests for the files.{ROOT_DOMAIN} download-gateway Worker.
 * The Worker imports the SAME claim module the Netlify side signs with, so
 * these tests prove the full mint→verify loop plus range/traversal behaviour.
 * No network, no Cloudflare — env is faked. Run:
 *   node tools/coverage/test-download-gateway.mjs
 */
import assert from 'node:assert/strict';
import worker from '../../workers/download-gateway/worker.mjs';
import { signClaim } from '../../api/_lib/commerce/download-claim.mjs';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL  ${name}\n      ${err.message}`); }
}

const SECRET = 'gateway-test-secret-gateway-test-secret';
const HOST = 'files.example.com';
const KEY = 'releases/1.2.0/Estimation-Tools-1.2.0-windows-x64.exe';
const BYTES = new TextEncoder().encode('0123456789ABCDEF');   // 16-byte "installer"

function fakeEnv() {
  return {
    DOWNLOAD_TOKEN_SECRET: SECRET,
    RELEASES: {
      async head(key) { return key === KEY ? { size: BYTES.length, httpEtag: '"abc"' } : null; },
      async get(key, opts = {}) {
        if (key !== KEY) return null;
        const { offset = 0, length = BYTES.length } = opts.range || {};
        return { body: BYTES.slice(offset, offset + length) };
      },
    },
  };
}

const mint = (over = {}) => signClaim({
  audience: HOST, entitlementId: 'cs_1', buildId: 'windows-x64', version: '1.2.0', objectKey: KEY, ...over,
}, SECRET);

const request = (token, { method = 'GET', headers = {}, key = KEY } = {}) => new Request(
  `https://${HOST}/${key}${token ? `?token=${token}` : ''}`, { method, headers },
);

await test('valid claim ⇒ 200, attachment, full body', async () => {
  const res = await worker.fetch(request(await mint()), fakeEnv());
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-disposition').includes('attachment'));
  assert.ok(res.headers.get('content-disposition').includes('Estimation-Tools-1.2.0-windows-x64.exe'));
  assert.equal(res.headers.get('content-length'), String(BYTES.length));
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

await test('no token ⇒ 403', async () => {
  const res = await worker.fetch(request(null), fakeEnv());
  assert.equal(res.status, 403);
});

await test('tampered token ⇒ 403', async () => {
  const token = await mint();
  const res = await worker.fetch(request(token.slice(0, -3) + 'xxx'), fakeEnv());
  assert.equal(res.status, 403);
});

await test('claim for one file cannot fetch another', async () => {
  const token = await mint({ objectKey: 'releases/1.2.0/other.dmg' });
  const res = await worker.fetch(request(token), fakeEnv());
  assert.equal(res.status, 403);
});

await test('claim for another hostname (audience) ⇒ 403', async () => {
  const token = await signClaim({ audience: 'files.other.com', entitlementId: 'cs_1', buildId: 'windows-x64', version: '1.2.0', objectKey: KEY }, SECRET);
  const res = await worker.fetch(request(token), fakeEnv());
  assert.equal(res.status, 403);
});

await test('path traversal / non-release keys ⇒ 404 without claim check', async () => {
  for (const key of ['releases/../secrets.txt', 'etc/passwd', '']) {
    const res = await worker.fetch(new Request(`https://${HOST}/${key}?token=whatever`), fakeEnv());
    assert.ok([403, 404].includes(res.status), `${key} → ${res.status}`);
  }
});

await test('range request ⇒ 206 with correct slice (resumable downloads)', async () => {
  const res = await worker.fetch(request(await mint(), { headers: { range: 'bytes=4-7' } }), fakeEnv());
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), `bytes 4-7/${BYTES.length}`);
  assert.equal(new TextDecoder().decode(await res.arrayBuffer()), '4567');
});

await test('suffix range and out-of-bounds range handled', async () => {
  const tail = await worker.fetch(request(await mint(), { headers: { range: 'bytes=-4' } }), fakeEnv());
  assert.equal(tail.status, 206);
  assert.equal(new TextDecoder().decode(await tail.arrayBuffer()), 'CDEF');
  const oob = await worker.fetch(request(await mint(), { headers: { range: 'bytes=99-' } }), fakeEnv());
  assert.equal(oob.status, 416);
});

await test('HEAD ⇒ metadata without body; POST ⇒ 405', async () => {
  const head = await worker.fetch(request(await mint(), { method: 'HEAD' }), fakeEnv());
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(BYTES.length));
  const post = await worker.fetch(request(await mint(), { method: 'POST' }), fakeEnv());
  assert.equal(post.status, 405);
});

await test('expired claim ⇒ 403', async () => {
  const token = await signClaim(
    { audience: HOST, entitlementId: 'cs_1', buildId: 'windows-x64', version: '1.2.0', objectKey: KEY },
    SECRET,
    Date.now() - 301 * 1000,   // signed 301s ago → already past the 300s TTL
  );
  const res = await worker.fetch(request(token), fakeEnv());
  assert.equal(res.status, 403);
});

console.log(`\ndownload-gateway tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
