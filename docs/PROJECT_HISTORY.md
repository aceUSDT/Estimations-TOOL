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

### 2.8 The take-off discarded every row whose sheet never named the class
**Found by running the tool before handing it to the owner, not by a test.**
Broomfield House: 16 boards found, 180 rows extracted, and the export came out
**empty**. The badge read *"16 boards, 0 devices."* One line, `includeRow` in
`report-core.js`:

```js
if (!row || row.status === "rejected" || row.space || !row.device) return false;
```

Every row on that document carries `device: null` — §2.3 again, the dialect that
never writes MCB. The parser fix was correct and the report stage threw the
result away. **Extraction succeeded and delivered nothing, which at the only
point the user looks is indistinguishable from failure.**

A way with a rating is a device even when the sheet won't name its class. Those
rows now enter the take-off as `Unclassified device` with a review reason.
Broomfield went from an empty export to **159 devices across 78 quotation
lines**; The Angel returns 22. (§2.10 then raised Broomfield to 181 and 91 — the
159 is the number this fix alone produced, kept so the two changes stay
separable.)

**Four call sites had to agree** and it took two runs to find them all:
`includeRow` decides inclusion, `deviceSpecification` sets the family used for
grouping, `deviceLabel` **independently re-derived** the family from
`canonicalDevice` (so the first attempt grouped rows as unclassified then
labelled them "Other device"), and `projStats` in `index.html` computes the
badge. If one changes, all four change.

*Lesson: "180 rows extracted" was the number I reported as a held-out success.
It was true and it measured the wrong thing — rows in Review, not devices in the
take-off. Measure the artefact the user receives, not an intermediate.*

### 2.9 A scanned consumer-unit chart that reported nothing at all
`examples/consumer-units/Dundee_CU-Circuit-Chart.pdf`: five pages, three of them
circuit charts, **all typed `unknown`** → schedule walk never ran → 0 boards,
0 rows. And because a page that is not a schedule cannot be a schedule with no
rows, the three chart pages were reported **nowhere**. A silent zero.

Two causes stacked:
- this dialect writes **"Board Identity"** and **"No of Ways"**, never
  "reference" or "board schedule", so the `headerBlock` signal could not see it
  (the CU vocabulary was already documented in `domain-pack.mjs`; the classifier
  had just never learned it);
- the page is scanned, and OCR returned the *header* legibly while the rows came
  back as pipes and fragments, so no row-shape signal fired either.

Added a `cuHeaderBlock` signal in **all three** classifier copies. Deliberately
tolerant of OCR damage — page 4 read "No of Ways" as *"lo of Ways"*, so the
incomer phrase carries it. Now: pages 3–5 type `db-schedule`, page 4 is reported
`unreadable` (0.6745 against the 0.68 floor) and pages 3 and 5 are reported
`poorlyRead` with their scores and row counts.

**Still 0 rows — and that is the honest outcome.** Those rows genuinely cannot be
read. The change converts a silent zero into a reported one, which is the whole
of the invariant. Regression test in `test-schedule-pages.mjs` uses the OCR text
verbatim, damage included, asserts the cover and issue-record pages are *not*
dragged in, and checks the copies agree; verified it bites by breaking each copy.

### 2.10 A damaged phase cell lost the whole row, not just the phase
Broomfield House again, chasing the 88-of-170 unaccounted ways. Amtech prints the
phase column as `L1L2L3` for a three-phase way and the scan loses the repeated
L's — verbatim from page 15: **`L213`**, **`L1L213`**, **`L123`**.

The damage did not mis-read the phase. It lost the **entire row**. All three
way/phase marker patterns required a single `L[123]`, so nothing matched; with no
marker the positional-rating scan never ran; and the guard in `parseScheduleLine`
then saw no way, no device and no rating and returned null. Five ways gone off
one page, four of them carrying real devices at 16A, 32A, 16A and 25A.

```
 21   2 L213    Load-255 16    way 2, 16A three-phase — dropped
 23   3 L1L213  Load-256 32    way 3, 32A            — dropped
 35   8 L123    0              way 8                 — dropped
```

Fix: a phase cell is `L[123](?:L?[123]){0,4}`, reduced to its **distinct** phase
digits rather than trusting the spelling. `{0,4}` and not `{0,2}` — clean
`L1L2L3` needs two, but damaged `L1L213` is `L1` + `L2` + `1` + `3` and matches
nothing shorter. A two-phase cell stays two phases; inflating it to three would
invent a pole on a device someone has to buy.

Measured, whole document:

| | before | after |
|---|---|---|
| ways captured (of 170 declared) | 86 | **121** |
| unaccounted ways | 88 | **59** |
| devices in the take-off | 159 | **181** |
| quotation lines | 78 | **91** |
| rows on page 15 (DB-K) | 7 | **13** |

