/* Dev tool: render one page of a repo PDF to a JPEG file, using the app's own
 * vendored pdf.js inside headless Chromium (Playwright). Usage:
 *   NODE_PATH=$(npm root -g) node tools/render/page-to-jpeg.mjs <pdf-path> <page> <out.jpg> [longEdge]
 * Requires the preinstalled Playwright + Chromium of the dev environment; it
 * is an operator tool, not part of `npm test` or the shipped app.
 *
 * Resolution guidance from the live vision probes (2026-07-22): dense UK DB
 * schedules need ≥2400px long edge (~200 DPI) — at 1600px the parse model
 * skipped the circuit table entirely.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require_('playwright')); }
catch { ({ chromium } = require_('playwright-core')); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [pdfRel, pageNo = '1', out = 'page.jpg', edge = '2400'] = process.argv.slice(2);
if (!pdfRel) { console.error('usage: page-to-jpeg.mjs <pdf-path> <page> <out.jpg> [longEdge]'); process.exit(2); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.pdf': 'application/pdf' };
const server = createServer(async (req, res) => {
  try {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ executablePath: process.env.RENDER_CHROMIUM || undefined });
try {
  const page = await browser.newPage();
  const url = `http://127.0.0.1:${port}/tools/render/render.html#file=/${pdfRel.replace(/^\//, '')}&page=${pageNo}&edge=${edge}`;
  await page.goto(url);
  await page.waitForFunction(() => window.__dataurl || window.__error, null, { timeout: 60000 });
  const err = await page.evaluate(() => window.__error || null);
  if (err) { console.error('render error:', err); process.exit(1); }
  const dataUrl = await page.evaluate(() => window.__dataurl);
  const b64 = dataUrl.split(',')[1];
  writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log(`rendered ${pdfRel} p${pageNo} → ${out} (${Math.round(b64.length * 0.75 / 1024)} KiB)`);
} finally {
  await browser.close();
  server.close();
}
