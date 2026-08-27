import assert from 'node:assert/strict';
import { attachPerceptionContract, buildPerceptionContract, PERCEPTION_CONTRACT_VERSION } from '../../netlify/functions/lib/perception-contract.mjs';

const direct = {
  provider: 'gemini',
  model: 'gemini-test',
  classification: { type: 'db_schedule', confidence: 0.9 },
  boards: [{ ref: 'DB-A', confidence: 0.95, bbox: [10, 10, 80, 20] }],
  devices: [{ board_ref: '', device_class: 'MCB', rating_a: '', confidence: 0.7, bbox: [10, 40, 500, 18] }],
  feeds: [],
  flags: [],
};
const contract = buildPerceptionContract(direct, { filename: 'fixture.pdf', pageNumber: 2 });
assert.equal(contract.version, PERCEPTION_CONTRACT_VERSION);
assert.equal(contract.counts.devices, 1);
assert.equal(contract.evidenceCoverage.withCoordinates, 2);
assert.equal(contract.validation.status, 'review_required');
assert.ok(contract.validation.reasonCodes.includes('device_without_board_reference'));
assert.ok(contract.validation.reasonCodes.includes('device_rating_missing'));

const ownershipConflict = buildPerceptionContract({
  boards: [{ ref: 'DB-02' }],
  devices: [{ board_ref: 'DB-02', device_class: 'MCCB', rating_a: 160 }],
  feeds: [], flags: [],
}, { filename: 'trimble.pdf', pageNumber: 1, hints: { deterministic_primary_board: '01 MAIN LV SWITCHBOARD' } });
assert.ok(ownershipConflict.validation.reasonCodes.includes('board_ref_conflicts_with_primary'));
assert.equal(ownershipConflict.validation.deterministicPrimaryBoard, '01 MAIN LV SWITCHBOARD');

const wrapped = attachPerceptionContract({
  result: { boards: [{ ref: 'DB-B' }], devices: [], feeds: [], flags: [] },
  provider: 'nvidia+gemini', model: 'layout-model', verification: { status: 'done' },
}, { filename: 'fixture.pdf', pageNumber: 3 });
assert.equal(wrapped.contract.provider.name, 'nvidia+gemini');
assert.equal(wrapped.result.contract.version, PERCEPTION_CONTRACT_VERSION);
assert.equal(wrapped.verification.status, 'done');
assert.ok(!JSON.stringify(wrapped.contract).includes('source OCR text'));

console.log('PASS: provider-neutral perception contract, provenance coverage, and deterministic review reasons');