**A test that passed for the wrong reason.** The repaired-cell confidence penalty
was asserted on a *classless* row — already below the review threshold because it
names no device — so the check held while the penalty did nothing. Found by
deleting the penalty and watching the test still pass. Worse, the original 0.05
nudge was useless by design: a row naming its device sat at **0.92**, which
presents as settled. A rebuilt phase cell decides the **pole count**, and a
three-pole device priced as single-pole is a real costing error, so confidence is
now *capped* at 0.75 and the assertion runs against a row that would otherwise be
confident. *Mutate the code to prove the test bites — passing is not evidence.*

**Then page 17 damaged the same cell a different way.** OCR substitutes the
digits' **look-alike letters**: `L1L2L3` arrives as **`LiLzLs`** — i for 1, z for
2, s for 3 — losing ways 7 and 9 and their 32A and 10A devices. The character
class now carries those letters, scoped to the token sitting where a phase cell
belongs so an ordinary word cannot be caught ("Lighting" needs a word boundary
after "Li" and has none; verified against *Lighting, LIST, Laundry, Isolator,
Lift, Lounge*).

Two details that only surfaced by probing the built pattern rather than trusting
it:
- I had added the **broken bar** `\u00a6` as another 1-look-alike. It never
  matched anything. Removed — a character in a regex that cannot be shown to work
  is speculation, and no document showed it.
- **`Ll` matched the pattern but produced a null phase.** `toUpperCase()` turns a
  lowercase `l` into an `L`, indistinguishable from the cell's own separator,
  before the fold can read it as a 1. The lowercase pass now runs *first*.

### 2.14 A panel named in words, and ways identified by what they feed
`MCCB-Schedule_BowGreen.pdf` — 19 pages of 400A and 100A MCCBs — produced a
take-off of **four devices**, and because no board on it declares a way count,
completeness reported nothing missing. A confident, near-empty take-off is the
worst artefact this product can produce.

Two causes, one hidden behind the other:

**The panel itself never resolved.** Its header reads `Board Ref: Main Landlord
MCCB Panel board`. The label matches, but the value is words, and the guard after
it requires a digit or punctuation — deliberately, so body text cannot invent
boards. With no board, every row on every one of its pages was orphaned. The
descriptive-name fallback that would have caught it only ran for the literal
spelling `REFERENCE`, never for `Board Ref:`.

**The rows name the board they feed, not a way.**

```
DB/LL/D       a5   400A ML2.2
DB/LL/COMMS - Comms Room LTG & PWR  G  35  186  100A ML2.2
```

The way numbers are largely lost to the scan, and `parseScheduleLine` requires a
way marker, so the most expensive devices on the schedule never reached the
take-off. Now: a board section must be open, the line must name **exactly one**
board other than the section's own, carry a rating, and not be the incomer —
captured with `way: null`, `feedsBoardNorm` set, and confidence capped at 0.7 so
it reaches Review rather than presenting as settled.

| | before | after |
|---|---|---|
| BowGreen devices | 4 | **23** |
| quotation rows | 20 | 33 |
| Dundee boards | 0 | 1 (its device attributed rather than homeless) |

Broomfield unchanged at 194, The Angel at 26, Kings Road at 1.

**Three tests in this session passed for the wrong reason, and this change
produced two of them.** The negative cases for the keyword guard were rejected
earlier by the label pattern; the two-board case began `Note:` and was rejected
as a note line. Both guards could be deleted with every check still green. Found
by mutation, not by review — `Board Ref: Bow Green Phase Two` and
`DB/LL/D and DB/LL/E 400A ML2.2` are the cases that actually reach them.

*If a guard is worth writing, delete it and watch a test fail. If none does, the
guard is untested however many checks surround it.*

### 2.13 An expected outcome thrown as an exception cost 16 of 19 pages
`MCCB-Schedule_BowGreen.pdf` read **3 of its 19 pages** and said nothing about
the other 16. Not slowly — it stopped.

```
page 4: "OCR completed but found no readable words on this page"
        at ocrPdfPage (index.html:2274)
```

That is an **expected** outcome — line-work, a photo, a blank sheet — and this
tool already has a reporting category for exactly it. Throwing was wrong twice:

1. The throw sat **above** the recording block, so the page never got `pg.ocr`,
   kept `needsOcr`, and never had `ocrUnreadable` set. It was then invisible to
   every check in `buildCoverage`: no text ⇒ cannot look schedule-ish, no score
   ⇒ cannot be poorly read, and `unreadable` is only ever set by a *completed*
   pass.
2. It propagated to `ocrScannedPages`, whose `catch` did **`break`**.

