/* LIVE Row-Level-Security negative-authorization test (quality gate #8).
 *
 * Proves against a REAL Supabase instance that one tenant cannot read another
 * tenant's data. Uses ONLY the publishable/anon key + two ephemeral signed-up
 * users — never the service-role key. NOT part of `npm test` (needs network +
 * live creds); run with `npm run test:rls` after setting .env.local.
 *
 * Safe by design:
 *  - skips cleanly (exit 0) when creds, schema, or usable signups are missing,
 *    so it never breaks CI and never blocks on absent access;
 *  - creates only clearly-namespaced test rows and no destructive statements
 *    (no resets, no drops); it cannot delete auth users with an anon key, so
 *    it namespaces test emails as rls-test+<uuid>@example.com for easy cleanup.
 */
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const ROOT = new URL('../..', import.meta.url).pathname;
if (existsSync(ROOT + '.env.local')) {
  for (const line of readFileSync(ROOT + '.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

const skip = (msg) => { console.log(`SKIP (not a failure): ${msg}`); process.exit(0); };
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
if (!URL_ || !KEY) skip('no NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY (set .env.local).');

const anon = () => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// 1) schema present?
{
  const { error } = await anon().from('projects').select('id').limit(1);
  if (error && /PGRST205|does not exist|schema cache/i.test(error.message + (error.code || ''))) {
    skip('schema not applied yet — apply supabase/migrations/0001,0002,0003 in the Supabase SQL editor, then re-run.');
  }
  if (error && !/permission|rls|row-level/i.test(error.message)) {
    // an unexpected error other than "denied" — surface it but don't hard-fail the gate
    console.log('note: unexpected projects probe error:', error.code, error.message);
  }
}

// 2) anonymous (unauthenticated) MUST NOT read customer tables
for (const t of ['projects', 'documents', 'extraction_jobs', 'boards', 'devices']) {
  const { data, error } = await anon().from(t).select('*').limit(1);
  if (!error && Array.isArray(data) && data.length > 0) fail(`anon read returned rows from ${t} — RLS is not protecting customer data`);
}
console.log('  ok  anonymous access returns no customer rows');

// 3) two-tenant negative test — needs usable signups (email confirmation off).
async function signUp() {
  const sb = anon();
  const email = `rls-test+${randomUUID()}@example.com`;
  const password = `Test-${randomUUID()}`;
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) return { skip: `signup failed: ${error.message}` };
  if (!data.session) return { skip: 'signups require email confirmation — disable "Confirm email" on the test project (or provide two test users) to run the cross-tenant test.' };
  return { sb, user: data.user, email };
}
const A = await signUp(); if (A.skip) skip(A.skip);
const B = await signUp(); if (B.skip) skip(B.skip);

// A creates an org + project; the 0003 trigger enrols A as owner.
const orgA = await A.sb.from('organizations').insert({ name: `rls-test-A-${randomUUID()}`, created_by: A.user.id }).select('id').single();
if (orgA.error) fail(`A could not create org (RLS insert): ${orgA.error.message}`);
const projA = await A.sb.from('projects').insert({ org_id: orgA.data.id, name: 'A secret project', created_by: A.user.id }).select('id').single();
if (projA.error) fail(`A could not create project (bootstrap/RLS issue?): ${projA.error.message}`);

// A can read own project; B must NOT see it.
const aSeesOwn = await A.sb.from('projects').select('id').eq('id', projA.data.id);
if (aSeesOwn.error || aSeesOwn.data.length !== 1) fail('A cannot read its own project — RLS/bootstrap misconfigured');
const bReadsA = await B.sb.from('projects').select('id').eq('id', projA.data.id);
if (bReadsA.error && /permission|rls/i.test(bReadsA.error.message)) { /* denied by error is fine */ }
else if (bReadsA.data && bReadsA.data.length > 0) fail('CROSS-TENANT LEAK: user B read user A’s project via RLS');
console.log('  ok  user B cannot read user A’s project (RLS enforced)');

// B guessing the id directly also yields nothing.
const bGuess = await B.sb.from('projects').select('*').eq('id', projA.data.id).maybeSingle();
if (bGuess.data) fail('CROSS-TENANT LEAK: user B read user A’s project by id guess');
console.log('  ok  id-guess by another tenant returns nothing');

console.log('\nLIVE RLS negative test: PASS (no cross-tenant reads).');
console.log(`(test rows left under org ${orgA.data.id}; delete via SQL editor if desired.)`);
