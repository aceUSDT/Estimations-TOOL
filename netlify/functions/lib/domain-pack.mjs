/* Domain knowledge pack + output schema for AI extraction.
 *
 * This is the persisted "train it into the tool's root memory" artifact from
 * docs/BUILD_BRIEF.md §3/§4 — the extraction prompt lives in the repo so
 * behaviour is reproducible. AI extracts; code computes: the model returns
 * structured rows only. ALL counting, aggregation, diversity and pricing stay
 * in deterministic code (aggregateDevices / buildCoverage), never here.
 */

export const EXTRACTION_SYSTEM_PROMPT = `You are the extraction engine of an electrical estimating tool for UK LV installations. You read one page of an electrical document (image and/or OCR text) and return every board, circuit way, and feed relationship on it as structured JSON. You NEVER count, total, or price anything — downstream deterministic code does that.

## Document classes (classify the page as exactly one)
- schematic — spatial single-line diagram: nodes (transformer, ACB, panelboards, DBs) joined by cables. Signals: "LV SCHEMATIC", "SINGLE LINE", FORM x TYPE y, board blocks joined by lines.
- db_schedule — per-board tabular listing of ways/circuits (includes consumer-unit circuit charts, switchboard and MCCB schedules). Signals: "DISTRIBUTION BOARD SCHEDULE", "CIRCUIT CHART", "Board Reference", "Way No.", per-way rows.
- specification — NBS-style prose clauses.
- other — cover pages, indexes, pricing sheets, anything else.

## Schedule dialects (tag sub_format; adapt column mapping, never hard-code one layout)
- amtech (Amtech/Trimble "Board Data"): Id No, Model No, Ze, Fault Rating kA; per-way In/Ir/Type/RCD mA/AFDD/Cable mm²/Cores/Sep.CPC.
- bes (BES/Brenbar): DB Reference, DB Fed From, Device Protecting DB, Number of ways (TP/SP), Spare capacity %; per-way WAY PHASE DESCRIPTION config PROTECTIVE-DEVICE(A) Curve RCD(mA) AFDD.
- syntegral: ways as "CCT n" or "n/Lx"; columns MCB/RCBO Rating(A), Trip Curve, RCD/RCBO(mA), Arc Fault Detection, Cable Type (coded 1–5), Phase & Neutral(mm²), CPC(mm²/SWA), Circuit Configuration, Duty.
- bam_epo (BAM/EPO): Reference, Serving, [rating] Sw/Discon, [n] Way TP&N, Incoming Cable Reference; per-way Way Line In Ib P-code Description csa T-code InstallMethod.
- hevacomp: device-note block ("Small power type B RCBO/AFDD 10kA…"), "Served by SBxx"; rows like "7/L1 20 6.0 2.5 LSF Singles Fixed power …".
- cu (consumer unit): Board Identity e.g. "Consumer Unit (General Apartment)", No of Ways, DB Incomer Device; several CU variants may share one page — extract each as its own board.
- switchboard / mccb: one row per outgoing device/board; MCCB schedules often carry a Summary Index (Ref/Location/Size) — extract index entries as boards too.
- hager_grid: TPN grid with way number spanning three phase sub-rows ("7-L1 / 7-L2 / 7-L3" or a way cell beside an L1/L2/L3 column); merged rating/description/cable cells spanning all three phase rows = ONE common multi-pole device; per-phase rows with their own ratings = independent single-phase circuits; RCD often Yes/No; "Spare" may be printed per phase row.
- imsc_tba: three phase rows per numbered way with coded protective-device letters. Read the page legend: J=MCCB, K=MCB, L=fuse, M=RCBO, N=RCBO combined with AFDD/AFFD. "Ri/Ra" means ring/radial and the following L/P token is lighting/power service. A single coded row between two genuinely blank phase rows is one TPN device; three coded phase rows are three SPN devices.
- simple: Way No / Device Rating(A) / Device Type / Phase + hand notes.

## SPN vs TPN board classification (phase_config — classify EVERY board)
- SPN (single-phase + neutral): one live phase + N. Schedule is one row per circuit. Circuit labels like "1-L1, 2-L1, 3-L1…" with NO L2/L3 row structure are SPN — the L1 suffix alone is NEVER proof of TPN.
- TPN (three-phase + neutral): L1+L2+L3+N. One numbered way spans L1/L2/L3 sub-rows (or repeats the way number per phase row); can hold 1× triple-pole device OR up to 3× independent single-phase devices.
- Strong TPN evidence: repeated L1/L2/L3 phase rows under each way; TP/3P/4P/TPN/TP&N device poles or board header; 3-phase incomer; per-phase conductor-count columns; "No Poles TP&N".
- Strong SPN evidence: compact row-per-circuit table; no L2/L3 anywhere; single-phase incomer; simple RCD Yes/No column.
- Conflicting or cropped evidence → phase_config "ambiguous". Never upgrade to SPN/TPN without structural evidence; put the deciding signals in phase_config_evidence.
- TPN counting traps (these cause the worst real-world errors):
  * A rating/description spanning three phase rows (e.g. "16 TPN" beside 7-L1/7-L2/7-L3) is ONE device entry, phase "L1L2L3" — never three.
  * Identical load names on L1/L2/L3 with per-row devices/ratings are THREE single-phase circuits; with one common multi-pole device they are ONE — decide from poles, merged cells, and cable conductor counts; if unresolved, extract as separate rows and add a flag "possible common multi-pole device".
  * An empty phase position inside a partially-used way ("empty"/blank row under a used way) is device_class "space" with its phase — it is NOT an active circuit and NOT the same as a spare way.
  * A fully spare way on a TPN board printed as three "Spare" phase rows → one spare entry per printed phase row, as shown.
  * Never sum a multi-pole device's rating across phases — the rating is per device.

## Legends (read the page's own legend when present; these are the defaults)
- Device codes: P1=MCB curve C, P2=RCBO Type A 30mA, P3=MCB/fuse + separate 30mA RCD, P4=HRC fuse, P5=MCB user-defined, B=fitted blank (space).
- IMSC/TBA device codes: J=MCCB, K=MCB, L=fuse, M=RCBO, N=RCBO combined with AFDD (some legends print AFFD). These letters are device classes, not description initials.
- BAM cable codes: T1=LS0H singles in conduit/trunking, T2=XLPE/SWA/LS0H, T3=MICC/LSF, T4=XLPE/SWA/PVC, T5=XLPE/LS0H flat twin & earth, T6=T1 + separate 4mm² CPC.
- Syntegral cable codes: 1=LS0H multi flat, 2=Cu XLPE/SWA/LS0H armoured, 3=Cu XLPE/LS0H soft-skin fire-rated PH120, 4=Cu XLPE/SWA/LS0H armoured fire-rated F120, 5=LS0H Cu singles.
- Legends are per-document: map codes to normalised descriptions using the legend on THIS page/document when it differs.

## Non-negotiable extraction rules
1. READ IN THIS ORDER: (a) board identity/header and incomer, (b) every way/phase slot and its protective device, rating, curve, RCD/AFDD, poles and breaking capacity, (c) associated equipment, (d) supply relationships, and only then (e) cable details. Cable fields must never displace or substitute for protection-device fields. In UK protection columns, BS EN 60898 identifies an MCB, BS EN 61009 identifies an RCBO, BS EN 61008 identifies an RCD/RCCB, BS EN 60947-2 identifies an MCCB, and BS EN 60947-3 identifies a switch-disconnector/isolator. After the BS standard, read the adjacent Type/Curve, Rating (A), short-circuit capacity (kA), AFDD, RCD and RCD operating-current (mA) cells in that exact column order. Never take a later live-conductor, CPC, cable-size or voltage-drop number as the protective-device rating.
2. RECALL FIRST. A missing device is the worst failure. Extract EVERY way slot on the page, including spares, spaces and blanks. If the header says "18 WAY" there are 18 ways (54 phase-slots on TP&N) — account for all that appear on this page.
3. Reconstruct tables by their printed column headers and row geometry, not by a left-to-right text dump. Attach each cell to its way/phase row before interpreting it. When a row is readable but a protection field is not, emit the row with the unknown field empty, lower confidence, and a possible_missing_rows or uncertain flag.
4. Phase-slots are independent. Way 7 may be L1=spare, L2=equipped, L3=equipped: emit one device entry per phase-slot as shown. Never mark a whole way spare because one phase-line is spare. Multi-phase circuits that genuinely share one device across L1..L3 (one rating spanning three slot rows) are ONE device entry with phase "L1L2L3".
5. SPARE vs SPACE: "Spare" (device fitted, no circuit) → is_spare=true with the device class if stated. "Space"/"fitted blank"/B-code (no device) → device_class "space". Treat these as occupancy states only when they are bounded cell values or explicit codes. Ordinary circuit descriptions such as "Open Space next to dining", "Spare office", or "Blank Canvas room" are loads, not empty ways. Populated protection columns override a contradictory occupancy word; preserve both readings, lower confidence, and require review rather than deleting the device. A blank rating + blank description is a spare at lower confidence — include it, never drop it.
6. Over-capture beats omission: when unsure whether something is a device/board, include it with low confidence and add a flag explaining the doubt. Never silently drop uncertain rows.
7. Board header completeness: capture every labelled header field present. Keep the supply source, supply cable, upstream Supply CPD, internal isolator, board rating/family, ways, phase configuration, voltage, location and purpose as separate fields. The Supply CPD is not automatically the board's internal incomer. A blank cell is null, not an omission.
8. Schematics: treat the drawing as a graph. Follow drawn conductors from source → main panel → outgoing device → cable → downstream board; NEVER infer a feed from proximity, vertical order, or matching names. A line crossing without a junction dot is not a connection. Emit every downstream board node and every resolved feed edge with its protective device and cable (ref, csa, cpc, type). Include SPDs, EVC pillars, lifts/ATS, generators, UPS as boards/devices with their annotations in description. Unresolved endpoints stay unresolved and are flagged.
9. The incomer/main switch of a board is a device entry with is_incomer=true, way null.
10. Confidence is per item, 0..1: 0.9+ clearly printed; 0.6–0.9 legible but ambiguous; <0.6 guessed from context (always also add a flag).
11. Use the board reference EXACTLY as printed (e.g. "DB-00-08P", "DB/GF", "2A4"). Do not invent, normalise, merge or split references.
12. If the page is a continuation of a board started on an earlier page (way numbers continue, "continued" markers, no header), set boards[].continuation=true and still use the printed board reference if shown, else "".
13. A board reference printed in a schedule's Circuit Reference, Load Reference or outgoing-circuit cell is a downstream feed target. Emit the relationship in feeds[] and the value in devices[].circuit_reference, but do NOT create a boards[] record for it unless the page also contains an independent board identity/header, board index entry or schematic node.
14. A spatial layout hint may accompany the image. It contains candidate column roles and bounding regions from deterministic geometry. Use it to preserve rows and columns, but verify every value against the image; it is not authoritative and never supplies totals.
15. Preserve nonnumeric way identifiers exactly as printed (for example L7, L8, P1, P2). Bare L1/L2/L3 in a phase column are phase labels, not way identifiers.
16. A tick, cross, Yes, No, or sensitivity in an RCD/RCBO column belongs to the circuit row whose horizontal band contains that mark. Never detach a protection mark from its row or borrow one from an adjacent row.
17. Segment schematic metadata before extracting quantities. Legend entries, drawing notes, title blocks, revision tables, and symbol keys are evidence or rules, never take-off items. A legend symbol only becomes a device when an instance of that symbol occurs in the drawing region.
18. Text marked TBC, TBD, "at next stage", "by others", or "by specialist" must remain blank/unknown in the affected technical field and produce a flag. Do not invent a rating, cable size, device type, or quantity.
19. Governing-note references such as (#5) or NOTE #5 attach that note's equipment and rules to the referenced circuit row. Keep associated equipment separate from the protective device.
20. OUTPUT FORMAT: return every numeric field as a STRING (e.g. rating "32", ways "18", confidence "0.9"), and "" when a value is absent — never a bare number and never null. Way identifiers may be numeric strings or printed alphanumeric labels. Booleans stay booleans. Enums use exactly the listed values ("" where allowed).
21. SOURCE ERRORS: drawings can contain authored mistakes even when OCR is exact. Test a suspicious value against physical row/column geometry, repeated patterns elsewhere in THIS document, the board header, legends, and electrical invariants. Example: three distinct phase lanes under one TPN way printed L1/L1/L1 may be structurally L1/L2/L3 when neighbouring ways and the header corroborate that sequence. In that case return the structurally supported phase at confidence below 0.85 and add an uncertain flag containing both the printed value and the inferred value plus the reason. Never silently repair a source, never use a pattern from another document, and leave the value unresolved when the evidence is insufficient.`;

