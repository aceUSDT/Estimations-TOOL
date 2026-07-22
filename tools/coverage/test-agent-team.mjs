/* Unit tests: NVIDIA sub-agent pool + Gemini-master agent team.
 * No network, no keys — everything through injected fakes. Verifies the
 * properties the product depends on:
 *   - role chains fall back past stalled models (a hung endpoint never blocks)
 *   - the second opinion NEVER reuses the primary's model
 *   - per-key pacing stays under the free-tier budget
 *   - failing models cool down, then auto-recover
 *   - the master audits (or is honestly 'skipped'); disagreements are computed
 *     by deterministic code, not by any model
 *   - no error ever carries key material
 */
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const load = (p) => import(pathToFileURL(path.resolve(ROOT, p)));

const { createPool, poolStatus, parseModelJson, MODEL_REGISTRY, ROLE_CHAINS } = await load('api/_lib/extraction/nvidia-pool.mjs');
const { runAgentTeam, MASTER_VERDICT_SCHEMA } = await load('api/_lib/extraction/agent-team.mjs');
const { crossCheckExtractions, buildInstruction } = await load('api/_lib/extraction/providers.mjs');

let fail = 0;
const check = (name, cond, detail) => { if (!cond) { console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); fail++; } };

/* ---- config + JSON parsing ---- */
check('poolStatus: unconfigured', poolStatus({}).configured === false);
check('poolStatus: one key configures', poolStatus({ NVIDIA_API_KEY_2: 'x'.repeat(20) }).configured === true);
check('parseModelJson: plain object', parseModelJson('{"a":1}').a === 1);
check('parseModelJson: fenced', parseModelJson('```json\n{"a":2}\n```').a === 2);
check('parseModelJson: prose-wrapped', parseModelJson('Sure! {"a":3} hope that helps').a === 3);
check('parseModelJson: garbage → null', parseModelJson('no json here') === null);

/* ---- production chain sanity ---- */
for (const [role, chain] of Object.entries(ROLE_CHAINS)) {
  check(`chain ${role}: every model registered`, chain.every((m) => MODEL_REGISTRY[m]));
  check(`chain ${role}: has a live-verified leader`, MODEL_REGISTRY[chain[0]] && (role === 'vision_parse' || MODEL_REGISTRY[chain[0]].verified === true));
}
check('extract + second_opinion lead with different models', ROLE_CHAINS.extract[0] !== ROLE_CHAINS.second_opinion[0]);

/* ---- pool harness ---- */
const KEYS = { 1: 'nvapi-FAKE-KEY-ONE-000000', 2: 'nvapi-FAKE-KEY-TWO-000000', 3: 'nvapi-FAKE-KEY-THREE-0000' };
const REG = {
  'a/model-a': { key: 1, vision: false, verified: true },
  'b/model-b': { key: 2, vision: false, verified: true },
  'c/model-c': { key: 1, vision: false, verified: true },
};
const CHAINS = { work: ['a/model-a', 'b/model-b', 'c/model-c'] };
const okResponse = (text) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }] }) });

function harness({ behaviours, rpmPerKey = 30, startAt = 1000000 } = {}) {
  let t = startAt;
  const sleeps = [];
  const calls = [];
  const fetchImpl = async (url, init) => {
    const model = JSON.parse(init.body).model;
    calls.push(model);
    const b = (behaviours && behaviours[model]) || 'ok';
    if (b === 'ok') return okResponse(`{"from":"${model}"}`);
    if (b === 'http500') return { ok: false, status: 500, json: async () => ({}) };
    if (b === 'hang') { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    return okResponse('');
  };
  const pool = createPool({
    keys: KEYS, registry: REG, chains: CHAINS, fetchImpl,
    now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; },
    rpmPerKey, timeoutMs: 50, cooldownMs: 10000,
  });
  return { pool, sleeps, calls, tick: (ms) => { t += ms; } };
}

/* happy path: first model in chain answers */
{
  const h = harness();
  const out = await h.pool.callRole('work', { prompt: 'x' });
  check('callRole: first healthy model wins', out.model === 'a/model-a');
  check('callRole: reports key slot', out.keyId === 1);
  check('callRole: content round-trips', parseModelJson(out.content).from === 'a/model-a');
}

/* fallback: stalled model never blocks the role */
{
  const h = harness({ behaviours: { 'a/model-a': 'hang' } });
  const out = await h.pool.callRole('work', { prompt: 'x' });
  check('fallback: hung model → next in chain', out.model === 'b/model-b');
  check('fallback: attempt recorded with code', out.attempts.some((a) => a.model === 'a/model-a' && a.error === 'timeout'));
}

/* exclusion: the second opinion can never reuse the primary's model */
{
  const h = harness();
  const out = await h.pool.callRole('work', { prompt: 'x' }, { exclude: ['a/model-a'] });
  check('exclude: skips excluded model', out.model === 'b/model-b');
  check('exclude: skip is visible in attempts', out.attempts.some((a) => a.model === 'a/model-a' && a.skipped === 'excluded'));
}

/* pacing: per-key budget enforced by waiting, not by dropping */
{
  const h = harness({ rpmPerKey: 2 });
  await h.pool.callModel('a/model-a', { prompt: '1' });
  await h.pool.callModel('a/model-a', { prompt: '2' });
  await h.pool.callModel('a/model-a', { prompt: '3' });          // over budget → must wait
  check('pacing: third call on the key waited', h.sleeps.length === 1 && h.sleeps[0] > 0, JSON.stringify(h.sleeps));
  await h.pool.callModel('b/model-b', { prompt: '4' });          // other key: own budget
  check('pacing: budgets are per key', h.sleeps.length === 1);
}

