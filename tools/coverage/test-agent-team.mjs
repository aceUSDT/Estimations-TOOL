import assert from 'node:assert/strict';

import { poolStatus, parseModelJson } from '../../netlify/functions/lib/nvidia-pool.mjs';
import { runAgentTeam, MASTER_VERDICT_SCHEMA } from '../../netlify/functions/lib/agent-team.mjs';
import { crossCheckExtractions, buildInstruction } from '../../netlify/functions/lib/providers.mjs';
import { engineStatus, makeExtractSmart } from '../../netlify/functions/lib/extraction-engine.mjs';

const priorGeminiKey = process.env.GEMINI_API_KEY;
delete process.env.GEMINI_API_KEY;

assert.equal(poolStatus({}).configured, false);
assert.equal(poolStatus({ NVIDIA_API_KEY_2: 'x'.repeat(20) }).configured, true);
assert.deepEqual(parseModelJson('```json\n{"ok":true}\n```'), { ok: true });

const deviceA = { board_ref: 'DB-1', way: 1, phase: 'L1', device_class: 'RCBO', rating_a: 32, description: 'Sockets' };
const deviceB = { board_ref: 'DB-1', way: 2, phase: 'L2', device_class: 'MCB', rating_a: 10, description: 'Lighting' };
const result = (devices) => JSON.stringify({ classification: {}, boards: [], devices, feeds: [], flags: [] });
let excludedPrimary = false;
const pool = {
  callRole: async (role, request, options = {}) => {
    if (role === 'extract') return { content: result([deviceA]), model: 'agent-a', keyId: 1, ms: 5 };
    excludedPrimary = options.exclude?.includes('agent-a') === true;
    return { content: result([deviceA, deviceB]), model: 'agent-b', keyId: 2, ms: 6 };
  },
};

let masterPrompt = '';
const team = await runAgentTeam({ textLines: ['DB-1 schedule'], filename: 'local.pdf', pageNumber: 1,
  imageBase64: 'dGVzdA==', mediaType: 'image/jpeg' }, {
  pool, crossCheck: crossCheckExtractions, buildInstruction, geminiConfigured: true,
  callMaster: async ({ instruction, schema, imageBase64, mediaType }) => {
    masterPrompt = instruction;
    assert.equal(schema, MASTER_VERDICT_SCHEMA);
    assert.equal(imageBase64, 'dGVzdA==');
    assert.equal(mediaType, 'image/jpeg');
    return { json: { complete: false, missed: [{ board_ref: 'DB-1', way: '3', evidence: 'SPD printed on row 3' }], notes: '' } };
  },
});
assert.equal(excludedPrimary, true, 'second opinion must use a different model');
assert.equal(team.result.devices.length, 1, 'primary extraction remains authoritative pending review');
assert.equal(team.verification.status, 'done');
assert.equal(team.verification.mismatches[0].kind, 'missing_in_primary');
assert.match(masterPrompt, /missing_in_primary/);
assert.match(masterPrompt, /authored source contradictions/);
assert.match(masterPrompt, /printed and inferred values/);
assert.equal(team.master.status, 'reviewed');
assert.equal(team.master.missed.length, 1);

let malformedCalls = 0;
const retryTeam = await runAgentTeam({ textLines: ['DB-1 schedule'], filename: 'local.pdf', pageNumber: 1 }, {
  pool: {
    callRole: async (role, request, options = {}) => {
      if (role === 'extract' && !options.exclude.includes('bad-agent')) {
        malformedCalls += 1;
        return { content: 'not valid JSON', model: 'bad-agent', keyId: 1, ms: 1 };
      }
      return { content: result([deviceA]), model: role === 'extract' ? 'good-agent' : 'second-agent', keyId: 2, ms: 2 };
    },
  },
  crossCheck: crossCheckExtractions, buildInstruction, geminiConfigured: false,
});
assert.equal(malformedCalls, 1, 'malformed sub-agent output must be rejected once');
assert.equal(retryTeam.agents.extractor.model, 'good-agent', 'the next valid model must replace malformed output');
assert.equal(retryTeam.result.devices.length, 1);

delete process.env.GEMINI_API_KEY;
assert.equal(engineStatus({}).mode, 'unconfigured');
assert.equal(engineStatus({ NVIDIA_API_KEY_1: 'x'.repeat(20) }).mode, 'agent-team');
assert.equal(engineStatus({ GEMINI_API_KEY: 'fake-key' }).mode, 'gemini');

const smart = makeExtractSmart({
  status: () => ({ mode: 'agent-team', gemini: true }),
  getPool: () => ({}),
  team: async () => { const error = new Error('pool unavailable'); error.code = 'role_exhausted'; throw error; },
  gemini: async () => ({ result: { devices: [] }, provider: 'gemini' }),
});
const fallback = await smart({ instruction: 'extract' });
assert.equal(fallback.fallback, 'gemini_direct');
assert.equal(fallback.fallback_reason, 'nvidia_chain_exhausted');

if (priorGeminiKey == null) delete process.env.GEMINI_API_KEY;
else process.env.GEMINI_API_KEY = priorGeminiKey;

console.log('PASS: independent AI agents, deterministic cross-check, master audit, and honest fallback.');
