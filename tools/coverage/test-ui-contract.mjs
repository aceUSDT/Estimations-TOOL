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
  'const ANALYSIS_VERSION=7;',
  'data-report-mode="board"',
  'data-action="edit"',
  "openRowEditor(d.r,false,'Viewer')",
  "bbox:r.highlightBbox||r.bbox",
  "'RCD Protection':evidence",
  'id="guidedReviewBtn"',
  'id="vReviewBar"',
  'function orderedPendingReviewRows()',
  'function reviewBoardSourceTuple(',
  'function guidedReviewBoardKeys(',
  'function advanceGuidedReview(',
  'const sameBoard=queue.filter(',
  'function viewerBoardsOnPage(',
  'function viewerBoardOnPage(',
  'function syncViewerBoardToPage(',
  'syncViewerBoardToPage(f,V.page);',
  'Review from first board',
  'Board ${Math.min(boardOrder.length,boardPosition+1)} of ${boardOrder.length}',
  'function openReportSources(',
  'data-report-source-key',
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

console.log('PASS: analysis, guided review, report-source, approval-log, and viewer UI contracts');
