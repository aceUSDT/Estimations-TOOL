# Build Brief — AI-Assisted Electrical Estimating Tool

**Paste this whole file into Claude Code (Fable 5) as your opening prompt.** It contains your mission, how to work, the domain knowledge you need "in root memory", the exact features to build, a canonical data model, and acceptance tests keyed to real files you can already see in this project.

---

## 0. Who you are and what you're doing

You are the senior engineer on an **automated electrical estimating tool**. It reads raw UK electrical design documents — **LV schematics, distribution-board schedules, and specifications** — and turns them into a **structured, verifiable device take-off per board reference**, and (secondarily) a priced quote.

- The main tool lives in the **estimation tool folder** (open it first — it has the app code and an HTML entry point). Read it end-to-end before writing anything.
- You have visibility of the **same project files** the user does (the ~99 example PDFs/PNGs). **Use them as ground truth and as test fixtures** — read the real documents rather than guessing at formats.
- **This is an established multi-tab local-first app, not a greenfield build.** It is distributed as **Estimation Tools** in a browser and as packaged Windows/macOS desktop installers. It already has Projects, Documents, Viewer, Boards & Devices, Reports, Review, and Compare views. **Every workstream changes an existing capability.** Read the real components before touching them.
- **Keep the AI-extracts / code-computes split sacred.** The model classifies, extracts, and structures documents into the §4 model; **all counting, aggregation, diversity, and pricing are deterministic code, never the model.**
- **VERIFIED CURRENT REALITY — the "AI-extracts" half is not AI yet.** The deployed extractor is **`extractor-core.js`, a client-side regex/heuristic engine**, and it only truly parses **one** schedule dialect (BAM — `parseBamScheduleLine`). It has no Claude/LLM call anywhere, its board-reference matching is a handful of narrow regexes (so refs like `PB01`, `DB/GF`, `G1-GF-DB-LL` are missed), and it has **no schematic topology extraction**. This is almost certainly the root cause of the missing-data bug (§2A). The deterministic *counting* side (`aggregateDevices`) is correct and should stay. **The single biggest recall lever is to make the extract half genuinely AI-driven** — a Claude call, behind a serverless function, that reads *any* dialect and schematics — with the regex engine kept as a fast pre-pass / validator. (Confirm the exact wiring in the repo; the boundary is what matters, not filenames.)

### The one priority that outranks everything
**An accurate device take-off per board reference is the product.** Every required device captured, with the **input→output relationship** (which board feeds which, through which device and cable) made explicit. Pricing/PDF output is secondary and must never compromise take-off accuracy.

> **Current top bug:** the tool is **missing obvious datasets** that are clearly present in the inputs (whole boards, whole rows, sometimes whole documents). **Extraction recall is therefore the first thing to fix — see Workstream 0 (§2A) — before any of the five feature workstreams.** A missing device is the worst possible failure for this product.

---

## 1. How to work (Claude Code operating rules)

1. **Explore before you build.** Read the estimation-tool folder and HTML entry point, and map the existing tabs/components (Projects, Documents, Viewer, Devices, Boards, Review, Compare — see §2) to the code that renders them. Find the current extraction path, the current data/state shape, `price_list.csv` (or wherever rates live), and any serverless/API calls the deployed app makes. Read a spread of the real example files (see §7). Summarise what exists, what each of the five workstreams touches, and where the seams are — **before** changing anything.
2. **Plan, then confirm.** Produce a short written plan per workstream (§5) before coding. Get a thumbs-up on sequencing.
3. **Work in small, verifiable increments.** After each change, run it against real fixture files and show the extracted JSON / diff / UI. Never batch up a huge unreviewable change.
4. **Persist the domain model into the repo** (this is the "train it into the tool's root memory" step): put §3 and §4 into a durable `CLAUDE.md` / `DOMAIN_MODEL.md` and, where relevant, into the extraction prompt constants — so future runs don't re-derive the taxonomy.
5. **Keep arithmetic deterministic.** The model classifies, extracts, and structures. Counting, aggregation, diversity, and pricing are plain code.
6. **Flag, don't guess.** When two documents disagree, or confidence is low, surface it for a human decision. Never silently pick a value.
7. **Human-in-the-loop is a feature, not a fallback.** Every extraction is reviewable and editable before it feeds the take-off.
8. **Cite provenance.** Every extracted board/device/feed carries its source document, page, and a confidence score, so the UI can jump to it.

---

## 2. Current state (verified from the live app) → what each revision changes

The deployed app already has these tabs. **Do not rebuild them — modify them.** Left = what exists now; right = the revision that changes it.

