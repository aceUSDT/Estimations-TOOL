# PROJECT HISTORY — extraction, reporting and schematic reading

**What this file is.** The reasoning behind the extraction work: what was broken,
what was measured, what was tried and rejected, and what is still unproven. It
exists because the *code* survives a session and the *reasoning* does not, and
the reasoning is the expensive part. A future session that reads only the diff
will re-make decisions that were already made and measured against real
documents.

**How it differs from the other memory docs.**

| file | answers |
|---|---|
| `docs/PROJECT_MEMORY.md` | *Where are we?* — branches, deploys, commerce, platform state. A snapshot. |
| **this file** | *Why is the extractor shaped like this?* — defects, measurements, dead ends. Cumulative. |
| `docs/EXTRACTION_SOP.md` | *What must the extractor do?* — the operating rules. |
| `graphify-out/` | *What calls what?* — code structure only (see §10). |

**Verify before trusting.** Every number below was measured in a session, on a
document, at a commit. Re-measure before relying on one.

---

## 1. The rules of engagement (from the owner, do not re-litigate)

These came out of feedback during the work and they govern everything else:

1. **"Every electrical document is different, therefore there needs to be fine
   tuned commands that allow the tool to think about the most efficient way to
   view and extract info."** Do not add a regex per practice and call it done.
   The tool must work out how *this* sheet is laid out, then read it. That is why
   `layout` exists in `EXTRACTION_SCHEMA` and why the agent orders begin with
   layout reconnaissance (A–F) before any row is read.
2. **"Keep working, testing and retesting until all issues are resolved."** A fix
   is not finished when it compiles. It is finished when it is measured on a real
   document and the number moved.
3. **"Show me you haven't just gone in and fixed it yourself."** A fix that only
   works on the document that exposed it is worthless. Prove generalisation on
   documents that were never opened during the work (§4).
4. **Reports must be readable by an estimator, not by an engineer.** The full
   audit is opt-in; the default export is what you would send to a supplier for a
   price (§6).
5. Completeness beats accuracy beats clarity beats pricing (`CLAUDE.md`). A
   missing board is the worst outcome. A *silently* missing board is worse still.

---

## 2. The defects, and what each one actually was

Each of these was found by running a real document, not by reading code.

### 2.1 OCR noise accepted as page text
`selectBestOcrCandidate` returned the best-scoring candidate with **no floor**,
so on an unreadable scan it returned confident gibberish and the page looked
processed. Measured the score distribution across pages known to be readable and
known to be not: unreadable landed 0.578–0.605, readable 0.770–0.882. Set
`OCR_READABLE_FLOOR = 0.68` — inside the empty band, not at either edge — and
made the function return `readable` so the caller can report the page instead of
pretending. **Silence was the bug; the low score was always available.**

### 2.2 Mirrored ("double-sided") circuit charts read at half strength
Consumer-unit and panelboard charts are frequently drawn as two half-tables
facing each other across the busbar, so one printed row carries **two** ways —
odd on the left, even on the right. The parser read one way per row and lost
half of every board, and the result looked like a small board rather than an
error. The spine is recognisable: `N L1 L1 N+1`, `1 L1 L1 2`, `3 L2 L2 4`.
Added `looksLikeMirroredChart` / `parseMirroredChartLine` / `parseMirrorHalf` and
`MIRROR_SPINE`, and taught the master auditor to treat an agent reporting
`left_to_right` on such a sheet as a layout failure regardless of what the way
arithmetic says.

### 2.3 Dialects that never write the device class — found **three separate times**
This is the single most productive root cause in the project. Rows like

```
17L2 16*            1 L1 Load-31 16            125 A ML2.3 TPN
```

carry a way, a phase and a rating, and **never the word MCB or MCCB**. Anything
keying on a class word drops them entirely. Fixed in two places, because there
are two readers:
- the deterministic parser: way-marker precedence (`\d+-L\d`, then `^\d+L\d`,
  then `^\d+ L\d`) followed by a **positional** rating — the first purely numeric
  token after the marker;
- the agent orders: order 21, *"the device is named by its MODEL, not by a class
  word… do NOT skip a way because the word MCCB never appears."*

If a document comes back with too few rows, check this first.