/* health: repeated failures cool a model down, then it auto-recovers */
{
  const h = harness({ behaviours: { 'a/model-a': 'http500' } });
  await h.pool.callRole('work', { prompt: 'x' });                // fail #1 → b answers
  await h.pool.callRole('work', { prompt: 'x' });                // fail #2 → b answers
  const third = await h.pool.callRole('work', { prompt: 'x' });  // now cooling down → skipped
  check('health: cooling model skipped without a call', third.attempts.some((a) => a.model === 'a/model-a' && a.skipped === 'cooldown'));
  h.tick(11000);                                                 // past cooldownMs
  const fourth = await h.pool.callRole('work', { prompt: 'x' });
  check('health: model retried after cooldown', fourth.attempts.some((a) => a.model === 'a/model-a' && a.error === 'http_500'));
}

/* exhaustion: stable error, attempts preserved, and NO key material */
{
  const h = harness({ behaviours: { 'a/model-a': 'http500', 'b/model-b': 'hang', 'c/model-c': 'http500' } });
  let err = null;
  try { await h.pool.callRole('work', { prompt: 'x' }); } catch (e) { err = e; }
  check('exhausted: throws role_exhausted', err && err.code === 'role_exhausted');
  check('exhausted: attempts carried', err && err.attempts.length === 3);
  check('sanitized: no key material in error', err && !JSON.stringify({ m: err.message, a: err.attempts }).includes('nvapi'));
}

/* ---- the full team, fakes end to end ---- */
const PAGE = { textLines: ['DB-1 SCHEDULE', '13  32A B RCBO Kitchen sockets', '14  6A B MCB Lighting'], filename: 'x.pdf', pageNumber: 2, hints: {} };
const devA = { board_ref: 'DB-1', way: 13, phase: '', device_class: 'RCBO', rating_a: 32, poles: 1, curve: 'B', description: 'Kitchen sockets', confidence: 0.9, is_spare: false };
const devB = { board_ref: 'DB-1', way: 14, phase: '', device_class: 'MCB', rating_a: 6, poles: 1, curve: 'B', description: 'Lighting', confidence: 0.9, is_spare: false };
const wrap = (devices) => JSON.stringify({ classification: { type: 'db_schedule', sub_format: 'generic', confidence: 0.9 }, boards: [], devices, feeds: [], flags: [] });

function fakeTeamPool({ secondFails } = {}) {
  return {
    callRole: async (role, req, o = {}) => {
      if (role === 'extract') return { content: wrap([devA]), model: 'a/model-a', keyId: 1, ms: 5, role, attempts: [] };
      if (role === 'second_opinion') {
        if (secondFails) { const e = new Error('nvidia-pool: role_exhausted'); e.code = 'role_exhausted'; throw e; }
        check('team: second opinion excludes primary model', (o.exclude || []).includes('a/model-a'));
        return { content: wrap([devA, devB]), model: 'b/model-b', keyId: 2, ms: 7, role, attempts: [] };
      }
      throw new Error('unexpected role ' + role);
    },
  };
}

{ // full run: disagreement surfaces deterministically; master reviews
  let masterSaw = null;
  const out = await runAgentTeam(PAGE, {
    pool: fakeTeamPool(),
    crossCheck: crossCheckExtractions,
    buildInstruction,
    geminiConfigured: true,
    callMaster: async ({ instruction, schema }) => {
      masterSaw = { instruction, schema };
      return { json: { complete: false, missed: [{ board_ref: 'DB-1', way: '15', evidence: 'SPD on way 15 in source' }], notes: 'one gap' } };
    },
  });
  check('team: primary result kept as the result', out.result.devices.length === 1);
  check('team: cross-check ran deterministically', out.verification.performed === true);
  check('team: missing_in_primary surfaced', (out.verification.mismatches || []).some((m) => m.kind === 'missing_in_primary'));
  check('team: master verdict recorded', out.master.status === 'reviewed' && out.master.complete === false && out.master.missed.length === 1);
  check('team: master got the computed mismatches', masterSaw && masterSaw.instruction.includes('missing_in_primary'));
  check('team: master used the verdict schema', masterSaw && masterSaw.schema === MASTER_VERDICT_SCHEMA);
  check('team: agent provenance recorded', out.agents.extractor.model === 'a/model-a' && out.agents.second.model === 'b/model-b');
}

{ // degraded run: no second opinion → honest verification; master still audits
  const out = await runAgentTeam(PAGE, {
    pool: fakeTeamPool({ secondFails: true }),
    crossCheck: crossCheckExtractions,
    buildInstruction,
    geminiConfigured: true,
    callMaster: async () => ({ json: { complete: true, missed: [], notes: '' } }),
  });
  check('degraded: verification honestly not performed', out.verification.performed === false && out.verification.reason === 'second_opinion_unavailable');
  check('degraded: second agent recorded as null', out.agents.second === null);
}

{ // no master configured → skipped is reported, never faked
  const out = await runAgentTeam(PAGE, {
    pool: fakeTeamPool(),
    crossCheck: crossCheckExtractions,
    buildInstruction,
    geminiConfigured: false,
    callMaster: async () => { throw new Error('must not be called'); },
  });
  check('no master: status skipped', out.master.status === 'skipped' && out.master.reason === 'gemini_unconfigured');
}

{ // master crash never sinks the extraction
  const out = await runAgentTeam(PAGE, {
    pool: fakeTeamPool(),
    crossCheck: crossCheckExtractions,
    buildInstruction,
    geminiConfigured: true,
    callMaster: async () => { throw new Error('boom'); },
  });
  check('master crash: pipeline survives with master error', out.master.status === 'error' && out.result.devices.length === 1);
}

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1); }
console.log('PASS: nvidia pool (pacing, fallback, cooldown, sanitized errors) + Gemini-master agent team.');