| Existing tab / feature (working today) | The five revisions |
|---|---|
| **Projects** — "each project holds its drawings, schedules and extraction results"; local persistence | (unchanged) |
| **Documents** — a dropzone ("Drop electrical documents here… PDF/TXT/CSV, analysis starts automatically"), a Documents table (Document / Type / Size / Pages / Source / Status), and a **Page classification** table (Page / Detected type / Confidence / Source / Boards on page / Device rows) with a per-page **type dropdown** currently offering a **long** list (Cover page, Drawing register, Electrical legend, Lighting/Small-power/Fire-alarm/Containment plan, Single-line diagram, Electrical schematic, Main panel-board schedule, Distribution-board schedule, Cable schedule, Equipment schedule, Specification, General notes, Unknown) | **#1** collapse that dropdown/classifier to exactly **Schematic / Distribution Board Schedule / Specification**. **#3** make the dropzone capture on drop **anywhere** on the page, auto-scrape, and add schematic↔schedule **cross-referencing**. |
| **Viewer** — canvas with page nav (‹ 1/1 ›), zoom (− / + / Fit / ⟳), **Overlays** toggles (All detections / Confirmed / Needs review / Cables / Boards), **✦ Assisted canvas**, **OCR page**, and an "On this page" detections list | **#2** upgrade to the full engineering-grade canvas (A0/A1 + infinite canvas, 25–800% zoom, thumbnails, in-PDF search, multi-doc tabs, dark/light, print/download, keyboard/screen-reader, smart-highlight by board ref). |
| **Devices** — a **Scope** panel (Documents / Pages / Boards / Device types), "Ignore rows containing", "**Exclude only unpopulated spare & space ways**" + preview, **⚙ Count devices**, "**Device totals by board**" with "Approve all high-confidence", "+ Add manually", and **CSV / XLSX** export | **#4** merge with Boards → select a board ref, see that board's full device table (this counting logic is the take-off engine; keep it deterministic). |
| **Boards** — "**Board hierarchy — supply relationships extracted from schematics — correct the parent if wrong**", a Detected boards table (Board / Normalised / Type / **Supplied from** / Devices / Source / Confidence), and "**Possible duplicate boards — never merged automatically**" | **#4** merge with Devices. *(Note: "Supplied from" + hierarchy-from-schematics means the input→output backbone already partly exists — harden it, don't restart it.)* |
| **Review** — "**Review queue — uncertain results are never silently accepted**" | reinforced by **#3** (assisted manual review + discrepancy resolution feed this queue). |
| **Compare** — Document A / Document B pickers, **⇄ Compare**, **↓ Next**, an "**Electrical changes**" list with a change-type filter (Circuit added / Circuit removed / Rating changed / Device type changed / Cable changed / Board added-removed), and a dual-pane A/B view | **#5** rebuild to be simpler and more powerful (reuse the #2 viewer + a stronger structured diff). |
| **⚙ Analyse documents** — top-right trigger that runs classification + extraction | keep; **#3** routes its output through assisted review + cross-reference before it lands. |

**Net:** the scaffolding, the classifier, the viewer, the device counter, the board-hierarchy extractor, the review queue and the compare pane all exist. The five revisions **refine and connect** them — narrow the taxonomy, deepen the viewer, capture-anywhere + cross-reference, merge Boards+Devices, and rebuild Compare — while preserving the AI-extracts / code-computes boundary and the take-off-accuracy priority.

---

## 2A. WORKSTREAM 0 — Fix the missing-data problem FIRST (extraction completeness)

**Reported symptom:** the tool misses obvious datasets that are plainly present in the inputs — whole boards, whole circuit rows, sometimes whole documents. **This is the top bug and it outranks every feature in §5.** Recall — "did we capture everything that is actually there?" — is the acceptance bar for the whole product. Do this workstream before 5.1–5.5.

### 0.0 Root cause (confirmed from the code) — the fix is real AI extraction
The current extractor (`extractor-core.js`) is a **regex/heuristic engine that fully parses
only the BAM schedule dialect** (`parseBamScheduleLine`); it has **no LLM call**, narrow
board-ref regexes, and **no schematic topology extraction**. So any document in the other
dialects (Amtech, BES, Syntegral, Hevacomp, simple markup, switchboard/MCCB — see §3.3), any
schematic, or any board ref outside its patterns yields little or nothing. **That is why
obvious data goes missing.** The primary remediation is therefore *not* "add more regex":
- **Introduce genuine AI extraction.** Route each classified page/board through a **Claude
  call behind a serverless function** (see §8) that returns the §4 canonical model for **any**
  dialect and for schematics (feed graph), guided by the domain pack in §3. This is the
  "AI-extracts" half your architecture always intended.
- **Keep the regex engine as a fast, free pre-pass and as a validator** — cheap first pass on
  the format it knows (BAM), and a cross-check on the AI output (e.g. does the AI's way count
  match the header?). Keep the deterministic `aggregateDevices` counting exactly as is.
- **Never regress the BAM path.** The `EPO_Ashfield_Circuitry-markup` fixture is the
  regression baseline for the format the tool already handles.

The failure modes and harness below (0.1–0.5) still apply — they are how you *measure* recall
and catch the pagination / stitching / OCR / dedup gaps regardless of whether a given page is
handled by AI or regex.

### 0.1 Build a completeness harness *before* touching extraction
You cannot fix what you cannot see. Make the gap measurable first:
- Emit a **Coverage Report** for every document: per page/board, **expected vs captured**. Expected ways come from the board header (e.g. "18 WAY TP&N" ⇒ 18 ways / 54 phase-slots); compare to rows actually extracted. Also: boards named on a schematic vs boards actually created; and any page with a tabular/text signature but **zero** extracted rows.
- Run it across every fixture in §7 and produce a baseline table (pages, boards found, ways found, unaccounted regions, % complete). **Show me this baseline before changing extraction** — it's how we prove the fix.
- Lock ground-truth counts for the anchor fixtures in §0.5 so "fixed" is a number, not a feeling.

