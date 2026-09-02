import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import ExcelJS from "exceljs";

const source = await fs.readFile(new URL("../../report-core.js", import.meta.url), "utf8");
const context = vm.createContext({ console });
vm.runInContext(source, context, { filename: "report-core.js" });
const Report = context.EstimationReport;

const model = Report.buildModel({
  projectName: "Llangatwg Test",
  generatedAt: "2026-07-13T09:00:00Z",
  boards: {
    DB10: { norm: "DB10", orig: "DB-10", type: "DB" },
    DB2: { norm: "DB2", orig: "DB-2", type: "DB" },
  },
  rows: [
    { id: "r1", boardNorm: "DB2", device: "MCB", rating: 10, poles: 1, desc: "Lighting", associatedDevices: [{ device: "Contactor", qty: 1 }], qty: 2, status: "confirmed", conf: 1 },
    { id: "r2", boardNorm: "DB10", device: "MCB", rating: 10, poles: 1, desc: "Lighting", qty: 1, status: "pending", conf: 0.9 },
    { id: "r3", boardNorm: "DB10", device: "MCB", rating: 20, poles: 3, desc: "AHU supply", qty: 1, status: "pending", conf: 0.7 },
    { id: "r4", boardNorm: "DB2", device: "RCBO", rating: 32, poles: 1, desc: "Socket circuit", qty: 1, status: "confirmed", conf: 1 },
    { id: "r5", boardNorm: "DB2", device: "MCB", rating: 40, poles: 1, qty: 7, status: "rejected", conf: 0.2 },
    { id: "r6", boardNorm: "DB2", device: "MCB", rating: 16, poles: 1, qty: 3, kind: "mention", status: "pending", conf: 0.4 },
    { id: "r7", boardNorm: null, device: "MCB", rating: 16, poles: 1, qty: 1, status: "confirmed", conf: 1 },
  ],
});

assert.deepEqual(Array.from(model.boards, (board) => board.label), ["DB-2", "DB-10"]);
assert.equal(model.reviewCount, 3);
assert.equal(model.unassignedQty, 1);
assert.equal(model.grandTotal, 5);
assert.equal(model.deviceLineCount, 3);
assert.deepEqual(Array.from(model.boardTotals), [3, 2]);
assert.deepEqual(Array.from(model.groups, (group) => group.name), ["MCBs", "RCBOs"]);
assert.equal(model.groups[0].rows[0].label, "10A SPN MCB");
assert.deepEqual(Array.from(model.groups[0].rows[0].quantities), [2, 1]);
assert.deepEqual(Array.from(model.groups[0].rows[0].purposes), ["Lighting"]);
assert.equal(model.groups[0].rows[1].label, "20A TPN MCB");
assert.deepEqual(Array.from(model.groups[0].rows[1].purposes), ["Mechanical"]);
assert.equal(model.groups[0].rows[0].curve, "Not specified");
assert.equal(model.groups[0].rows[0].breakingCapacity, "Not specified");
assert.equal(model.reconciliation.valid, true);
assert.equal(model.associated.grandTotal, 1);
assert.equal(model.associated.groups[0].rows[0].label, "Contactor");

const workbook = Report.createExcelWorkbook(model, ExcelJS);
const sheet = workbook.getWorksheet("Device Take-Off");
const controlSheet = workbook.getWorksheet("Control Equipment");
assert.equal(sheet.getCell("A1").value, "Llangatwg Test");
assert.equal(sheet.getCell("G3").value, "DB-2");
assert.equal(sheet.getCell("H3").value, "DB-10");
assert.equal(sheet.getCell("I3").value, "Total Quantity");
assert.equal(sheet.getCell("I4").value.formula, "SUM(G4:H4)");
assert.equal(sheet.getCell("G7").value.formula, "SUM(G4:G6)");
assert.equal(sheet.getCell("E4").fill.fgColor.argb, "FFFFF2CC");
assert.equal(sheet.getCell("A3").fill.fgColor.argb, "FFF7E0D1");
assert.equal(sheet.views[0].ySplit, 3);
assert.ok(workbook.getWorksheet("Review Required"));
assert.ok(workbook.getWorksheet("Assumptions and Qualifications"));