### 2.4 Column bands from vector ruling lines
Multi-board sheets and wide tables need to be split into columns, and text
x-positions alone will not do it. Measured that directly: on the sheet in
question the widest vertical corridor between text clusters was **1.2% of the
page span** — there is no gap to find. The ruling lines, however, are in the
operator list. `verticalRulesForPage` scans `getOperatorList` for vertical paths
(discarding page-border clip boxes) and `columnBandsFromRules` splits on them,
cross-checked against board-header x clustering. **Announced x-clustering as
"the real fix", measured it as impossible, said so, and found the rules.**

### 2.5 Spare capacity read as a shortfall
`buildCoverage` compared declared ways against extracted ways and alarmed on the
difference. On the Didcot document it raised **ten** completeness alarms. All ten
were false: every board declaring `Spare: n%` had a shortfall equal to exactly
that percentage of its ways, on all 8 boards that stated one. Added
`sparePercent` to `parseBoardHeaderFacts` and subtracted the implied spare ways:

```js
const spareWays = expected != null && Number.isFinite(sparePercent) && sparePercent > 0
  ? Math.round((expected * sparePercent) / 100) : null;
const unaccounted = expected != null
  ? Math.max(0, expected - ways.size - (spareWays || 0)) : null;
```

**A checker that cries wolf ten times gets ignored on the eleventh, which is the
real one.**

### 2.6 Conflicting rows chosen instead of flagged
Two source documents disagreeing about the same way was resolved silently by
whichever parsed last. `conflictingWayRows` now detects it and Review shows a
`wayconflict` item. Product invariant: *never choose between disagreeing source
documents without user review.*

### 2.7 Stale results from the previous project on screen
The owner's screenshot showed notes from an earlier project after loading a new
one — `#anCoverage` was not cleared on the early-return path in `renderResults`.
One line, but it undermines trust in every number on the page.

### 2.8 Poorly-read pages not reported
Pages that OCR'd badly *and* yielded almost nothing were invisible. Added
`unreadablePages` and `poorlyReadPages` with `unreadable` / `poorlyread` Review
items.

---

## 3. Bugs I introduced, and the tests that caught them

Recorded because each one is a trap that looks like a fix.

- **`Number(null) === 0`.** The poorly-read check scored pages with
  `Number(pg.ocrScore)`. Pages that never went through OCR have `ocrScore: null`
  → scored 0 → **all 386 Didcot pages would have been flagged**. Caught by my
  own test before it shipped. A page with an embedded text layer is not a bad
  scan:

  ```js
  // null means the page never went through OCR at all — an embedded text
  // layer is not a poor scan, and Number(null) is 0, which is not a score.
  const score = pg.ocrScore == null ? null : Number(pg.ocrScore);
  ```

- **`DB RING` and `DB DB` as board references.** A regression from my own
  `DB <NAME>` space-separated pattern, which happily matched the word after any
  "DB". Fixed with `DB_NAME_STOPWORDS`.
- **A test that asserted quote-line uniqueness across the whole workbook.** Wrong
  premise: the same device legitimately appears under two different boards.
  Made it per-board.
- **A band test whose fixture was wrong.** I asserted rules at x=400/1300 fell
  outside the header clusters; they fall inside. Moved the case to 40/1900. *The
  test was right and I was wrong, which is the point of having it.*
- **`ExcelJS.addRow` silently producing empty rows.** `test-report-core` loads
  `report-core.js` in a `vm` sandbox, so arrays are cross-realm and `addRow`'s
  array branch fails to recognise them. Every other sheet already wrote
  positionally; the quote sheet now does too (`getCell(r, c).value`). **If a new
  sheet comes back empty in tests but fine in the browser, this is why.**

---

## 4. The held-out evidence

The owner asked for proof the fixes generalise. Six documents were chosen that
were **never opened during the work**, then run before and after:

| document | dialect / vendor | before | after |
|---|---|---|---|
| Broomfield House | Amtech | 0 rows | **180 rows** |
| The Angel | Hevacomp | 0 rows | **25 rows** |
| Kings Road | BES/Brenbar | 1 row, **silently** | reported |
| Ashfield | BAM/EPO | 2 rows, **silently** | reported — **needed no new code** |
| 25057 RevC02 | Syntegral | reported | reported |
| BC250847-E13 | scanned | reported | reported |

Two things matter more than the row counts. **Ashfield improved with no code
change** — the reporting work alone turned a silent near-miss into a visible one.
And the two zeroes were both §2.3, a dialect that never writes the device class,
found on documents chosen at random. That is what generalisation looks like.