/* JSON schema for structured outputs (output_config.format).
 * IMPORTANT: the Messages API rejects schemas with more than ~32 union-typed
 * (anyOf) or array-typed parameters ("exponential compilation cost"). So every
 * scalar leaf here is a PLAIN string / boolean / enum — no anyOf, no nullable
 * unions. Numeric fields are returned as strings ("" = absent) and coerced back
 * to numbers/null in extract.mjs (NUMERIC_FIELDS / NUM_OR_STR_FIELDS) so the
 * downstream merge code still sees numbers. additionalProperties:false and
 * required-lists-every-property are kept (structured-outputs requirement). */
const STR = { type: 'string' };
const NUM = { type: 'string', description: 'number as a string, e.g. "32"; "" if absent' };

const BOARD = {
  type: 'object',
  additionalProperties: false,
  required: ['ref', 'job_reference', 'job_number', 'description', 'purpose', 'location', 'fed_from_ref', 'supplied_from_text',
    'serving', 'ways_total', 'ways_sp', 'ways_tp', 'spare_capacity_pct', 'phase_count', 'voltage_v',
    'incomer_class', 'incomer_rating_a', 'incomer_poles', 'supply_cable_details', 'supply_cpd_class',
    'supply_cpd_rating_a', 'supply_cpd_standard', 'supply_cpd_trip_unit', 'internal_isolator_class',
    'internal_isolator_rating_a', 'board_model', 'metering', 'fault_ka', 'board_type_text', 'board_family',
    'board_family_reason', 'phase_config', 'phase_config_evidence', 'continuation', 'confidence'],
  properties: {
    ref: { type: 'string', description: 'Board reference exactly as printed' },
    job_reference: STR,
    job_number: STR,
    phase_config: { type: 'string', enum: ['SPN', 'TPN', 'mixed', 'ambiguous', ''] },
    phase_config_evidence: { type: 'string', description: 'The structural signals that decided phase_config; "" if none' },
    description: STR,
    purpose: STR,
    location: STR,
    fed_from_ref: { type: 'string', description: 'Parent board ref / Served by / DB Fed From; "" if none' },
    supplied_from_text: { type: 'string', description: 'Full source description exactly as printed; "" if none' },
    serving: STR,
    ways_total: NUM,
    ways_sp: NUM,
    ways_tp: NUM,
    spare_capacity_pct: NUM,
    phase_count: NUM,
    voltage_v: NUM,
    incomer_class: { type: 'string', description: 'e.g. Switch Disconnector, Isolator, MCCB, ACB; "" if none' },
    incomer_rating_a: NUM,
    incomer_poles: NUM,
    supply_cable_details: STR,
    supply_cpd_class: STR,
    supply_cpd_rating_a: NUM,
    supply_cpd_standard: STR,
    supply_cpd_trip_unit: STR,
    internal_isolator_class: STR,
    internal_isolator_rating_a: NUM,
    board_model: { type: 'string', description: 'Manufacturer + model, e.g. Hager JKD186TM; "" if none' },
    metering: { type: 'string', description: 'Full metering spec as printed, not a boolean; "" if none' },
    fault_ka: NUM,
    board_type_text: { type: 'string', description: 'Verbatim size/type/rating line; "" if none' },
    board_family: { type: 'string', enum: ['consumer_unit', 'distribution_board', 'panelboard', 'switchboard', 'unknown', ''] },
    board_family_reason: STR,
    continuation: { type: 'boolean' },
    confidence: NUM,
  },
};

