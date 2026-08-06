import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../../test-workspace/index.html', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../supabase/migrations/202608060001_manager_test_passes.sql', import.meta.url), 'utf8');
const edge = fs.readFileSync(new URL('../../supabase/functions/manager-test-redeem/index.ts', import.meta.url), 'utf8');

assert.match(page, /location\.hash/, 'the pass must stay in the URL fragment, outside request logs');
assert.match(page, /history\.replaceState/, 'the page must remove the pass from the address bar before redemption');
assert.match(page, /addEventListener\('click'/, 'opening the page alone must not consume the pass');
assert.match(page, /sessionStorage\.setItem/, 'the accepted manager session must remain tab-scoped');
assert.doesNotMatch(page, /Date\.now\(\)\s*\+\s*8\s*\*\s*60/, 'redemption must not mint a fresh client-side session window');
assert.match(page, /Date\.parse\(payload\.expiresAt/, 'the page must use the server-issued absolute expiry');
assert.match(page, /<title>Test workspace \| Estimation Tools<\/title>/, 'the evaluation page must use the neutral Test workspace title');
assert.match(page, /<h1 id="title">Test workspace<\/h1>/, 'the evaluation page heading must use the neutral Test workspace label');
assert.doesNotMatch(page, /Manager evaluation|Manager test workspace/, 'the evaluation page must not expose manager-specific wording');
assert.match(page, /location\.replace\('\.\.\/\?test-workspace=1'\)/, 'the activated workspace URL must use the neutral test-workspace route');
assert.doesNotMatch(page, /location\.replace\([^\n]*manager-test=1/, 'the activated workspace URL must not expose the legacy manager-test label');
assert.match(page, /noindex,nofollow,noarchive/, 'the private page must not be indexed');
assert.match(app, /managerTestMode\?false:await idbOpen\(\)/, 'manager mode must not open persistent project storage');
assert.match(app, /setTimeout\(expireSession,Math\.max\(0,managerGrant\.expiresAt-Date\.now\(\)\)\)/, 'the open workspace must close at the absolute pass deadline');
assert.match(app, /visibilitychange/, 'the workspace must re-check expiry when a suspended tab becomes visible');
assert.match(app, /fixtures\.forEach\(project=>project\.testFixture=true\)/, 'manager fixtures must remain non-persistent');
assert.match(migration, /redeemed_at is null[\s\S]*expires_at > now\(\)/, 'redemption must be single-use and expiry checked atomically');
assert.match(migration, /returns table\(pass_id uuid, expires_at timestamptz\)/, 'redemption must return the fixed server expiry');
assert.match(migration, /revoke all on public\.manager_test_passes from public, anon, authenticated/, 'pass records must not be client-readable');
assert.match(edge, /ALLOWED_ORIGINS/, 'the redemption endpoint must enforce an origin allow-list');
assert.match(edge, /expiresAt: new Date\(expiresAt\)\.toISOString\(\)/, 'the edge function must return the fixed server expiry');
assert.doesNotMatch(edge, /console\.(?:log|error)\([^)]*token/i, 'the edge function must never log pass material');

console.log('Manager single-use access checks passed.');