Session documents, for reference: Didcot 187 rows / 22 feeds / 0 duplicates;
LV SLD 172 rows / 7 boards / 0 duplicates; DB LP3 50 rows / 2 boards; DB KIT
13 rows with 2 flagged conflicts.

---

## 5. Reading schematics — the part the tool could not do at all

The owner's words: *"this is an example of how i want the tool to read schematic
drawings, because currently it has no capability of understanding a schematic
drawing."* Then, after the first drawing: *"i need fine tuned commands that teach
the team of ai how to read schematic documents."*

A schematic is a **tree, not a table**, and it has three parts that a take-off
needs all of. `schematicPrompt` in `api/_lib/extraction/agent-team.mjs` is
organised that way:

- **PART 1 — the panel itself** (order 18). The titled block *is* a board header.
  *Returning only the boards it feeds is the single most common failure on these
  pages* — the panel is equipment you buy.
- **PART 2 — the incomer** (order 19). Breaker, meter, SPD, CT. Return both
  numbers of "200A SET AT 160A". Metering, SPD and CTs are **not** protective
  devices.
- **PART 3 — the outgoing ways** (orders 20–25). Way number, phase, rating,
  printed type, poles. Models not classes (21). Frame/trip pairs (22). One way
  across L1/L2/L3 is three devices (23). Spares exist (24). A circled M is a
  meter (25).
- **Across all three** (orders 26–33): feeds are relationships, keep both ends
  (26); cable specs are not device ratings (27); feeder pillars carry their own
  devices (28); "BY OTHERS" is returned flagged (29).

### The two annotated drawings, and why both were needed

Orders written from one drawing only encode that drawing's conventions. The
second drawing broke four assumptions the first had quietly installed:

| convention | drawing 1 (PB1) | drawing 2 (SB/4 Daltons) | order |
|---|---|---|---|
| frame + trip | inline, `100/125 A` | **stacked**, setting above frame; same figure twice when set to full frame | 22 |
| out of scope | said in words: `GREY BY OTHERS` | **greyed, said nowhere** | 30 |
| what a way feeds | drawn as a box | **a caption above the way** | 31 |
| cable sizes | on the line | **listed once at the side**, tied only by which line a way touches | 32 |
| busbar | — | own rating, own withstand, own construction form | 33 |

Order 30 is the one to internalise: **greying is a convention, not decoration.**
Where most items are black and a few are washed out, the grey ones are existing,
future, or by others — and the drawing frequently says so nowhere at all.
Dropping them silently is one failure; **pricing them as new is the expensive
one.** Order 32 is its mirror: do *not* attach a cable size to a way the drawing
never linked. Inventing a mapping is not better than reporting that it was not
legible.

### The fixtures, and what they can and cannot assert

`tools/coverage/fixtures/schematic-pb1.expected.json` and
`schematic-sb4-daltons.expected.json` state what a correct reading returns —
itemised, including items marked `"legible": false` where the image was too
coarse. **They are targets, not recordings.** No model has read either drawing in
this environment; there is no extraction key here, and the fixtures say so in
their own `_why`.

`tools/coverage/test-schematic-fixture.mjs` asserts what is assertable without a
model: that the orders instruct an agent to look for **every field the fixtures
use**, that `EXTRACTION_SCHEMA` **has somewhere to put each one**, and that each
fixture's own totals match its own rows. Verified that the checks bite by
breaking each on purpose and watching it fail. *A test that passes the first time
it is run has not yet been shown to test anything.*

Writing the fixtures down is what exposed §7.

---

## 6. Reports — what the owner rejected

The owner sent the tool's own xlsx export alongside four real supplier quotes
(Edmundson, Hager): *"there is an overwhelming amount of info within that will
confuse the user… documents need to be created in an efficient way where it is
simple and easy to read, and it should only contain relevant info necessary for
quoting."*

The real quotes have **four columns**: `# | Product code | Item description |
Quantity`. That is the whole scope of what a supplier needs. So:

- `quoteLines(model)` merges devices by label, per board.
- `createQuoteWorksheet` writes those four columns, positionally (§3).
- Everything else — evidence, page references, confidence, reconciliation — moved
  behind **`reportFullAudit`**, an opt-in checkbox.

The audit detail was never the problem; making it the default was. Nothing was
deleted, and the reconciliation checks are untouched — pricing must never weaken
the take-off (`CLAUDE.md`).