### 0.2 Hunt these specific failure modes (curated to these exact documents)
Missing data in these document types almost always traces to one of:
1. **Pagination / truncation** — only page 1 (or the first few) of a big schedule is processed. These files run to **51 / 54 / 70 / 77 / 84 pages** with roughly one board per page; a single-pass extraction drops later boards off the end (input truncated, or model output capped). → **Process every page; never assume one call covers the document.**
2. **Multi-page boards not stitched** — one board spans several pages with continuing way numbers (Syntegral **DB-MECH** runs pages 11→13, ways `1/L1 … 18/L3`). A per-page extractor emits three fragments or drops the continuation. → **Detect "continued" headers and merge by board ref + contiguous way numbers into one board.**
3. **Unrecognised dialect ⇒ whole document blank** — the extractor is tuned to one layout and silently returns ~nothing for the others (§3.3 lists 7+). An entire board or document going missing is the tell. → **Cover every dialect. A page classified as a schedule that yields ~0 rows is a failure to raise, not an empty result to accept.**
4. **Scanned / image-only pages ⇒ nothing** — `LV_schematic{,2,3,4}`, `SKM_C551i…`, `doc0896722…` have **no text layer**; native-text extraction returns empty. → **Auto-OCR any page with no/low text layer. The tool already has an "OCR page" action — apply it automatically, don't wait for a click.**
5. **Low confidence ⇒ silently dropped instead of queued** — the tool's own principle is "uncertain results are never silently accepted," but the real failure is *dropping* them. → **Route every low-confidence row to the Review queue; never discard. A dropped row is invisible; a queued row is fixable.**
6. **Over-eager spare/blank filtering** — multi-phase rows carry the way number on one line only (DB-MECH: `4/L1` blank, `4/L2` populated, `4/L3` blank). "Looks empty ⇒ drop" logic deletes real circuits and mis-splits phases. → **Keep every way slot; classify spare-vs-equipped explicitly; never delete a row to tidy the table.**
7. **Table detection breaking on wrapped/rotated headers & merged cells** — schedule headers wrap across lines ("Phase & / Neutral (mm²)") and columns are narrow; rigid header-matching drops the whole table. → **Parse tolerant to wrapped headers; fall back to positional/visual table parsing when header-matching fails.**
8. **Schematic topology missed** — schematics are spatial; reading text in reading-order catches the main panel but misses outgoing devices and downstream DBs spread across the sheet. → **Extract by following the single-line topology (source → panel → each outgoing device → cable → downstream board), not left-to-right text order.**
9. **Aggressive de-duplication** — distinct boards with similar refs (`DB-01-21` vs `DB-01-22`; per-phase sub-boards) get merged away. → **Never auto-merge (the tool already states this for boards) — flag "possible duplicate" and keep both.**

### 0.3 Add a reconciliation / self-check pass (this is what actually catches omissions)
After the first extraction pass, run a **verification pass** that checks the result against the document's own evidence and against the other documents:
- **Header-vs-rows:** header says "18 WAY" but 11 ways extracted ⇒ flag "7 ways unaccounted" and re-examine that region.
- **Contents / index page:** many schedules carry a summary index (Bow Green MCCB: "Summary Index — Ref / Location / Size"; DUN schedule "Issue Record" section list; Syntegral numbered pages). Treat listed boards as an **expected set** and flag any not extracted.
- **Schematic ⇄ schedule checklist (the strongest signal):** the schematic names every downstream board; each should be a section in a schedule. Use each as the other's checklist — "schematic references `DB-00-14` but no board was extracted for it" is exactly the miss to surface. (Same engine as §5.3 cross-referencing, used here for recall.)
- Send every gap to the Coverage Report **and** the Review queue.

### 0.4 Make completeness a permanent gate, not a one-off fix
- Keep the Coverage Report as a standing feature so the user always sees, per document, what % was captured and what is unaccounted for.
- **Prefer over-capture routed to review over silent omission.** When unsure whether something is a device/board, include it and flag it. Under this tool's priority, a false positive the user deletes is far cheaper than a missing device they never see.

### 0.5 Acceptance (real fixtures, real numbers)
- **`25057…REV_C02` (13 pp):** every board on every page created; **DB-MECH is ONE 18-way TP&N board stitched across pp 11–13** (not 3 fragments); DB-AV = 7 equipped + 4 spare + 1 SPD (way 12). Coverage ≈ 100%; zero "schedule page, 0 rows".
- **`SRP1053…4801` (A0 schematic):** the 2500A ACB, the F-referenced outgoing devices, **and every downstream DB named on the sheet** (DB-00-08…14, DB-00-50, DB-01-21…29, DB-ESS-01, DB-00-SUBEXT, the EVC feeder pillar with 28 × 7.4kW) appear as boards/feeds. "Main panel + a couple of DBs" is a fail.
- **Dundee CU (5 pp):** all three CU variants (General Apartment / Cluster Bedroom / Cluster Kitchen), not just the first.
- **Scanned set** (`LV_schematic{,2,3,4}`, `SKM_C551i…`, `doc0896722…`): auto-OCR yields boards/devices, not empty.
- **Large schedules** (`DBs_with_devices_for_Ben…` 70 pp, `SRP1053…6858` 77 pp, `DB_SCHEDULE` 84 pp): extracted board count matches the document's own index/page count — no silent truncation past page ~N.
- Coverage Report clears the agreed recall threshold on all fixtures, and every unaccounted region sits in the Review queue.

