/* Deterministic tests for the Vercel extraction routes (Phase 4/5).
 * No Vercel runtime, no network, no Supabase — the pure handlers and the
 * worker are exercised against in-memory fakes. Pins the security and
 * data-integrity invariants: auth + ownership, idempotency, stable error
 * codes, and the honest state machine (zero-device / failed can never be an
 * issue-ready success).
 * Run: node tools/coverage/test-vercel-routes.mjs
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  handleHealth, handleStart, handleStatus, handleResult, deriveState, issueReady,
} from '../../api/_lib/handlers.mjs';
import { makeProcessJob } from '../../api/_lib/worker.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`FAIL  ${name}\n      ${e.message}`); }
}

/* ── in-memory fake db (same interface as api/_lib/db.mjs) ─────────────── */
function fakeDb() {
  const members = new Map();   // userId -> Set(orgId)
  const projects = new Map();  // projectId -> { orgId }
  const jobs = new Map();      // jobId -> job
  const results = new Map();   // jobId -> result
  const api = {
    _addMember(userId, orgId) { if (!members.has(userId)) members.set(userId, new Set()); members.get(userId).add(orgId); },
    _addProject(projectId, orgId) { projects.set(projectId, { orgId }); },
    _seedJob(job) { jobs.set(job.id, job); },
    _isMember(userId, orgId) { return members.has(userId) && members.get(userId).has(orgId); },
    async userOwnsProject(sb, userId, projectId) {
      const p = projects.get(projectId);
      return p && api._isMember(userId, p.orgId) ? { projectId, orgId: p.orgId } : null;
    },
    async findJobByIdempotency(sb, projectId, key) {
      for (const j of jobs.values()) if (j.project_id === projectId && j.idempotency_key === key) return j;
      return null;
    },
    async insertJob(sb, row) {
      for (const j of jobs.values()) if (j.project_id === row.project_id && j.idempotency_key === row.idempotency_key) {
        throw Object.assign(new Error('unique'), { code: '23505' });
      }
      const job = { id: randomUUID(), attempt: 0, ...row };
      jobs.set(job.id, job); return job;
    },
    async getJobForUser(sb, userId, jobId) {
      const j = jobs.get(jobId);
      return j && api._isMember(userId, j.org_id) ? j : null;
    },
    async getResultForUser(sb, userId, jobId) {
      const job = await api.getJobForUser(sb, userId, jobId);
      return { job, result: job ? (results.get(jobId) || null) : null };
    },
    async updateJob(sb, jobId, patch) { const j = jobs.get(jobId); Object.assign(j, patch); return j; },
    async insertResult(sb, row) { results.set(row.job_id, row); return row; },
  };
  return api;
}

const geminiOk = () => ({ gemini: true, configured: true, primary: 'gemini', verify: false });
function baseDeps(over = {}) {
  return {
    providerStatus: geminiOk, GEMINI_MODEL: 'gemini-2.5-flash', GEMINI_VERIFY_MODEL: null,
    supabaseConfigured: true, authRequired: true, sb: null,
    resolveUser: async () => over.userId || null,
    processJob: () => {}, db: over.db, ...over,
  };
}
const uuid = () => randomUUID();
const startBody = (over = {}) => ({
  project_id: uuid(), document_id: uuid(), page_number: 1,
  image_base64: 'aGVsbG8=', idempotency_key: 'idem-key-0001', ...over,
});

/* ── health ────────────────────────────────────────────────────────────── */
await test('health reports Gemini-only, no anthropic, nullable verify_model', () => {
  const out = handleHealth(baseDeps({ db: fakeDb() }));
  assert.equal(out.status, 200);
  assert.equal(out.body.primary, 'gemini');
  assert.ok(!('anthropic' in out.body.providers));
  assert.equal(out.body.verify_model, null);
});

/* ── deriveState (the honest state machine) ──────────────────────────────── */
await test('deriveState: boards>0 & devices=0 ⇒ incomplete (never complete)', () => {
  assert.equal(deriveState({ boardCount: 7, deviceCount: 0 }), 'incomplete');
  assert.equal(issueReady('incomplete'), false);
});
await test('deriveState: failed dominates; review ⇒ needs_review; else complete', () => {
  assert.equal(deriveState({ failed: true, boardCount: 5, deviceCount: 5 }), 'failed');
  assert.equal(deriveState({ boardCount: 3, deviceCount: 9, blockingReview: true }), 'needs_review');
  assert.equal(deriveState({ boardCount: 3, deviceCount: 9 }), 'complete');
  assert.equal(deriveState({ boardCount: 0, deviceCount: 0 }), 'complete');   // non-schedule page
  assert.equal(issueReady('complete'), true);
  assert.equal(issueReady('needs_review'), false);
});