---

## 7. Orders that told agents to return what the schema forbade

Found while writing the SB/4 fixture, and worth stating as a general lesson.
`EXTRACTION_SCHEMA` sets `additionalProperties: false`, so a field the schema does
not name is **rejected** — the agent does the work and the value is thrown away
with no error anywhere. Four orders were in that state:

| order | asked for | schema had | now |
|---|---|---|---|
| 22 | frame **and** setting | `rating_a` only | `frame_a`, `setting_a` |
| 30 | which item is drawn greyed | nothing per-device | `drawn_greyed` |
| 32 | board-level cable specs | nothing | `board_cables[]` |
| 33 | busbar rating + withstand | `incomer_rating_a`, `fault_ka` | `busbar_rating_a`, `busbar_withstand_text` |

`busbar_rating_a` is deliberately **not** `incomer_rating_a`: a 250A busbar
behind a smaller incoming switch is routine, and one field cannot hold both.
New numeric fields were added to `NUMERIC_FIELDS` at the same time — a number
left as `"63"` reaches the report as a string and silently fails every
comparison.

**Rule going forward: an order and a schema field ship together.** The fixture
test now enforces it for the schematic orders.

---

## 8. Dead ends — do not retry these

- **Excluding lines that carry circuit rows from board segmentation.** Sounds
  obviously right. Measured: boards 4 → 3, duplicate rows 14 → 24. Reverted, and
  the measurement is recorded in a comment at the site so nobody tries it again.
- **Clustering text x-positions to find column boundaries.** Impossible on real
  sheets: widest corridor 1.2% of the page span (§2.4). Use the ruling lines.
- **`ExcelJS.addRow` with an array in a `vm` sandbox.** Cross-realm arrays; write
  positionally (§3).

---

## 9. Where the same logic lives three times

Extraction logic is spread across **three files with overlapping copies**, and
the overlap is not uniform — verified by grepping for the functions themselves:

| function | `extractor-core.js` | `index.html` | `tools/coverage/app-pipeline.cjs` |
|---|---|---|---|
| `parseScheduleLine` | — | ✓ | ✓ |
| `parseMirroredChartLine` | ✓ | ✓ | — |
| `columnBandsFromRules` | ✓ | ✓ | — |
| `selectBestOcrCandidate` | ✓ | ✓ | — |

So a row-parsing change lands in `index.html` + `app-pipeline.cjs`, while a
layout or OCR change lands in `index.html` + `extractor-core.js`. Changing one
and not its partner produces the worst possible symptom: **tests pass and the app
is broken**, or the reverse. Unifying them is worthwhile future work; until then,
grep all three and check this table is still accurate.

Note `extractor-core.js` trips ripgrep's binary detection — use `grep -a` (or
`Grep` with an explicit glob) or searches will silently return nothing.

---

## 10. What is NOT proven (be honest about this)

- **The agent path has never been exercised by a real model in this
  environment.** There is no extraction key here. Every schematic order and both
  fixtures are, at this moment, *specifications* — checked for internal
  consistency and for schema fit, not for model behaviour. This is the largest
  untested lever in the project and the first thing to run when a key exists.
- **`graphify-out/` contains code structure only, and is not committed.** Measured
  after `graphify update .`: 730 nodes, 1178 edges, 48 communities, and **every
  single node carries `_origin: "ast"`** — not one came from prose. Two reasons,
  both worth knowing:
  1. A full `graphify .` build refuses to run here: *"no LLM API key found
     (67 doc/paper/image file(s) need semantic extraction). Set GEMINI_API_KEY or
     GOOGLE_API_KEY"*. `graphify update .` works without a key but is AST-only by
     design.
  2. `graphify-out/` is in `.gitignore` (line 27), so the graph does not survive a
     container reset. It is a **derived index**, rebuilt for free from the code by
     `graphify update .` — it is not storage.

  So: the graph is good for *"what calls what"* and worthless as memory of *why*.
  **This file is the persistent memory** — committed, greppable, and it survives
  the container. When a `GEMINI_API_KEY` is set and `graphify .` is run, this file
  is one of the 67 documents that will be indexed into the graph as well; until
  then, no claim should be made that the history is "in graphify."
- Row counts in §4 are from specific commits on specific documents. They are
  evidence that a defect was fixed, not a guarantee of current behaviour.