---

## 3. DOMAIN KNOWLEDGE PACK  *(persist this into the repo)*

This is distilled from the real project files. It is the knowledge the extraction layer must encode. **The single biggest extraction risk is format diversity** — the same information appears in many different layouts. Normalise everything into the canonical model in §4.

### 3.1 The three document classes

| Class | What it is | Shape | Key signal words |
|---|---|---|---|
| **Schematic** (LV / distribution / single-line) | Spatial single-line diagram of the whole installation | **Not tabular** — nodes and connecting lines | "LV SCHEMATIC", "SINGLE LINE", transformer/ACB/panelboard symbols, "FORM x TYPE y", "DB/…" blocks connected by cables |
| **Distribution Board Schedule** (incl. CU circuit charts, switchboard & MCCB schedules) | Per-board tabular listing of every way/circuit | **Tabular**, one section per board reference | "DISTRIBUTION BOARD SCHEDULE", "CIRCUIT CHART", "Board Reference/Identity", "Way No.", "Duty" |
| **Specification** | NBS-style written clauses / product & workmanship requirements | Prose clauses (numbered) | "SPECIFICATION", NBS clause codes, prose paragraphs about products/standards |

> Consumer units (CUs), switchboard schedules, MCCB schedules, and composite-board schedules are all **sub-types of "Distribution Board Schedule"** for classification — but tag their sub-format so the parser can adapt (see 3.3).

### 3.2 SCHEMATIC — the input→output backbone (highest-value extraction)

A schematic encodes the **feed hierarchy**. Capture it as a directed graph:

```
[Source] → [Main panel/board] → [outgoing device] → [cable] → [downstream board] → [outgoing device] → …
```

Elements you must recognise and extract:

- **Source / incomer:** transformer (e.g. `1500kVA`), `ACB` (e.g. `2500A TP&N ACB`, `2000A 4-POLE ACB`), incoming LV service, metering (`kWhr`, `CT`, MID/Modbus), main earth bar.
- **Main panel / panelboard:** reference (e.g. `MCCB PANELBOARD PB01`, `MSB1`, `DB/L/M`), construction (`FORM 3b/4 TYPE 2/6`), fault rating (`50kA 1 SEC`, `36kA`), way count (`28 WAY`, `21 WAY`), entry/access notes.
- **Outgoing devices** (one per feed): class ∈ {MCCB, MCB, ACB, fuse, switch-disconnector/isolator, ATS, contactor}, **rating (A)**, **poles** (`TP&N`, `SP&N`, `4P&N`, expressed as 3/1/4), trip unit / curve (e.g. `micrologic 2.2`, `Therm/mag`, `Type B/C/D`), adjustable Y/N, plug-in Y/N, fault rating.
- **Cable on each feed:** cable ref (e.g. `F28`, `Cable ref: 07`), CSA + cores (e.g. `1x50mm² 4c`, `35mm²`), **CPC** (e.g. `70mm²`, `integral core`), cable type (`XLPE/SWA/LSF`, `FP400`, fire-rated), distance/length (often blank/TBC).
- **Downstream board:** reference (e.g. `DB/GF`, `DB-00-08`, `DB/FF`), way count + type (`18WAY TP&N`), duty/description (e.g. "Food Room Power Dist. Board").
- **Special loads & annotations to capture:** SPD (`ESP`, `Type 1/2`, "TBC by manufacturer"), EVC (e.g. `28 × 7.4kW` fast chargers as twin units), lifts + ATS ("evacuation lift — do not switch off"), UPS (and its removal in later revisions), generator + changeover, power-factor correction / harmonic filters, life-safety panelboards, PV/G99, fire-alarm/disabled-refuge panels, "10% installed spare devices + 10% spare ways".
- **Spare ways:** mark explicitly; they are capacity, not priced devices (see §4 policy).

**Reciprocity rule:** every schematic feed edge (`parent → device → cable → child`) should have a matching **board section in a DB schedule** for that `child`, and the child's **incomer rating** on the schedule should be consistent with the outgoing device rating on the schematic. Mismatches are discrepancies to flag (§5.3).

### 3.3 DISTRIBUTION BOARD SCHEDULE — normalise across dialects

Every DB schedule has a **board header** + a **per-way circuit table**. The columns are named differently across software/consultants; map them all to the canonical model.

**Board header fields (union across dialects):** board reference/identity; description/duty; location; block/area; **fed-from** (parent board) and/or **"Serving"** (what it powers); **incomer / main-switch** device type + rating (A) + poles; way count (SP and/or TP, total); spare-capacity %; voltage; fault rating (kA); Ze; metering (Y/N); dual earth terminals; board model (e.g. `Hager JKD186TM`).

