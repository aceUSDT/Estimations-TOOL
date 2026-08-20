import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const playwrightSpecifier = process.env.PLAYWRIGHT_CORE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_CORE_PATH).href
  : 'playwright-core';
const { chromium } = await import(playwrightSpecifier);
const appUrl = process.env.APP_URL || 'http://127.0.0.1:8765/?test=1';
const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => candidate && fs.existsSync(candidate));
assert.ok(executablePath, 'No Chromium-compatible browser executable was found');

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const browserErrors = [];
let requestPayload = null;
page.on('pageerror', (error) => browserErrors.push(String(error)));
await page.route('**/api/extract', async (route) => {
  requestPayload = JSON.parse(route.request().postData() || '{}');
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    boards: [{ ref: 'LVS1' }, { ref: 'DB-SCAN-01' }],
    devices: [],
    feeds: [{ from_ref: 'LVS1', to_ref: 'DB-SCAN-01', device_class: 'MCCB', rating_a: 125,
      path_points: '100,857;100,500;800,500;800,143', source_bbox: '70,820,130,900',
      target_bbox: '760,100,850,170', junction_evidence: 'Visible right-angle conductor bends', confidence: 0.9 }],
    flags: [],
  }) });
});

try {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof aiExtractPage === 'function');
  await page.locator('.proj-card.new').click();
  await page.locator('#mName').fill('Scanned schematic regression');
  await page.locator('#mOk').click();
  await page.waitForFunction(() => state.cur?.name === 'Scanned schematic regression');
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1000; canvas.height = 700;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#111'; context.lineWidth = 5; context.beginPath();
    context.moveTo(100, 600); context.lineTo(100, 350); context.lineTo(800, 350); context.lineTo(800, 100); context.stroke();
    context.fillStyle = '#111'; context.font = '28px Arial'; context.fillText('LVS1', 45, 645); context.fillText('DB-SCAN-01', 735, 80);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const fileId = 'scanned-schematic-fixture';
    rawStore[fileId] = await blob.arrayBuffer();
    const sourcePage = { lines: [], w: 1000, h: 700, type: 'schematic', source: 'ocr', needsOcr: false };
    const file = { id: fileId, name: 'scanned-schematic-fixture.png', ext: 'png', status: 'ready', pages: [sourcePage] };
    state.cur.files.push(file);
    window.__aiExecutionMode = 'sync';
    const extracted = await aiExtractPage(file, 1, sourcePage, { timeoutMs: 10000 });
    const accepted = { boards: {}, rows: [], feeders: [] };
    mergeAiResult(accepted, extracted, fileId, 1, 'schematic');
    const rejected = { boards: {}, rows: [], feeders: [] };
    mergeAiResult(rejected, { ...extracted, feeds: [{ ...extracted.feeds[0],
      path_points: '100,857;500,800;900,740' }] }, fileId, 1, 'schematic');
    return {
      acceptedFeeds: accepted.feeders.length,
      acceptedEvidence: accepted.feeders[0]?.pathEvidence || null,
      rejectedFeeds: rejected.feeders.length,
      rejectedFlags: rejected.aiFlags || [],
    };
  });
  assert.ok(requestPayload?.image_base64?.length > 1000, 'the scanned PNG must be attached to enhanced extraction');
  assert.equal(requestPayload?.media_type, 'image/jpeg');
  assert.equal(result.acceptedFeeds, 1, 'a pixel-supported scanned route must be accepted');
  assert.ok(result.acceptedEvidence.rasterCoverage > 0.8, 'accepted scan route must carry strong raster coverage');
  assert.equal(result.acceptedEvidence.crossingPolicy, 'explicit_visual_trace_with_raster_continuity');
  assert.equal(result.rejectedFeeds, 0, 'an unsupported scanned route must be withheld');
  assert.equal(result.rejectedFlags.length, 1, 'withheld scan route must create review evidence');
  assert.match(result.rejectedFlags[0].message, /not continuously supported/i);
  assert.deepEqual(browserErrors, []);
  console.log('PASS: scanned image payload, raster-backed schematic route acceptance, and hallucinated-path rejection.');
} finally {
  await browser.close();
}