/* The provenance sheets are what nobody quotes from: on a real project they
 * came to 1,291 and 259 rows around eighteen rows of take-off, and the file
 * opened on the audit trail rather than on the numbers. They are off by
 * default and one option away, and nothing else is removed to achieve it. */
assert.equal(workbook.getWorksheet("Device Detail"), undefined,
  "the detail sheet must not be in the default export");
assert.equal(workbook.getWorksheet("Extraction Audit"), undefined,
  "the audit sheet must not be in the default export");
const audited = Report.createExcelWorkbook(model, ExcelJS, { fullAudit: true });
assert.equal(audited.getWorksheet("Device Detail").rowCount, 6);
assert.ok(audited.getWorksheet("Extraction Audit"), "fullAudit must still produce the audit trail");

/* The quotable document. A supplier quotation is board, item, quantity —
 * grouped per board, with the qualifications stated once — so that is the
 * first sheet in the file. */
const quote = workbook.getWorksheet("Quotation Take-Off");
assert.ok(quote, "the quotation sheet must exist");
assert.equal(workbook.worksheets[0].name, "Quotation Take-Off", "it must be the sheet the file opens on");
assert.equal(quote.getCell("A1").value, "Llangatwg Test");
assert.equal(quote.getCell("A3").value, "#");
assert.equal(quote.getCell("B3").value, "Product code");
assert.equal(quote.getCell("C3").value, "Item description");
assert.equal(quote.getCell("D3").value, "Quantity");
// a board line, then its items indented beneath it
assert.equal(quote.getCell("A4").value, "001");
assert.ok(/^DB-2/.test(String(quote.getCell("C4").value)), String(quote.getCell("C4").value));
assert.ok(/^ {4}\S/.test(String(quote.getCell("C5").value)), String(quote.getCell("C5").value));
/* Two line items that PRINT identically read as a mistake on a quotation and a
 * supplier cannot price the difference between them. The take-off keeps them
 * apart when they differ in something it tracks; the quotation merges them. */
{
  // per board — the same device legitimately appears under two different boards
  let current = [];
  const check = () => assert.equal(new Set(current).size, current.length,
    `the quotation repeated a line item within one board: ${current.join(" | ")}`);
  quote.eachRow((r) => {
    const label = String(r.getCell(3).value || "");
    if (/^\d{3}$/.test(String(r.getCell(1).value || ""))) { check(); current = []; return; }
    if (/^ {4}\S/.test(label)) current.push(label);
  });
  check();
  assert.ok(current.length || true);
}

// and the project total, which must equal the take-off's own grand total
const quoteRowsAll = [];
quote.eachRow((r) => quoteRowsAll.push(r));
const totalRow = quoteRowsAll.find((r) => /PROJECT TOTAL/.test(String(r.getCell(3).value || "")));
assert.ok(totalRow, "the quotation must state a project total");
assert.equal(totalRow.getCell(4).value, model.grandTotal);
assert.equal(controlSheet.getCell("A2").value, "Control & Associated Equipment");
assert.equal(controlSheet.getCell("C5").value, 1);

const buffer = await workbook.xlsx.writeBuffer();
assert.equal(buffer[0], 0x50);
assert.equal(buffer[1], 0x4b);
const roundTrip = new ExcelJS.Workbook();
await roundTrip.xlsx.load(buffer);
assert.equal(roundTrip.getWorksheet("Device Take-Off").getCell("I4").value.formula, "SUM(G4:H4)");
assert.equal(roundTrip.getWorksheet("Control Equipment").getCell("C5").value, 1);