/* ── start: validation ───────────────────────────────────────────────────── */
await test('start: method guard, shape validation, size caps, idempotency-key rule', async () => {
  const d = baseDeps({ db: fakeDb(), userId: 'u1' });
  assert.equal((await handleStart({ method: 'GET', body: startBody() }, d)).status, 405);
  assert.equal((await handleStart({ method: 'POST', body: startBody({ project_id: 'nope' }) }, d)).status, 400);
  assert.equal((await handleStart({ method: 'POST', body: startBody({ page_number: 0 }) }, d)).status, 400);
  assert.equal((await handleStart({ method: 'POST', body: startBody({ image_base64: '', text_lines: [] }) }, d)).status, 400);
  assert.equal((await handleStart({ method: 'POST', body: startBody({ image_base64: 'a'.repeat(9 * 1024 * 1024) }) }, d)).status, 413);
  assert.equal((await handleStart({ method: 'POST', body: startBody({ idempotency_key: 'short' }) }, d)).status, 400);
});

await test('start: unauthenticated ⇒ 401 when auth required', async () => {
  const out = await handleStart({ method: 'POST', body: startBody() }, baseDeps({ db: fakeDb(), userId: null }));
  assert.equal(out.status, 401);
  assert.equal(out.body.error.code, 'unauthenticated');
});

await test('start: project not owned ⇒ 404 (does not confirm existence)', async () => {
  const db = fakeDb();
  const out = await handleStart({ method: 'POST', body: startBody() }, baseDeps({ db, userId: 'u1' }));
  assert.equal(out.status, 404);
  assert.equal(out.body.error.code, 'not_found');
});

await test('start: happy path ⇒ 202, durable job created, processing kicked', async () => {
  const db = fakeDb();
  const org = 'org1', project = uuid();
  db._addMember('u1', org); db._addProject(project, org);
  const kicked = [];
  const d = baseDeps({ db, userId: 'u1', processJob: (job, payload) => kicked.push({ job, payload }) });
  const body = startBody({ project_id: project });
  const out = await handleStart({ method: 'POST', body }, d);
  assert.equal(out.status, 202);
  assert.ok(out.body.job_id);
  assert.equal(out.body.state, 'queued');
  assert.equal(kicked.length, 1);
  const stored = await db.getJobForUser(null, 'u1', out.body.job_id);
  assert.ok(stored && stored.state === 'queued', 'job persisted before processing');
});

await test('start: idempotent — same key returns same job, no duplicate, no re-kick', async () => {
  const db = fakeDb();
  const org = 'org1', project = uuid();
  db._addMember('u1', org); db._addProject(project, org);
  const kicked = [];
  const d = baseDeps({ db, userId: 'u1', processJob: () => kicked.push(1) });
  const body = startBody({ project_id: project, idempotency_key: 'stable-key-123' });
  const a = await handleStart({ method: 'POST', body }, d);
  const b = await handleStart({ method: 'POST', body }, d);
  assert.equal(a.body.job_id, b.body.job_id);
  assert.equal(b.body.idempotent, true);
  assert.equal(kicked.length, 1, 'processing kicked once');
});

/* ── status: ownership ───────────────────────────────────────────────────── */
await test('status: invalid id ⇒ 400; cross-tenant guess ⇒ 404; owned ⇒ 200', async () => {
  const db = fakeDb();
  db._addMember('owner', 'orgA');
  db._seedJob({ id: 'j1', org_id: 'orgA', state: 'running', page_number: 1, attempt: 1, correlation_id: 'c1', updated_at: 't' });
  const d = (userId) => baseDeps({ db, userId });
  assert.equal((await handleStatus({ method: 'GET', query: { id: 'not-a-uuid' } }, d('owner'))).status, 400);
  // valid-looking but unauthorized user
  const jid = randomUUID();
  db._seedJob({ id: jid, org_id: 'orgA', state: 'running', page_number: 1, attempt: 1, correlation_id: 'c', updated_at: 't' });
  assert.equal((await handleStatus({ method: 'GET', query: { id: jid } }, d('attacker'))).status, 404);
  const ownOut = await handleStatus({ method: 'GET', query: { id: jid } }, d('owner'));
  assert.equal(ownOut.status, 200);
  assert.equal(ownOut.body.state, 'running');
});