So one page of line-work abandoned the sixteen behind it. Confirmed in page
state: pages 4–9 all sat at `needsOcr: true, ocr: false, unreadable: false`.

| | before | after |
|---|---|---|
| pages read | 3 / 19, stalled indefinitely | **17 / 19 in ~100 s** |
| wordless pages | silently lost | reported in `unreadablePages` |
| boards found | — | 26 |

Fixes: `ocrPdfPage` records a wordless page as unreadable instead of throwing;
`ocrScannedPages` continues past a failure, names **every** failed page, stamps
`ocrFailed` on the page so Review outlives the toast, and stops only after three
*consecutive* failures (a broken pipeline, not a bad page); `buildCoverage` gains
`neverReadPages` for pages that produced no text at all.

**The measurement instruments were themselves the reason I misdiagnosed this.**
`probe-rows` and `probe-pages` both wait on `pages.every(p => p.lines.length)` —
a condition a legitimately wordless page can *never* satisfy. That is why
`probe-pages` died with a `TimeoutError` and `probe-rows` appeared to run for 25
minutes, and it is why I first reported this to the owner as a **speed** problem.
It was never speed: the document always processed in about 100 seconds. Two
further wrong turns before the right one — page dimensions (measured identical to
Broomfield's) and the OCR escalation ladder (real, but 2–3 passes here, not
runaway).

*Lesson: when a probe says "slow", check whether it is measuring "slow" or
"waiting for something that will never happen". `probe-ocr-progress.mjs` samples
progress instead of waiting for it, which is what finally showed the stall.*

### 2.12 A dialect the agents were told about, that the parser could not read
Found by checking this round's changes against row shapes from dialects I had
**not** been iterating on — the discipline the owner asked for, applied to my own
work rather than to the tool.

The slash marker `7/L1`, `12/L3` is documented in this repository **twice**:

```
docs/BUILD_BRIEF.md:169   Syntegral: Way "CCT n" (+ "n/Lx" for 3-phase)
domain-pack.mjs:24        syntegral: ways as "CCT n" or "n/Lx"
domain-pack.mjs:27        hevacomp:  "7/L1 20 6.0 2.5 LSF Singles Fixed power ..."
```

`parseScheduleLine` handled dash (`5-L1`), compact (`17L2`) and spaced (`1 L1`)
markers — and returned **no row** for all three documented slash examples. So the
dialect the **agents are instructed about** in `domain-pack.mjs` was one the
deterministic parser could not read at all.

It never surfaced because the Hevacomp example document writes the compact form
and the Syntegral one is an unreadable scan. **No example PDF in the repository
exercises this shape**, so the tests use the documented lines verbatim rather than
a measured capture, and say so. That is a weaker kind of evidence than everything
else in this file and is labelled as such.

The leading `L` is what makes it safe: `7/12`, `3/4`, `2/3` and `Page 7/32` all
appear on these sheets and none of them can match.

*Lesson: the domain pack and the parser are two descriptions of the same
dialects, and nothing was checking they agreed. Where the pack documents a row
shape, the parser should read it.*

### 2.11 A damaged rating token was scanned past, producing a WRONG number
Found because the look-alike fix surfaced a Hevacomp row that had been dropped:

```
3Lz  3z2*  15  1x2corex2.5 … Radial 13A sockets     way 3, really 32A
```

`3z2*` is OCR of `32*`. The positional scan skipped it as "contains a letter" and
took the next number on the row — **the cable size** — reporting a 32A circuit as
**15A**. Falling back to the whole-line rating scan is no better: the only "A" on
a Hevacomp row is in its description, so it reports **13A**. A wrong rating in a
quotation is worse than an absent one.