**Per-way circuit fields (union):** way number (`1`, `CCT 1`, or split by phase `1/L1 1/L2 1/L3`); phase (`L1/L2/L3` or `SP`); circuit description / duty / load name; **protective-device class**; **device rating In (A)** (and Ir if adjustable); **trip curve** (`B/C/D`); **RCD rating (mA)**; **AFDD** (Y/N or `+AFDD`); **cable type** (coded or described); **phase/line conductor CSA (mm²)**; **CPC CSA (mm²/SWA)**; **circuit configuration** (`RING`/`RADIAL`/`RAD`); **installation method**; load (W / Ib). Mark **SPARE** ways and **SPD** ways distinctly.

**Dialects seen in the real files (recognise and adapt — do not hard-code to one):**

| Dialect / source | Distinctive markers |
|---|---|
| **Amtech/Trimble** ("Board Data" export) | `Id No`, `Model No`, `Ze (Ω)`, `Fault Rating (kA)`, per-phase Connected/Diversified Load, per-way `In / Ir / Type / RCD mA / AFDD / Cable mm² / Cores / Sep.CPC mm²`. *Files: `DB_Schedules_P02`, `DBs_with_devices_for_Ben…`, `Switchboard_Schedules_P02`, `Broomfield_House…`, `Guernsey_Report…`, `DB_SCHEDULE`.* |
| **Trimble "Distribution Board Schedule/Report"** (William Farr) | Paired **Schedule** + **Report (cable calcs)**; `Job Number 847`. *Files: `DB_K_Kitchen…`, `DB_L_Laundry…`, `DB_LL_*`, `DB_PL_Plantroom…`.* |
| **BES / Brenbar** (Kings Road Park) | `DB Reference`, **`DB Fed From`**, **`Device Protecting DB`**, `Number of ways (TP/SP)`, `Spare capacity %`; per-way `WAY PHASE CIRCUIT-DESCRIPTION config PROTECTIVE-DEVICE(A) Curve RCD(mA) AFDD`. *Files: `DB_Schedule_2026*`.* |
| **Syntegral** (Anoopam Crematorium) | Way `CCT n` (+ `n/Lx` for 3-phase); columns `MCB/RCBO Rating(A), Trip Curve, RCD/RCBO(mA), Arc Fault Detection, Cable Type (coded 1–5), Phase & Neutral(mm²), CPC(mm²/SWA), Circuit Configuration, Duty`; **Cable Type legend 1–5**. *File: `25057RCXXXXSHE00001…REV_C02`.* |
| **BAM / EPO** (Ashfield School) | `Reference`, **`Serving`**, `[rating] Sw/Discon`, `[n] Way TP&N`, `Incoming Cable Reference`; per-way `Way Line In Ib P L1 L2 L3 csa Type InstallMethod`; **device-type legend P1–P5**, **cable-type legend T1–T6**, install method per Table 4A2. *Files: `EPO_Circuitry_mark_up`, `SRP1053…Schedule_No_11…`, `SRP1024…Schedule_No_11…`.* |
| **Hevacomp** (The Angel, Cardiff) | Protective-device note block ("Small power type B RCBO/AFDD 10kA; Lighting…"); `Served by SBxx`. *Files: `The_Angel_Cardiff…`, `DBG_2023_09_11`, `DBK_2023_09_11`.* |
| **Simple markup** | `Way No / Device Rating(A) / Device Type / Phase` + hand-added cable notes. *Files: `BC250847_E13`, `BC250847_E15`.* |

**Standard legends to normalise to (persist these):**

- **Device-type codes:** `P1 = MCB (Curve C default)`, `P2 = RCBO (Type A unless stated)`, `P3 = MCB/Fuse + separate 30 mA RCD`, `P4 = HRC fuse`, `P5 = MCB user-defined`.
- **Cable-type codes (BAM T-series):** `T1 = LS0H single core in conduit/trunking`, `T2 = XLPE/SWA/LS0H`, `T3 = MICC/LSF`, `T4 = XLPE/SWA/PVC`, `T5 = XLPE/LS0H flat twin & earth`, `T6 = T1 + separate 4mm² CPC`.
- **Cable-type codes (Syntegral 1–5):** `1 = LS0H multi flat`, `2 = Cu XLPE/SWA/LS0H armoured`, `3 = Cu XLPE/LS0H soft-skin fire-rated PH120`, `4 = Cu XLPE/SWA/LS0H armoured fire-rated F120`, `5 = LS0H Cu singles`.
- Cable legends are **per-document** — always read the legend on the drawing and map its codes to a normalised cable description; never assume T5 means the same thing across two projects.

### 3.4 CONSUMER UNIT (CU) — domestic sub-format

Same skeleton as a DB schedule, smaller: `Board Identity` (e.g. "Consumer Unit (General Apartment)"), `No of Ways` (e.g. 8), `DB Incomer Device Rating/Type` (e.g. `63A Switched Disconnector`); per-way `Way Phase Circuit-Description CPD-Rating(A) CPD-Type RCD(mA) Phase-Conductor(mm²) Sep-CPC(mm²) Cable-Type Installation-Method`. Multiple CU variants often appear in one file (e.g. General Apartment / Cluster Bedroom / Cluster Kitchen). CUs may also appear as **SLD-style layout drawings** (treat as schematic-flavoured but extract the same way rows). *Files: `DUNRYBXXXXSPE61002…`, `114026NPSZ100DRE6000…`, `SLDCONSUMER_UNIT_FOR_REVIT…`, `10__Electrical_Specification__Appendix_5__ConsumerUnit.png`.*

