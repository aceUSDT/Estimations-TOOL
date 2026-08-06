import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../../manager-test/index.html', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../supabase/migrations/202608060001_manager_test_passes.sql', import.meta.url), 'utf8');
const edge = fs.readFileSync(new URL('../../supabase/functions/manager-test-redeem/index.ts', import.meta.url), 'utf8');

assert.match(page, /location\.hash/, 'the pass must stay in the URL fragment, outside request logs');
assert.match(page, /history\.replaceState/, 'the page must remove the pass from the address bar before redemption');
assert.match(page, /addEventListener\('click'/, 'opening the page alone must not consume the pass');
assert.match(page, /sessionStorage\.setItem/, 'the accepted manager session must remain tab-scoped');
assert.match(page, /noindex,nofollow,noarchive/, 'the private page must not be indexed');
assert.match(app, /managerTestMode\?false:await idbOpen\(\)/, 'manager mode must not open persistent project storage');
assert.match(app, /fixtures\.forEach\(project=>project\.testFixture=true\)/, 'manager fixtures must remain non-persistent');
assert.match(migration, /redeemed_at is null[\s\S]*expires_at > now\(\)/, 'redemption must be single-use and expiry checked atomically');
assert.match(migration, /revoke all on public\.manager_test_passes from public, anon, authenticated/, 'pass records must not be client-readable');
assert.match(edge, /ALLOWED_ORIGINS/, 'the redemption endpoint must enforce an origin allow-list');
assert.doesNotMatch(edge, /console\.(?:log|error)\([^)]*token/i, 'the edge function must never log pass material');

console.log('Manager single-use access checks passed.');