/* ── result: issue-ready gating (gate #4) ────────────────────────────────── */
async function resultFor(state, resultRow) {
  const db = fakeDb();
  db._addMember('owner', 'orgA');
  const jid = randomUUID();
  db._seedJob({ id: jid, org_id: 'orgA', state, correlation_id: 'c', error_code: state === 'failed' ? 'extraction_error' : (state === 'incomplete' ? 'zero_devices_with_boards' : null) });
  if (resultRow) await db.insertResult(null, { job_id: jid, ...resultRow });
  return handleResult({ method: 'GET', query: { id: jid } }, baseDeps({ db, userId: 'owner' }));
}
await test('result: queued/running ⇒ not issue-ready, no payload', async () => {
  for (const s of ['queued', 'running']) {
    const out = await resultFor(s);
    assert.equal(out.body.issue_ready, false);
    assert.equal(out.body.result, null);
  }
});
await test('result: failed ⇒ not issue-ready, error_code, no payload', async () => {
  const out = await resultFor('failed');
  assert.equal(out.body.issue_ready, false);
  assert.equal(out.body.result, null);
  assert.equal(out.body.error_code, 'extraction_error');
});
await test('result: incomplete ⇒ not issue-ready, diagnostics available, no payload', async () => {
  const out = await resultFor('incomplete');
  assert.equal(out.body.issue_ready, false);
  assert.equal(out.body.result, null);
  assert.equal(out.body.diagnostics_available, true);
});
await test('result: needs_review ⇒ result present but NOT issue-ready', async () => {
  const out = await resultFor('needs_review', { structured: { boards: [{}] }, board_count: 1, device_count: 4 });
  assert.equal(out.body.issue_ready, false);
  assert.equal(out.body.review_required, true);
  assert.ok(out.body.result);
});
await test('result: complete ⇒ issue-ready with payload', async () => {
  const out = await resultFor('complete', { structured: { boards: [{}], devices: [{}] }, board_count: 1, device_count: 1 });
  assert.equal(out.body.issue_ready, true);
  assert.ok(out.body.result);
});
await test('result: cross-tenant guess ⇒ 404', async () => {
  const db = fakeDb();
  db._addMember('owner', 'orgA');
  const jid = randomUUID();
  db._seedJob({ id: jid, org_id: 'orgA', state: 'complete', correlation_id: 'c' });
  const out = await handleResult({ method: 'GET', query: { id: jid } }, baseDeps({ db, userId: 'someone-else' }));
  assert.equal(out.status, 404);
});

/* ── worker: honest terminal states ──────────────────────────────────────── */
function workerDeps(db, extractImpl) {
  return { sb: null, db, extract: extractImpl, buildInstruction: () => 'instr', now: () => '2026-07-19T00:00:00.000Z' };
}
await test('worker: boards>0 & devices=0 ⇒ job incomplete (zero-device guard), result stored', async () => {
  const db = fakeDb();
  const job = { id: randomUUID(), org_id: 'orgA', document_id: uuid(), page_number: 1, attempt: 0 };
  db._seedJob(job);
  const extract = async () => ({ result: { boards: [{ ref: 'DB-1' }], devices: [] }, verification: null });
  await makeProcessJob(workerDeps(db, extract))(job, {});
  assert.equal(job.state, 'incomplete');
  assert.equal(job.error_code, 'zero_devices_with_boards');
});
await test('worker: normal page ⇒ complete; mismatch ⇒ needs_review; throw ⇒ failed', async () => {
  const mk = () => { const db = fakeDb(); const job = { id: randomUUID(), org_id: 'orgA', document_id: uuid(), page_number: 1, attempt: 0 }; db._seedJob(job); return { db, job }; };
  let { db, job } = mk();
  await makeProcessJob(workerDeps(db, async () => ({ result: { boards: [{}], devices: [{ device_class: 'MCB' }] }, verification: null })))(job, {});
  assert.equal(job.state, 'complete');

  ({ db, job } = mk());
  await makeProcessJob(workerDeps(db, async () => ({ result: { boards: [{}], devices: [{ device_class: 'MCB' }] }, verification: { status: 'done', mismatches: [{ kind: 'missing_in_primary' }] } })))(job, {});
  assert.equal(job.state, 'needs_review');

  ({ db, job } = mk());
  await makeProcessJob(workerDeps(db, async () => { throw new Error('boom-with-secret'); }))(job, {});
  assert.equal(job.state, 'failed');
  assert.equal(job.error_code, 'extraction_error');
  assert.ok(!/secret/.test(JSON.stringify({ code: job.error_code })), 'error_code is a stable machine code');
});

console.log(`\nvercel-routes tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