### 3.5 Revisions

Documents carry an **amendment/issue block** (`Rev | Date | Detail | By | Checked`) with a progression like `P01 → P02 → C01 → C02 …`. Filenames often hint at the change (e.g. `rev3_panel_fuse_now_160A_not_32A`). Match revisions of the same drawing by **document reference** (e.g. `847-RME-XX-ZZ-DR-E-0900`) ignoring the trailing rev suffix, or let the user pair them. Use the drawing's own amendment block as a **sanity check** against your detected diff.

---

## 4. CANONICAL DATA MODEL  *(shared contract for extraction + UI + pricing)*

Normalise every document into this. The model is the interface between the AI layer (fills it) and the deterministic layer (aggregates + prices it).

```jsonc
Project {
  id, name,
  documents: [Document],
  boards:    [Board],
  devices:   [Device],
  feeds:     [Feed],          // the input→output edges — the priority
  discrepancies: [Discrepancy]
}

Document {
  id, filename,
  type: "schematic" | "db_schedule" | "specification",
  sub_format: "amtech" | "bes" | "bam_epo" | "syntegral" | "hevacomp" | "cu" | "switchboard" | "mccb" | "simple" | "unknown",
  revision, revision_date,
  pages, source: "native_text" | "ocr",
  page_classifications: [ { page, type, confidence, source } ]
}

Board {
  id, ref,                    // e.g. "DB-00-08", "G1-GF-DB-LL", "PB01"
  description, location, block,
  board_type_text,            // verbatim, e.g. "18 WAY TP&N MCCB PANELBOARD, FORM 4 TYPE 6, 50kA"
  form, type, kA,
  ways: { sp, tp, total, spare },
  incomer: { device_class, rating_A, poles },   // main switch / incoming device
  fed_from_ref,               // parent board ref  (input side)
  serving,                    // free-text of what it powers (output side)
  protecting_device,          // device at the PARENT that protects this board
  spare_capacity_pct,
  metering, dual_earth,
  source_doc_id, source_page, confidence
}

Device {                      // one equipped way = one device (spares/SPD flagged)
  id, board_ref, way, phase,  // phase ∈ L1|L2|L3|SP
  description,                // duty / load name
  device_class,               // MCB|RCBO|MCCB|ACB|fuse|switch_disconnector|isolator|SPD|contactor|RCD|spare
  rating_A, ir_A,             // In, and Ir if adjustable
  trip_curve,                 // B|C|D|null
  rcd_mA, afdd,               // afdd: bool
  poles,                      // 1|3|4
  cable: { type_code, type_desc, phase_csa_mm2, cpc_csa_mm2, cores, install_method, length_m },
  circuit_config,             // RING|RADIAL|null
  is_spare, is_spd,
  source_doc_id, source_page, confidence
}

Feed {                        // schematic edge: parent → device → cable → child
  id, from_board_ref, from_device_id,
  to_board_ref,
  cable: { ref, phase_csa_mm2, cpc_csa_mm2, cores, type_desc, length_m },
  source_doc_id, confidence
}

Discrepancy {
  id, kind,                   // "rating_mismatch" | "board_missing_in_schedule" | "board_missing_in_schematic" | "way_count_mismatch" | "cable_mismatch" | "revision_change"
  board_ref, feed_id,
  schematic_value, schedule_value,
  severity,                   // info | warning | critical
  status,                     // open | resolved
  chosen_source              // which the user kept
}
```

**Take-off (deterministic, computed in code — never by the model):**
- Group equipped `Device`s by `(device_class, rating_A, trip_curve, poles, rcd_mA, afdd)` → counts, with a per-board breakdown.
- Roll up the **cable schedule** by `(type_desc, phase_csa_mm2, cores)` with total length where known.
- **Spare-way policy (make it a config flag, default explicit):** spares and "TBC by manufacturer" SPDs are reported as capacity, listed separately, and **not** counted as priced devices unless the user opts in.
- Pricing = deterministic join of the take-off to `price_list.csv` (existing `generate_quote.py` path). Reference wholesaler quote format (product code / description / quantity / price, grouped into sub-assemblies like "Main PB") is exemplified by `205987740…` and `205988411…`.

---

## 5. THE FIVE WORKSTREAMS (modify the existing pages in §2)

Each workstream **changes a page that already exists** — see the §2 table for the current control you're editing. Ship them as independent, verifiable increments.