A token *starting* with a letter is an identifier (Amtech's `Load-255`) and the
scan continues. A token starting with a **digit** that still will not parse is
damaged: the scan stops, the rating stays **unknown**, and the row goes to Review
carrying its way and phase. Separately, `10%` — OCR of `10*` — now parses as 10;
a trailing annotation mark is not damage, and without it a 10A circuit read as
**1A** off the cable column.

Broomfield, cumulative across §2.10 and §2.11: ways captured **86 → 158** of 170,
unaccounted **88 → 27**, devices in the take-off **159 → 194**, with 18 lines
flagged for review.

**What still accounts for the remaining 27.** OCR digit damage the parser should
not guess at: way 6 arrives as `[3`, and way 11 as `1` — which collides with the
real way 1 and is correctly reported as a way conflict rather than silently
merged. Recovering those means inferring a way number from its position in the
sequence, which is a guess about a priced item. Flagged, not guessed.

### 2.11 Poorly-read pages not reported
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
| Broomfield House | Amtech | 0 rows | **180 rows** — but see §2.8: the take-off was still EMPTY. Now 181 devices. |
| The Angel | Hevacomp | 0 rows | **25 rows**, 22 devices in the take-off |
| Kings Road | BES/Brenbar | 1 row, **silently** | reported |
| Ashfield | BAM/EPO | 2 rows, **silently** | reported — **needed no new code** |
| 25057 RevC02 | Syntegral | reported | reported |
| BC250847-E13 | scanned | reported | reported |

**Read the row counts with §2.8 in mind.** "180 rows" was reported here as a
success and it measured the wrong thing — rows in Review, not devices in the
take-off, which was empty. Row counts are an intermediate. The artefact the
estimator receives is the number that matters.

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
| page classification | ✓ `classifyPageText` | ✓ `classifyPage` | ✓ `classifyPage` |
| `parseMirroredChartLine` | ✓ | ✓ | — |
| `columnBandsFromRules` | ✓ | ✓ | — |
| `selectBestOcrCandidate` | ✓ | ✓ | — |

Page classification is the worst of these — **three** copies, and §2.9 had to be
applied to every one. Note the test suite reaches the `app-pipeline.cjs` and
`extractor-core.js` copies but **not** `index.html`'s; that one is only covered
by driving a real browser (the probes below).

So a row-parsing change lands in `index.html` + `app-pipeline.cjs`, while a
layout or OCR change lands in `index.html` + `extractor-core.js`. Changing one
and not its partner produces the worst possible symptom: **tests pass and the app
is broken**, or the reverse. Unifying them is worthwhile future work; until then,
grep all three and check this table is still accurate.

Note `extractor-core.js` trips ripgrep's binary detection — use `grep -a` (or
`Grep` with an explicit glob) or searches will silently return nothing.

---

## 10. What is NOT proven (be honest about this)

- **The agent path has never been exercised by a real model FROM THIS
  CONTAINER**, and that is a narrower statement than it first appears. Keep the
  two environments apart:
  - *This container* (where the tests and probes run) has no `GEMINI_API_KEY` and
    no `NVIDIA_API_KEY_n`. So every measurement in this file exercised the
    **deterministic reader only**.
  - *The Vercel deployment* has had `GEMINI_API_KEY` and `NVIDIA_API_KEY_1..7`
    set for Production and Preview since 2026-07-27. Verified by running
    `engineStatus()` against those exact names: the pool counts 7 keys and health
    reports `mode: "agent-team"`, `primary: "nvidia"`.
  - I cannot bridge the two: preview deployments are behind Vercel SSO (an
    anonymous request 302s to `vercel.com/sso-api`), so the deployed endpoint
    cannot be called from here.

  So the schematic orders and both drawing fixtures remain *specifications* as
  far as **this** record goes — checked for internal consistency and schema fit,
  never against model output. They are exercised the moment a schematic is
  uploaded to the deployed app, and that result belongs in this file when someone
  observes it.

  Two details found while verifying the wiring, both worth keeping:
  - a key is only counted when it is **longer than 8 characters**
    (`poolKeysFromEnv`). A short dummy value reports `nvidia: false`, which looks
    exactly like a misconfiguration — my first wiring test made that mistake and
    would have had me reporting a working setup as broken.
  - `GEMINI_VERIFY_MODEL` is unset, so `verify` is false and the second-opinion
    pass does not run. Optional, but it is a check nobody is currently getting.
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

## 11. Running a real document (how §2.8 and §2.9 were found)

Neither defect had a failing test. Both were found by putting a real document
through the app and looking at what came out the far end. Do this before claiming
anything works:

```bash
python3 -m http.server 8765            # required by every probe
node tools/coverage/probe-rows.mjs   <file.pdf>   # rows per board, collisions, feeds
node tools/coverage/probe-pages.mjs  <file.pdf>   # per page: type, OCR score, first lines
node tools/coverage/probe-review.mjs <file.pdf>   # way conflicts, completeness, what is REPORTED
node tools/coverage/probe-quote.mjs  <file.pdf>   # the quotation sheet as text
```

`probe-quote` is the one that matters most, because it is the only one that shows
the artefact the estimator actually receives. `probe-rows` said 180 and
`probe-quote` said empty, on the same document, at the same commit.

**Two traps in reading probe output**, both of which cost me a wrong conclusion
before I checked:
- the OCR score is at **`page.ocr.qualityScore`**, not `page.ocrScore`. Reading
  the wrong property returns `undefined`, which looks exactly like "OCR never
  scored this page."
- unreadable and poorly-read pages live **inside `analysis.coverage`**, not at the
  top level of `analysis`. Looking at `analysis.unreadablePages` returns empty
  and looks exactly like "nothing was reported."

Both mistakes make the tool look more broken than it is. Check the shape of the
object before drawing a conclusion from a zero.