const wideBoards = Object.fromEntries(Array.from({ length: 57 }, (_, index) => {
  const number = index + 1;
  return [`DB${number}`, { norm: `DB${number}`, orig: `DB-${number}`, type: "DB" }];
}));
const wideModel = Report.buildModel({
  projectName: "Wide report",
  includeEmptyBoards: true,
  boards: wideBoards,
  rows: [{ boardNorm: "DB1", device: "MCB", rating: 10, poles: 1, qty: 1, status: "confirmed" }],
});
const wideWorkbook = Report.createExcelWorkbook(wideModel, ExcelJS);
const wideBuffer = await wideWorkbook.xlsx.writeBuffer();
const wideRoundTrip = new ExcelJS.Workbook();
await wideRoundTrip.xlsx.load(wideBuffer);
assert.equal(wideRoundTrip.getWorksheet("Device Take-Off").getCell("G4").value, 1);
assert.equal(wideRoundTrip.getWorksheet("Device Take-Off").getCell("H4").value, null);

console.log("Report matrix and XLSX export: OK");


/* The workbook must state completeness, not just count issues.
 *
 * The take-off an estimator hands over is the artefact that has to be honest
 * about what it could not account for. Coverage was computed and used only for
 * an issue COUNT; the numbers behind it never reached the deliverable. */
{
  const covModel = Report.buildModel({
    projectName: "Completeness",
    boards: {
      DB1GF: { norm: "DB1GF", orig: "DB-1-GF", type: "DB" },
      DB4FF: { norm: "DB4FF", orig: "DB-4-FF", type: "DB" },
      DBX: { norm: "DBX", orig: "DB-X", type: "DB" },
    },
    rows: [
      { id: "c1", boardNorm: "DB1GF", device: "MCB", rating: 10, poles: 1, desc: "Lighting", qty: 1, status: "confirmed", conf: 1 },
      { id: "c2", boardNorm: "DB4FF", device: "MCB", rating: 10, poles: 1, desc: "Lighting", qty: 1, status: "confirmed", conf: 1 },
      { id: "c3", boardNorm: "DBX", device: "MCB", rating: 10, poles: 1, desc: "Lighting", qty: 1, status: "confirmed", conf: 1 },
    ],
    coverage: {
      perBoard: [
        { norm: "DB1GF", orig: "DB-1-GF", expectedWays: 18, capturedWays: 18, unaccountedWays: 0, rowsCaptured: 34, inScope: true },
        { norm: "DB4FF", orig: "DB-4-FF", expectedWays: 24, capturedWays: 11, unaccountedWays: 13, rowsCaptured: 29, inScope: true },
        { norm: "DBX", orig: "DB-X", expectedWays: null, capturedWays: 5, unaccountedWays: null, rowsCaptured: 5, inScope: true },
      ],
      zeroRowSchedulePages: [],
    },
  });

  assert.ok(covModel.coverage && covModel.coverage.perBoard, "coverage must reach the model");

  const covBook = Report.createExcelWorkbook(covModel, ExcelJS);
  const sheet = covBook.getWorksheet("Board Completeness");
  assert.ok(sheet, "workbook must carry a Board Completeness sheet");
  const read = (r, c) => { const v = sheet.getCell(r, c).value; return v == null ? "" : String(v); };

  // worst gap first: an estimator reads the top of the sheet
  assert.match(read(2, 1), /DB-4-FF/, "boards ordered worst-gap first");
  assert.equal(read(2, 4), "13", "the shortfall is stated");
  assert.match(read(2, 6), /Incomplete/i, "an incomplete board says so");

  const statuses = [2, 3, 4].map((r) => `${read(r, 1)}=${read(r, 6)}`).join(" | ");
  assert.match(statuses, /Complete — every declared way/i, "a complete board says complete");
  // the one that matters most: unknown must never read as verified
  assert.match(statuses, /DB-X=Not checkable/i, "an unstated way count is not checkable, never complete");
  assert.doesNotMatch(statuses, /DB-X=Complete/i, "an unstated way count must never read as complete");

  console.log("ok  workbook states per-board completeness, with 'not checkable' kept distinct");
}