### 5.1 Three-type page classification  *(edits: Documents → Page classification dropdown + classifier)*
- Replace the current **long** dropdown/classifier (Cover page, Drawing register, …, Unknown) with exactly **`Schematic` / `Distribution Board Schedule` / `Specification`**. Map any legacy stored types onto the three.
- Classify **per page** (documents are often mixed — a 51-page schedule, a 1-page schematic). Store `type`, `confidence`, `source (native_text|ocr)`, and detected `sub_format`.
- Keep the **manual override** (user can correct a page's type; persist "Manually set").
- **Acceptance:** on the 99 fixtures, ≥95% of pages land in the correct one of three; every page is overrideable; sub-format is tagged for schedules.

### 5.2 Revision comparison + canvas viewer  *(edits: the existing Viewer tab + its Overlays/OCR/assisted-canvas)*
**Revision compare (structured, not just pixel/text diff):**
- Register a document's revisions (match by document reference, or user-paired). Extract each revision into the §4 model, then **diff semantically**: device added/removed, rating/poles/curve/RCD/AFDD changed, board added/removed, way spare→equipped, cable size changed, incomer changed.
- Fall back to OCR **text** diff to catch anything the structured layer misses.
- Output a **plain-English change report** with confidence and source location (page + region) for click-through. Cross-check against the drawing's amendment block.
- **Acceptance (real fixture):** `847-RME-XX-ZZ-DR-E-0900` across `rev2__panel` → `rev3_panel_fuse_now_160A_not_32A` → `rev5…C5` must report at least: **sprinkler/life-safety fuse 32A → 160A**, **UPS removed + 75kVA generator & LSI ATS added**, **SDP board added**, **DB references amended to Grd & 2nd** — and reconcile with the P1/P2/C1–C5 amendment list.

**Canvas viewer ("View" → full flexibility):** page sizes A4/A3/Letter/Legal/custom + **A0/A1 engineering & CAD-sized**; portrait/landscape/mixed/rotated; smooth zoom **25%–800%**; fit-width / fit-page / actual-size; **thumbnail nav panel**; **virtualised/lazy** rendering for hundreds–thousands of pages; **in-PDF text search**; page-number nav; full-screen; **dark/light**; **print + download**; keyboard nav + screen-reader support; **multi-document tabs**; **infinite-canvas** mode for large drawings; **annotation viewing**; **smart highlighting** (highlight all instances of similar text, and highlight by **board reference** across selected pages).
- Suggested stack: PDF.js for rendering + text layer/search; a deep-zoom/tiled approach (e.g. OpenSeadragon-style) or canvas virtualisation for A0 infinite-canvas; virtualise the page list. Confirm the stack against what the existing app already uses before adding deps.
- **Acceptance:** open a 1-page A0 schematic (`SRP1053…4801`) and a 51-page schedule (`SRP1053…6858` / `The_Angel_Cardiff…`) smoothly; search finds a board ref and smart-highlight marks every instance.

### 5.3 Drop-anywhere capture + auto-scrape + assisted review + cross-referencing  *(edits: Documents dropzone + the existing Review queue; adds cross-referencing)*
- **Full-page dropzone:** widen the existing "Drop electrical documents here" area so a drop **anywhere** on the Documents page captures (PDF/TXT/CSV). Keep the current auto-analyse trigger; auto-classify (§5.1) and **auto-scrape** on ingest.
- **Assisted manual review:** side-by-side **rendered page ↔ extracted structured rows**, editable, with confidence flags and "jump to source". Nothing enters the take-off until the user has had the chance to review; low-confidence rows are visually flagged.
- **Cross-reference schematic ↔ DB schedule:** when both exist for a project, match boards across them and **flag discrepancies** (rating mismatch, board present in one but not the other, way-count mismatch, cable mismatch). Present a resolution UI so the user chooses which source wins per discrepancy; record `chosen_source`.
- **Acceptance (real fixture):** `DB-00-08` appears in the SRP1053 **schematic** (18-way TP&N food-room power, fed via cable `F28`) and in the BAM **schedule** (`DB-00-08P`, 160A Sw/Discon, incoming cable `F28`). The tool links them, confirms the `F28` cable and rating are consistent, and flags any mismatch for resolution.

### 5.4 Merge Boards + Devices into one page  *(edits: fuse the existing Devices and Boards tabs)*
- Combine today's two tabs into one. Reuse the Boards tab's hierarchy/"Supplied-from" data and the Devices tab's counter + CSV/XLSX export. A **board list / feed-hierarchy tree** (using `fed_from_ref`) on one side; selecting a board reference shows a **table of every device on that board** (the §4 `Device` rows), plus the board header (incomer, ways, fed-from, serving, spare capacity). Carry over "Possible duplicate boards" and "Exclude unpopulated spare & space ways".
- Show the **roll-up take-off** (grouped device counts) across all boards, with per-board drill-down.
- **Acceptance:** selecting `DB-AV` (Syntegral) shows 7 equipped circuits + 4 spares + 1 SPD on way 12, incomer 12-way SP&N; selecting `DB-MECH` shows the 18-way TP&N board with 3-phase (`n/L1..L3`) rows correctly split.

### 5.5 Rebuild the Compare page  *(edits: the existing Compare tab)*
- Keep the existing A/B pickers and change-type filter (Circuit added/removed, Rating/Device-type/Cable changed, Board added/removed) but make it **simple and powerful**: a filterable semantic change list (added / removed / changed, filter by board), a **synced dual-pane** viewer (reuse the §5.2 viewer), and **jump-to-change** wired to ↓ Next. Reuse the §5.2 structured diff engine.
- **Acceptance:** the William Farr revision set renders as a clean, filterable change list with dual-pane jump-to-change, not a wall of raw OCR text (the current pain point).

---

## 6. Guardrails / non-negotiables

- **AI extracts, code computes.** No counting, diversity, or pricing inside the model.
- **Provenance + confidence on everything** (doc, page, score).
- **Flag conflicts; never auto-resolve.** The human picks.
- **Normalise, don't hard-code.** Support the format dialects in §3.3 via a mapping layer; read each document's own legend.
- **Spares & TBC-SPDs are capacity, not silent priced devices** (config flag).
- **Take-off accuracy is the acceptance bar.** A feature that risks miscounting devices is not done.
- Keep the extraction prompt(s) and the domain model in the repo so behaviour is reproducible.

---

## 7. Test fixtures (already in this project — read them directly)

| Scenario | Files |
|---|---|
| Schematic, input→output backbone, A0 | `SRP1053BMD01ZZDE4801…NB1_and_NB2…`, `2429SGLV1XXDRE1001P1/1002P1`, `C056BBKXXZZZZSE4101…`, `W702OCO03…LV_Schematic` (Cores D/E/F/G/SW) |
| DB schedule dialects | Amtech: `DB_Schedules_P02`, `DBs_with_devices_for_Ben…`; BES: `DB_Schedule_2026*`; Syntegral: `25057RCXXXXSHE00001…`; BAM/EPO: `EPO_Circuitry_mark_up`, `SRP1053…Schedule_No_11…`; Hevacomp: `The_Angel_Cardiff…` |
| Consumer units | `DUNRYBXXXXSPE61002…`, `114026NPSZ100DRE6000…`, `SLDCONSUMER_UNIT_FOR_REVIT…` |
| Switchboard / MCCB / composite | `Switchboard_Schedules_P02`, `…MCCB_Schedule`, `SRP1053…Schedule_No_4_Composite…` |
| Revision set (for §5.2 / §5.5) | `rev2__panel`, `rev3_panel_fuse_now_160A_not_32A`, `rev5___847RMEXXZZDRE0900…C5` |
| Cross-reference pair (§5.3) | schematic `SRP1053…4801` ↔ schedule `SRP1053…6858` / `EPO_Circuitry_mark_up` (shared board `DB-00-08`, cable `F28`) |
| Pricing output format (secondary) | `205987740…Contractor/Stockist`, `205988411…` |
| Scanned / image-only (exercise OCR) | `LV_schematic`, `LV_schematic2/3/4`, `SKM_C551i…`, `doc08967220251013144029` |

---

## 8. Access, deployment & credentials — **read before you start**

- **Hosted browser build:** `https://estimationtoolz.netlify.app/` is the historical deployment. The packaged desktop app serves local files from `estimation://app` and does not depend on that site.
  - Browser and desktop projects are stored in the current local profile. The per-device PIN is a UI lock, not encryption or server authentication. Any public hosted extraction endpoint still requires a real server-side access gate.
- **Claude API key:** a key was shared in chat for this project. **Treat it as already compromised — rotate/revoke it in the Anthropic Console and generate a fresh one before wiring anything up.** A key that has appeared in any chat, ticket, or doc should always be rotated, on principle, regardless of who saw it.
- **How the new key must be handled (non-negotiable, given this is a client-side SPA):**
  1. **Never** hardcode the key in source, commit it to the repo, or ship it inside the built front-end bundle — anything sent to the browser is extractable by any visitor, the same way this chat's key must now be rotated.
  2. Store it as a **server-side environment variable** — in Netlify: Site configuration → Environment variables (e.g. `ANTHROPIC_API_KEY`), never in `.env` files that get committed (confirm `.env*` is in `.gitignore`).
  3. All calls to the Claude API must go through a **serverless function** (Netlify Function) that reads `process.env.ANTHROPIC_API_KEY` server-side and returns only the result to the browser. The front-end calls your own function endpoint, never `api.anthropic.com` directly.
  4. If the current deployed app *does* call the Anthropic API directly from client-side code, that's a second live exposure on top of the auth gap above — surface it immediately, since it leaks the key to every visitor exactly like this chat did.
  5. Online extraction must remain explicit opt-in in hosted browser builds and disabled in the local desktop package. Local deterministic extraction and reporting must continue without a key or network connection.

---

## 9. Definition of done

- **Extraction completeness (Workstream 0) is fixed and gated:** the Coverage Report clears the agreed recall threshold on every fixture, multi-page boards are stitched, scanned pages are auto-OCR'd, unrecognised-dialect/empty pages are raised not accepted, and every unaccounted region lands in the Review queue rather than vanishing.
- Classification uses exactly the three types, per-page, overrideable, with sub-format tagging.
- Every fixture extracts into the §4 model with provenance + confidence; the merged Boards+Devices page shows accurate per-board device tables and a correct roll-up take-off.
- Feeds (input→output) are captured from schematics and reconciled against schedules; discrepancies are flagged and resolvable.
- Revision compare produces the correct plain-English change report on the William Farr set; the canvas viewer meets the §5.2 capability list; the Compare page is the simple, powerful dual-pane experience.
- The AI-extracts / code-computes boundary is intact; the domain model is persisted in the repo.

**Start by reading the estimation-tool folder + HTML entry point, mapping the existing tabs in §2 to their components, and reading a representative spread of the fixtures. Then, because the top bug is missing data: build the Workstream 0 (§2A) Coverage Report and run it across the fixtures, and show me that completeness baseline first. Alongside it give me: (a) a one-paragraph note on how the deployed app is actually wired (extraction path, state shape, where rates live), (b) confirmation that the API key is server-side only per §8 (fix immediately if not), (c) which existing component each of the five workstreams edits, and (d) your plan to close the biggest recall gaps — before writing feature code.**
