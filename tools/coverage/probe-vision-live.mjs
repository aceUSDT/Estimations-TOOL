/* LIVE vision/OCR probe — sends a rendered schedule-page IMAGE through the
 * vision_parse chain (row readers) and the layout chain (page zoner), so the
 * registry's `verified` flags stay evidence-based. Not part of `npm test`.
 *
 *   npm run test:vision -- <image.jpg> [expected-rows]
 *
 * Render an input first, e.g.:
 *   NODE_PATH=$(npm root -g) node tools/render/page-to-jpeg.mjs \
 *     examples/db-schedules/bam-epo/EPO_Ashfield_Circuitry-markup.pdf 2 page.jpg 2400
 *
 * Evidence base (2026-07-22, EPO_Ashfield p2 @2400px):
 *   llama-3.1-nemotron-nano-vl-8b-v1 → DB-00-08P, 18 row lines (~107s)  ✅
 *   nemotron-parse → zones only (circuit table returned as Picture bbox) — layout role
 *   nemotron-nano-12b-v2-vl → free-tier queue timeout at probe time
 *
 * Skips cleanly without keys or image. Never prints key material.
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
const load = (p) => import(pathToFileURL(path.resolve(ROOT, p)));
const { createPool, poolStatus, parseModelJson, ROLE_CHAINS } = await load('api/_lib/extraction/nvidia-pool.mjs');
const { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_SCHEMA, coerceResult } = await load('api/_lib/extraction/domain-pack.mjs');
const { buildInstruction } = await load('api/_lib/extraction/providers.mjs');

const [imgPath, expectStr] = process.argv.slice(2);
if (!poolStatus().configured) { console.log('SKIP (not a failure): no NVIDIA keys configured.'); process.exit(0); }
if (!imgPath || !existsSync(imgPath)) { console.log('SKIP (not a failure): pass a rendered page image, e.g. npm run test:vision -- page.jpg 13'); process.exit(0); }

const imageBase64 = readFileSync(imgPath).toString('base64');
console.log(`image: ${imgPath} (${Math.round(imageBase64.length * 0.75 / 1024)} KiB)`);
console.log(`vision chain: ${ROLE_CHAINS.vision_parse.join(' → ')} | layout: ${ROLE_CHAINS.layout.join(' → ')}`);

const req = {
  system: EXTRACTION_SYSTEM_PROMPT,
  prompt: buildInstruction({ filename: path.basename(imgPath), pageNumber: 1, hints: { type: 'db_schedule' }, textLines: [] })
    + '\n\nRespond with ONLY a single JSON object matching this schema (no prose, no code fences):\n'
    + JSON.stringify(EXTRACTION_SCHEMA),
  imageBase64, mediaType: 'image/jpeg', maxTokens: 12000,
};

const pool = createPool();   // per-model timeouts come from the registry

/* Survey every row reader individually — this probe's job is evidence. */
const winners = [];
for (const model of ROLE_CHAINS.vision_parse) {
  try {
    const out = await pool.callModel(model, req);
    const parsed = coerceResult(parseModelJson(out.content) || {});
    const devices = Array.isArray(parsed.devices) ? parsed.devices : [];
    const boards = (parsed.boards || []).map((b) => b.ref).join(',');
    winners.push({ model, rows: devices.length });
    console.log(`  ok  ${model}  ${out.ms}ms — boards [${boards}], ${devices.length} rows`);
  } catch (e) {
    console.log(`  ..  ${model}  ${e.code || 'error'}`);
  }
}

/* Layout zoner: report the zones it sees (bbox elements). */
try {
  const out = await pool.callRole('layout', { imageBase64, mediaType: 'image/jpeg', maxTokens: 8000 });
  let zones = [];
  try { zones = JSON.parse(out.content)[0].map((e) => e.type); } catch { /* shape drift → raw */ }
  console.log(`  ok  layout ${out.model}  ${out.ms}ms — zones: ${zones.join(', ') || out.content.slice(0, 80)}`);
} catch (e) {
  console.log(`  ..  layout  ${e.code || 'error'}`);
}

if (!winners.length) { console.log('\nLIVE vision probe: FAIL — no vision model returned rows.'); process.exit(1); }
const expected = Number(expectStr || 0);
for (const w of winners) {
  console.log(`  →  ${w.model}: ${w.rows} rows${expected ? (w.rows >= expected ? ` (≥ expected ${expected} ✓)` : ` (BELOW expected ${expected})`) : ''}`);
}
console.log('\nLIVE vision probe: PASS (at least one vision model reads the page).');