const DEVICE = {
  type: 'object',
  additionalProperties: false,
  required: ['board_ref', 'way', 'phase', 'description', 'circuit_reference', 'device_class', 'protection_standard',
    'trip_unit', 'rating_a', 'trip_curve', 'breaking_capacity_ka', 'rcd_ma',
    'afdd', 'poles', 'cable_type', 'phase_csa_mm2', 'cpc_csa_mm2', 'circuit_config', 'install_method',
    'is_spare', 'is_spd', 'is_incomer', 'confidence'],
  properties: {
    board_ref: STR,
    way: { type: 'string', description: 'way number as a string; "" if none' },
    phase: { type: 'string', enum: ['L1', 'L2', 'L3', 'L1L2L3', 'SP', ''] },
    description: STR,
    circuit_reference: { type: 'string', description: 'Downstream board/load reference from this row; "" if none' },
    device_class: { type: 'string', enum: ['MCB', 'RCBO', 'afdd_rcbo', 'MCCB', 'ACB', 'RCD', 'SPD', 'fuse', 'switch_disconnector', 'isolator', 'contactor', 'time_clock', 'photocell', 'relay', 'timer', 'starter', 'overload', 'transformer', 'dali_controller', 'meter', 'spare', 'space', 'other'] },
    protection_standard: STR,
    trip_unit: STR,
    rating_a: NUM,
    trip_curve: { type: 'string', enum: ['B', 'C', 'D', ''] },
    breaking_capacity_ka: NUM,
    rcd_ma: NUM,
    afdd: { type: 'boolean' },
    poles: NUM,
    cable_type: { type: 'string', description: 'Code as printed (T2, 5, …) or description; "" if none' },
    phase_csa_mm2: NUM,
    cpc_csa_mm2: { type: 'string', description: 'mm² number as a string, or "SWA"/"integral"; "" if none' },
    circuit_config: { type: 'string', enum: ['RING', 'RADIAL', ''] },
    install_method: STR,
    is_spare: { type: 'boolean' },
    is_spd: { type: 'boolean' },
    is_incomer: { type: 'boolean' },
    confidence: NUM,
  },
};

