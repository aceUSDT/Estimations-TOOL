import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const source = await fs.readFile(new URL("../../decision-core.js", import.meta.url), "utf8");
const context = vm.createContext({ console, Date, Math, JSON });
vm.runInContext(source, context, { filename: "decision-core.js" });
const DecisionCore = context.EstimationDecisionCore;

const geometricKey = DecisionCore.canonicalRowSourceKey({
  fileId: "file-1", page: 2, line: 7, bbox: [10, 20, 30, 40], srcText: "OCR wording A",
});
assert.equal(geometricKey, DecisionCore.canonicalRowSourceKey({
  fileId: "file-1", page: 2, line: 7, bbox: [10, 20, 30, 40], srcText: "OCR wording B",
}), "geometry-backed source identities must survive OCR wording changes");
assert.notEqual(DecisionCore.canonicalRowSourceKey({ fileId: "file-1", page: 2, srcText: "row A" }),
  DecisionCore.canonicalRowSourceKey({ fileId: "file-1", page: 2, srcText: "row B" }),
  "text must remain the fallback identity when no geometry or line anchor exists");

const project = { approvalLog: [{ boardNorm: "DB-OLD" }] };
const row = {
  id: "row-1", boardNorm: "DB-OLD", device: "MCB", rating: 20, phase: "L1",
  srcText: "L1 MCB C 20", fieldEvidence: {}, corrections: [],
};
const rowResult = DecisionCore.applyRowPatch(project, row, {
  rating: 32, phase: "L2", device: "RCBO", protectionCode: "C32/30mA",
  earthFaultDevice: "Integral", arcFlashDevice: "Not fitted", circuitReference: "L2-01",
  circuitConfig: "Radial", serviceCode: "L", discipline: "Lighting", cable: "2.5 mm2 LSF",
}, { surface: "Viewer", reason: "Estimator correction", transactionId: "tx-row" });
assert.deepEqual(Array.from(rowResult.changedFields), [
  "Current Rating", "Phase", "Device Family", "Protection Code", "Earth Fault Device",
  "Arc Flash Device", "Circuit Reference", "Circuit Configuration", "Service Code", "Discipline", "Cable Details",
]);
assert.equal(row.rating, 32);
assert.equal(row.corrections.length, 11);
assert.equal(project.correctionLog.length, 11);
assert.ok(row.corrections.every((item) => item.transactionId === "tx-row" && item.createdAt));
assert.equal(row.fieldEvidence["Current Rating"].method, "User correction");

const analysis = {
  boards: {
    "DB-OLD": { norm: "DB-OLD", orig: "DB OLD", type: "DB", parent: "MDB", header: { board_rating_a: 100 }, pages: [] },
    MDB: { norm: "MDB", orig: "MDB", header: {}, pages: [] },
    CHILD: { norm: "CHILD", orig: "CHILD", parent: "DB-OLD", header: { fed_from_ref: "DB-OLD" }, pages: [] },
  },
  rows: [row],
  cables: [{ boardNorm: "DB-OLD" }],
  feeders: [{ from: "MDB", to: "DB-OLD" }, { from: "DB-OLD", to: "CHILD" }],
  discrepancies: [{ boardNorm: "DB-OLD", schematicBoard: "DB-OLD" }],
};
const boardResult = DecisionCore.applyBoardPatch(project, analysis, "DB-OLD", {
  norm: "DB-NEW",
  orig: "DB-NEW",
  family: "distribution_board",
  header: {
    board_rating_a: 125, ways_total: 12, phase_config: "TPN", job_reference: "JOB-42",
    supply_cpd_class: "MCCB", supply_cpd_standard: "BS EN 60947-2", board_model: "Invicta 3",
    metering: "Integral", board_family_reason: "Printed panelboard designation",
  },
}, { transactionId: "tx-board" });
assert.equal(boardResult.boardNorm, "DB-NEW");
assert.equal(analysis.boards["DB-OLD"], undefined);
assert.equal(analysis.boards["DB-NEW"].header.board_rating_a, 125);
assert.equal(analysis.boards["DB-NEW"].header.supply_cpd_standard, "BS EN 60947-2");
assert.equal(analysis.boards["DB-NEW"].familyConfidence, 1);
assert.equal(row.boardNorm, "DB-NEW");
assert.equal(analysis.cables[0].boardNorm, "DB-NEW");
assert.equal(analysis.feeders[0].to, "DB-NEW");
assert.equal(analysis.feeders[1].from, "DB-NEW");
assert.equal(analysis.boards.CHILD.parent, "DB-NEW");
assert.equal(project.approvalLog[0].boardNorm, "DB-OLD", "historical decisions must retain their original board reference");
assert.equal(project.approvalLog[0].canonicalBoardNorm, "DB-NEW", "current grouping follows the canonical board alias");
assert.ok(project.correctionLog.filter((item) => item.boardNorm === "DB-OLD")
  .every((item) => item.canonicalBoardNorm === "DB-NEW"), "historical row corrections retain their original reference and current alias");
assert.throws(() => DecisionCore.applyBoardPatch(project, analysis, "DB-NEW", { norm: "MDB" }), /already uses/);

console.log("decision-core: correction ledger and board reference propagation passed");
