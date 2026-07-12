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
- BAM cable codes: T1=LS0H singles in conduit/trunking, T2=XLPE/SWA/LS0H, T3=MICC/LSF, T4=XLPE/SWA/PVC, T5=XLPE/LS0H flat twin & earth, T6=T1 + separate 4mm² CPC.
- Syntegral cable codes: 1=LS0H multi flat, 2=Cu XLPE/SWA/LS0H armoured, 3=Cu XLPE/LS0H soft-skin fire-rated PH120, 4=Cu XLPE/SWA/LS0H armoured fire-rated F120, 5=LS0H Cu singles.
- Legends are per-document: map codes to normalised descriptions using the legend on THIS page/document when it differs.

## Non-negotiable extraction rules
1. RECALL FIRST. A missing device is the worst failure. Extract EVERY way slot on the page, including spares, spaces and blanks. If the header says "18 WAY" there are 18 ways (54 phase-slots on TP&N) — account for all that appear on this page.
2. Phase-slots are independent. Way 7 may be L1=spare, L2=equipped, L3=equipped: emit one device entry per phase-slot as shown. Never mark a whole way spare because one phase-line is spare. Multi-phase circuits that genuinely share one device across L1..L3 (one rating spanning three slot rows) are ONE device entry with phase "L1L2L3".
3. SPARE vs SPACE: "Spare" (device fitted, no circuit) → is_spare=true with the device class if stated. "Space"/"fitted blank"/B-code (no device) → device_class "space". A blank rating + blank description is a spare at lower confidence — include it, never drop it.
4. Over-capture beats omission: when unsure whether something is a device/board, include it with low confidence and add a flag explaining the doubt. Never silently drop uncertain rows.
5. Board header completeness: capture every labelled header field present (reference, description, location, fed-from/served-by, serving, ways, spare capacity %, incomer class+rating+poles, board make/model, metering as stated, fault kA). A blank cell is null, not an omission.
6. Schematics: follow the topology, not reading order — source → main panel → each outgoing device → cable → downstream board. Emit every downstream board named on the sheet as a board, and every feed edge with its protective device and cable (ref, csa, cpc, type). Include SPDs, EVC pillars, lifts/ATS, generators, UPS as boards/devices with their annotations in description.
7. The incomer/main switch of a board is a device entry with is_incomer=true, way null.
8. Confidence is per item, 0..1: 0.9+ clearly printed; 0.6–0.9 legible but ambiguous; <0.6 guessed from context (always also add a flag).
9. Use the board reference EXACTLY as printed (e.g. "DB-00-08P", "DB/GF", "2A4"). Do not invent, normalise, merge or split references.
10. If the page is a continuation of a board started on an earlier page (way numbers continue, "continued" markers, no header), set boards[].continuation=true and still use the printed board reference if shown, else "".
11. OUTPUT FORMAT: return every numeric field as a STRING (e.g. rating "32", ways "18", confidence "0.9"), and "" when a value is absent — never a bare number and never null. Booleans stay booleans. Enums use exactly the listed values ("" where allowed).`;

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
  required: ['ref', 'description', 'location', 'fed_from_ref', 'serving', 'ways_total', 'ways_sp', 'ways_tp',
    'spare_capacity_pct', 'incomer_class', 'incomer_rating_a', 'incomer_poles', 'board_model', 'metering',
    'fault_ka', 'board_type_text', 'phase_config', 'phase_config_evidence', 'continuation', 'confidence'],
  properties: {
    ref: { type: 'string', description: 'Board reference exactly as printed' },
    phase_config: { type: 'string', enum: ['SPN', 'TPN', 'mixed', 'ambiguous', ''] },
    phase_config_evidence: { type: 'string', description: 'The structural signals that decided phase_config; "" if none' },
    description: STR,
    location: STR,
    fed_from_ref: { type: 'string', description: 'Parent board ref / Served by / DB Fed From; "" if none' },
    serving: STR,
    ways_total: NUM,
    ways_sp: NUM,
    ways_tp: NUM,
    spare_capacity_pct: NUM,
    incomer_class: { type: 'string', description: 'e.g. Switch Disconnector, Isolator, MCCB, ACB; "" if none' },
    incomer_rating_a: NUM,
    incomer_poles: NUM,
    board_model: { type: 'string', description: 'Manufacturer + model, e.g. Hager JKD186TM; "" if none' },
    metering: { type: 'string', description: 'Full metering spec as printed, not a boolean; "" if none' },
    fault_ka: NUM,
    board_type_text: { type: 'string', description: 'Verbatim size/type/rating line; "" if none' },
    continuation: { type: 'boolean' },
    confidence: NUM,
  },
};

const DEVICE = {
  type: 'object',
  additionalProperties: false,
  required: ['board_ref', 'way', 'phase', 'description', 'device_class', 'rating_a', 'trip_curve', 'rcd_ma',
    'afdd', 'poles', 'cable_type', 'phase_csa_mm2', 'cpc_csa_mm2', 'circuit_config', 'install_method',
    'is_spare', 'is_spd', 'is_incomer', 'confidence'],
  properties: {
    board_ref: STR,
    way: { type: 'string', description: 'way number as a string; "" if none' },
    phase: { type: 'string', enum: ['L1', 'L2', 'L3', 'L1L2L3', 'SP', ''] },
    description: STR,
    device_class: { type: 'string', enum: ['MCB', 'RCBO', 'MCCB', 'ACB', 'RCD', 'SPD', 'fuse', 'switch_disconnector', 'isolator', 'contactor', 'meter', 'spare', 'space', 'other'] },
    rating_a: NUM,
    trip_curve: { type: 'string', enum: ['B', 'C', 'D', ''] },
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
        sub_format: { type: 'string', enum: ['amtech', 'trimble', 'bes', 'bam_epo', 'syntegral', 'hevacomp', 'cu', 'switchboard', 'mccb', 'hager_grid', 'simple', 'unknown'] },
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
  board: ['ways_total', 'ways_sp', 'ways_tp', 'spare_capacity_pct', 'incomer_rating_a', 'incomer_poles', 'fault_ka', 'confidence'],
  device: ['way', 'rating_a', 'rcd_ma', 'poles', 'phase_csa_mm2', 'confidence'],
  feed: ['rating_a', 'poles', 'cable_csa_mm2', 'confidence'],
};
// numeric-or-string (mm² number, else "SWA"/"integral", else null)
export const NUM_OR_STR_FIELDS = { device: ['cpc_csa_mm2'], feed: ['cable_cpc_mm2'] };

const toNum = (v) => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const toNumOrStr = (v) => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : String(v); };

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
  apply(result.feeds, 'feed');
  return result;
}