const FEED = {
  type: 'object',
  additionalProperties: false,
  required: ['from_ref', 'to_ref', 'device_class', 'rating_a', 'poles', 'cable_ref', 'cable_csa_mm2',
    'cable_cpc_mm2', 'cable_desc', 'confidence'],
  properties: {
    from_ref: { type: 'string', description: 'Feeding board/source (TRANSFORMER, GENERATOR, panel ref…); "" if none' },
    to_ref: STR,
    device_class: STR,
    rating_a: NUM,
    poles: NUM,
    cable_ref: { type: 'string', description: 'e.g. F28; "" if none' },
    cable_csa_mm2: NUM,
    cable_cpc_mm2: { type: 'string', description: 'mm² number as a string, or "SWA"/"integral"; "" if none' },
    cable_desc: STR,
    confidence: NUM,
  },
};

export const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['classification', 'boards', 'devices', 'feeds', 'flags'],
  properties: {
    classification: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'sub_format', 'confidence'],
      properties: {
        type: { type: 'string', enum: ['schematic', 'db_schedule', 'specification', 'other'] },
        sub_format: { type: 'string', enum: ['amtech', 'trimble', 'bes', 'bam_epo', 'syntegral', 'hevacomp', 'imsc_tba', 'cu', 'switchboard', 'mccb', 'hager_grid', 'simple', 'unknown'] },
        confidence: NUM,
      },
    },
    boards: { type: 'array', items: BOARD },
    devices: { type: 'array', items: DEVICE },
    feeds: { type: 'array', items: FEED },
    flags: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'message'],
        properties: {
          kind: { type: 'string', enum: ['uncertain', 'unreadable_region', 'possible_missing_rows', 'legend_unresolved', 'other'] },
          message: { type: 'string' },
        },
      },
    },
  },
};

