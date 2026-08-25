import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../review-core.js', import.meta.url), 'utf8');
const context = { globalThis: {}, window: {} };
vm.runInNewContext(source, context);
const core = context.globalThis.EstimationReviewCore;

const rows = [
  { id: 'a1', boardNorm: 'DB-A' },
  { id: 'a2', boardNorm: 'DB-A' },
  { id: 'b1', boardNorm: 'DB-B' },
];
const started = core.startSession(rows, '2026-08-25T10:00:00Z');
assert.equal(started.currentRowId, 'a1');
assert.deepEqual([...started.boardOrder], ['DB-A', 'DB-B']);
assert.equal(started.initialByBoard['DB-A'], 2);

const sameBoard = core.nextSession(started, rows.slice(1), rows[0], '2026-08-25T10:01:00Z');
assert.equal(sameBoard.currentRowId, 'a2');
const nextBoard = core.nextSession(sameBoard, rows.slice(2), rows[1], '2026-08-25T10:02:00Z');
assert.equal(nextBoard.currentRowId, 'b1');

const restored = core.restoreSession({ ...nextBoard, currentRowId: 'already-approved' }, [rows[2]], '2026-08-25T10:03:00Z');
assert.equal(restored.currentRowId, 'b1');
assert.equal(restored.active, true);
assert.equal(restored.moving, false);

const renamed = core.renameBoard(restored, 'DB-B', 'DB-B-NEW');
assert.ok(renamed.boardOrder.includes('DB-B-NEW'));
assert.ok(!renamed.boardOrder.includes('DB-B'));
assert.deepEqual(core.nextSession(renamed, [], rows[2]), core.emptySession());

console.log('PASS: durable guided-review state machine, board ordering, restore, and rename');
