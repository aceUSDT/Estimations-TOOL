import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const required = [
  'id="vFullscreen"',
  'id="vThumbToggle"',
  'id="vInfoToggle"',
  'id="vResizeLeft"',
  'id="vResizeRight"',
  'id="boardListSearch"',
  'id="processingPosition"',
  'function recordRowDecision(',
  'function openBoardInViewer(',
  'function boardApprovalLogHtml(',
  'Enhanced extraction',
  'Protection fields',
  'host.requestFullscreen',
  "document.addEventListener('fullscreenchange'",
  'function syncViewerLayout()',
  'const ANALYSIS_VERSION=4;',
];
required.forEach((value) => assert.ok(html.includes(value), `missing UI contract: ${value}`));
assert.ok(!html.includes('id="vAssistBoard"'), 'viewer must not contain a duplicate board selector');
assert.ok(!html.includes('Match rows'), 'ambiguous Match rows command must not return');
assert.ok(!html.includes('Approve checked rows'), 'bulk approval must not claim rows are checked');

const markup = html.slice(0, html.indexOf('<script'));
const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert.deepEqual([...new Set(duplicates)], [], `duplicate DOM ids: ${duplicates.join(', ')}`);

const inline = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(inline, 'inline application script not found');
new Function(inline);

console.log('PASS: analysis, board-review, approval-log, and viewer UI contracts');
