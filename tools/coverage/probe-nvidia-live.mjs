/* LIVE smoke probe for the NVIDIA sub-agent pool (not part of `npm test`).
 * Run with `npm run test:nvidia` after setting NVIDIA_API_KEY_1..3 in .env.local.
 * Skips cleanly (exit 0) when no keys are configured, so it never breaks CI.
 * Sends ONE tiny request per configured key (≤3 total — far under any budget)
 * and one chained role call, printing model, latency, and reply. No secrets
 * are ever printed.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
if (existsSync(path.join(ROOT, '.env.local'))) {
  for (const line of readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const { createPool, poolStatus, MODEL_REGISTRY } = await import(pathToFileURL(path.resolve(ROOT, 'api/_lib/extraction/nvidia-pool.mjs')));

const st = poolStatus();
if (!st.configured) { console.log('SKIP (not a failure): no NVIDIA_API_KEY_1..3 in the environment/.env.local.'); process.exit(0); }
console.log('keys configured:', Object.entries(st.keys).filter(([, v]) => v).map(([k]) => `slot ${k}`).join(', '));

const pool = createPool({ timeoutMs: 45000 });
const PROBE = { prompt: "A UK DB way reads: '13 32A B RCBO Kitchen sockets 6.0mm'. Reply ONLY the device type and rating.", maxTokens: 600 };

// one verified model per configured key slot
const perKey = {};
for (const [model, meta] of Object.entries(MODEL_REGISTRY)) {
  if (meta.verified && st.keys[meta.key] && !perKey[meta.key]) perKey[meta.key] = model;
}
// Per-key single-model calls are DIAGNOSTIC ONLY: NVIDIA's free serverless
// queue fluctuates minute to minute, so individual models stall and recover.
// Production only ever calls ROLES (chains with fallback) — that is the gate.
for (const [slot, model] of Object.entries(perKey)) {
  try {
    const out = await pool.callModel(model, PROBE);
    console.log(`  ok  key ${slot}  ${model}  ${out.ms}ms  "${out.content.trim().slice(0, 60)}"`);
  } catch (e) {
    console.log(`  ..  key ${slot}  ${model}  ${e.code || 'error'} (diagnostic only — chains route around this)`);
  }
}

// THE GATE: the full agent team on a realistic schedule fragment — the exact
// path production routes use (engine → team → pool). Master (Gemini) audits
// when GEMINI_API_KEY is present; otherwise it is honestly reported skipped.
const { extractSmart, engineStatus } = await import(pathToFileURL(path.resolve(ROOT, 'api/_lib/extraction/engine.mjs')));
const LINES = [
  'DB-2A DISTRIBUTION BOARD SCHEDULE  MAIN SWITCH 100A',
  '1   32A  B   RCBO  30mA  Kitchen ring final     2.5mm',
  '2   6A   B   MCB          Lighting ground floor  1.5mm',
  '3   40A  C   MCB          Cooker                 6.0mm',
  '4   SPARE',
];
console.log('engine mode:', engineStatus().mode);
try {
  const out = await extractSmart({ textLines: LINES, filename: 'probe.pdf', pageNumber: 1, hints: {}, maxTokens: 12000 });
  const n = (out.result && out.result.devices || []).length;
  console.log(`  ok  TEAM extract → ${out.agents ? out.agents.extractor.model : out.model}: ${n} device rows`);
  if (out.agents && out.agents.second) console.log(`  ok  second opinion → ${out.agents.second.model}; cross-check ${out.verification.status}, ${(out.verification.mismatches || []).length} disagreement(s)`);
  else console.log(`  ..  second opinion: ${out.verification && out.verification.reason || 'n/a'}`);
  console.log(`  ..  master: ${out.master ? out.master.status + (out.master.status === 'reviewed' ? ` (complete=${out.master.complete}, missed=${out.master.missed.length})` : '') : 'n/a'}${out.fallback ? '  [FALLBACK: ' + out.fallback + ']' : ''}`);
  console.log('\nLIVE agent-team probe: PASS (production path answered).');
} catch (e) {
  console.log(`  !!  team exhausted: ${e.code || e.message}${e.attempts ? ' ' + JSON.stringify(e.attempts) : ''}`);
  console.log('\nLIVE agent-team probe: FAIL — every model in the extract chain is unresponsive right now.');
  process.exit(1);
}
