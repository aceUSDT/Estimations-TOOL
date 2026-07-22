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

// THE GATE: one chained role call — the path production actually uses.
try {
  const out = await pool.callRole('extract', PROBE);
  console.log(`  ok  role extract → ${out.model} (${out.ms}ms, ${out.attempts.length} prior attempts)`);
  console.log('\nLIVE NVIDIA pool probe: PASS (role chain answered).');
} catch (e) {
  console.log(`  !!  role extract exhausted: ${JSON.stringify(e.attempts || [])}`);
  console.log('\nLIVE NVIDIA pool probe: FAIL — every model in the extract chain is unresponsive.');
  process.exit(1);
}