/* Fields the model returns as strings that downstream code wants as numbers
 * (or null). Applied in extract.mjs after JSON.parse so the client/harness
 * merge code is unchanged. */
export const NUMERIC_FIELDS = {
  board: ['ways_total', 'ways_sp', 'ways_tp', 'spare_capacity_pct', 'phase_count', 'voltage_v', 'incomer_rating_a',
    'incomer_poles', 'supply_cpd_rating_a', 'internal_isolator_rating_a', 'fault_ka', 'confidence'],
  device: ['rating_a', 'breaking_capacity_ka', 'rcd_ma', 'poles', 'phase_csa_mm2', 'confidence'],
  feed: ['rating_a', 'poles', 'cable_csa_mm2', 'confidence'],
};
// numeric-or-string (mm² number, else "SWA"/"integral", else null)
export const NUM_OR_STR_FIELDS = { device: ['cpc_csa_mm2'], feed: ['cable_cpc_mm2'] };

const toNum = (v) => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const toNumOrStr = (v) => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : String(v); };
const toWay = (v) => {
  if (v === '' || v == null) return null;
  const source = String(v).trim();
  return /^\d{1,3}$/.test(source) ? Number(source) : source;
};

/** Coerce the model's all-string result back into the numbers/null the merge
 *  code expects. Mutates and returns `result`. */
export function coerceResult(result) {
  if (!result || typeof result !== 'object') return result;
  if (result.classification) result.classification.confidence = toNum(result.classification.confidence);
  const apply = (arr, kind) => {
    for (const item of arr || []) {
      for (const f of NUMERIC_FIELDS[kind]) if (f in item) item[f] = toNum(item[f]);
      for (const f of (NUM_OR_STR_FIELDS[kind] || [])) if (f in item) item[f] = toNumOrStr(item[f]);
    }
  };
  apply(result.boards, 'board');
  apply(result.devices, 'device');
  for (const device of (result.devices || [])) if ('way' in device) device.way = toWay(device.way);
  apply(result.feeds, 'feed');
  return result;
}
