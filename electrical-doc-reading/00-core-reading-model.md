# 00 — Core Reading Model

The spine. Everything else in this reference assumes the engine works this way.

---

## The failure this exists to prevent

Observed defect, real document, OCR reported at 100%:

```
row text captured:  L2 | 60898 | C | 32 | 10 | × | × | POWER FOR CONDENSER | Rd | 6 | 6 | A | C/E | 0.4 | 0.68
tool output:        MCB 6A
correct answer:     32 A Type C MCB, 10 kA
```

Every token was read correctly. The `6` is the live conductor CSA and the `A` is
the installation reference method letter; they sit adjacent in the flattened
string and look exactly like a rating. The actual rating, `32`, is four columns
earlier.

**Figure:** [V-01 — a cell's meaning comes from its column](diagrams/v01-column-binding.png)

**This is not an OCR problem and no amount of better OCR fixes it.** Both `6` and
`32` are valid device ratings in isolation. Only x-position separates them. A
parser that scans a row string for `\d+\s*A` will always be wrong roughly as
often as it is right, and will be *confidently* wrong.

---

## The five-phase pipeline

Do not collapse these phases. Each one's output is the next one's input, and
skipping straight to phase 4 is the root cause of the defect above.

```
1. ACQUIRE      → words with bounding boxes
2. RULE         → column bands and row bands
3. BIND         → cell grid (value ⟷ column ⟷ row)
4. INTERPRET    → domain fields
5. RECONCILE    → cross-check, flag, emit
```

---

## Phase 1 — Acquire

Get **words with coordinates**, never a flat string.

- Vector PDFs: `pdftotext -bbox-layout`, or PyMuPDF `page.get_text("words")` →
  `(x0, y0, x1, y1, word, block_no, line_no, word_no)`. PyMuPDF is preferred;
  it also gives you drawings (`page.get_drawings()`) which phase 2 needs.
- Scanned PDFs: rasterise at ≥300 dpi and OCR with word-level boxes
  (`pytesseract.image_to_data`). 10 of 146 corpus PDFs need this.
- **Detect rotation per text span.** MCCB and switchboard schedules routinely
  set column headers at 90°. A rotated header extracted as body text destroys
  the header row. PyMuPDF exposes `dir` on spans; use it, and rotate the
  bounding box into page space before banding.

- **Handle page rotation before anything else.** A page carrying a `/Rotate`
  entry returns text coordinates in *unrotated* space — y-values exceed the
  stated page height and every box sits in the wrong frame. Read
  `page.rotation` and transform word and drawing boxes into rendered page space,
  then assert every box falls inside the page rect. `2425.009.E12 Clubhouse
  Distribution Schematic.pdf` in the corpus does this; a page that looks
  perfectly readable produces a grid that is wholly wrong. Where the transform
  is uncertain, work in raster pixel space from `get_pixmap()` — the render is
  always in the displayed orientation.

Decide the route by evidence, not by extension: run `pdffonts`; an empty font
table means there is no text layer regardless of what the file claims.

**Hybrid pages are real.** Several corpus documents are vector drawings with
scanned raster inserts. Detect per-region, not per-page.

> Worked end to end on one real row: [V-07 — the five-phase pipeline](diagrams/v07-pipeline.svg).

---

## Phase 2 — Rule the grid

Recover column and row bands. Two sources, used together:

### 2a. Ruling lines (preferred where present)

Most schedules are drawn as real tables. Extract vector line segments, keep
those longer than ~30% of the table bbox, cluster verticals by x and
horizontals by y. This gives exact band edges.

### 2b. Whitespace projection (fallback)

Where lines are absent or partial: project word boxes onto the x-axis, find
gutters — x-ranges with zero ink across the majority of rows. Bands are the
intervals between gutters.

### 2c. Header banding — the part that is usually got wrong

**Figure:** [V-03 — when the header stacks vertically, so does the row](diagrams/v03-stacked-header-rows.png)

Headers in this domain are **hierarchical and multi-row**. A header cell may
span several columns and sit above sub-headers that do the real column work:

```
|            Overcurrent Protective Device            | Circuit  |   Wiring Details    |
| Way | Device | Type | Rating | SCC  |  RCD Op. Current | Ref.  | Type | Live | CPC |...
|     | BS(EN) |      |  (A)   | (kA) |  ×/✓   |   (mA)   |       |      |(mm²) |(mm²)|
```

Rules:

- A header **group** spans the union of its children's x-ranges. Resolve
  parent → child by x-containment, and build the canonical field name from the
  path (`overcurrent_protective_device.rcd.operating_current_ma`).
- Header rows are identified by: position above the first data row, distinct
  fill or bold, and vocabulary match against `01-field-lexicon.md`. Require at
  least two signals — fill alone misfires on shaded section rows.
- **The header may repeat mid-document** (per board, per page). Re-detect on
  every page; do not cache the header from page 1 across a 413-page file. In
  the corpus, `KFH-QRL-BA-XX-SH-E-5001.pdf` changes its device column header
  between `CPD` and `MCCB/MCB` at different boards *within the same file*.
- Some dialects stack **field names vertically down the header block**, so that
  each physical line of a data row group maps to a different field. See
  Trimble/ProDesign in `03-dialect-profiles.md`. Detect this by: header block
  has N stacked lines, and data appears in repeating N-line groups.

### 2d. Row banding

**Figure:** [V-02 — identical geometry, opposite meaning](diagrams/v02-row-grouping.png)

Cluster words by y. Then:

- **Merge vertically spanned cells downward.** A way number in a merged cell
  applies to every row in the span. Detect via ruling lines (no horizontal
  divider inside the span) or via a value present in the first row of a group
  and absent in the rest while other columns are populated.
- **Bracket glyphs mean a phase group.** `\` above and `/` below a data row,
  or a `{` spanning three rows, means one three-phase circuit occupying three
  ways. Corpus example: `KFH-QRL-BA-XX-SH-E-5001.pdf` p.2, ways 1L1/1L2/1L3.
  Rows 1L1 and 1L3 are *not* empty ways.
- **Multi-line wrapped text is one row.** Long circuit descriptions and device
  strings wrap. Join continuation lines into the owning row before interpreting.

---

## Phase 3 — Bind

Every word is assigned to exactly one cell by **x-overlap with a column band and
y-overlap with a row band**.

```python
def bind(word, col_bands, row_bands):
    col = max(col_bands, key=lambda b: overlap(word.x0, word.x1, b.x0, b.x1))
    row = max(row_bands, key=lambda b: overlap(word.y0, word.y1, b.y0, b.y1))
    if overlap_ratio(word, col) < 0.5:
        return AMBIGUOUS          # straddles a boundary — flag, never assign
    return Cell(col, row)
```

A word that straddles two bands by more than the threshold is **ambiguous**, not
assigned to the nearest. Emit it as a low-confidence cell and let reconciliation
or the operator resolve it. Silent nearest-neighbour assignment is how the
`6A`/`32A` class of error gets reintroduced.

At the end of phase 3 you have a grid. **Nothing domain-specific has happened
yet, and nothing domain-specific should have.** If the grid is wrong, every
downstream rule is operating on fiction.

---

## Phase 4 — Interpret

Only now apply meaning. Map columns to canonical fields via
`01-field-lexicon.md`, classify devices via `02-device-rules.md`, and resolve
per-document legend codes.

**Figure:** [V-08 — deriving device class](diagrams/v08-device-class-decision.svg)

Two rules that carry most of the weight:

- **Scoped inheritance.** Full-width rows partition the table. A row like
  `METER SECTION 2 — MECHANICAL POWER` or `SURGE PROTECTION DEVICE TYPE 1+2`
  spans all columns and is not a circuit. Section headers set context for
  everything below until the next one. Distinguish *partition rows* (context,
  not counted) from *device rows* (an SPD is a real item to count) by whether
  the text names a device — see `05-trap-catalogue.md` T-08.
- **Vertical scope from a column.** Where an RCD is shown once against a block
  of ways rather than per way, the protection applies to every way in the
  block. Resolve the span from ruling lines or from a bracket glyph. Getting
  this wrong turns RCBOs into MCBs, which is a ~3× unit-cost error.

---

## Phase 5 — Reconcile

Never emit an unreconciled take-off. Minimum checks:

| Check | Source A | Source B | On mismatch |
|---|---|---|---|
| Way count | populated + spare rows | board header `No. of Ways` | flag board |
| Board feed | schedule `Supply From` / `DB Fed From` | schematic outgoing way | flag pair |
| Upstream device | schedule incomer block | schematic way annotation | flag pair |
| Cable size | schedule conductor column | schematic cable annotation | flag pair |
| Phase totals | sum of per-way loads | board `Total Connected Load` | flag board |
| Board rating | board header | upstream device rating | flag if incoherent |

Coverage gate: if fewer than a configurable fraction of expected ways were bound
for a board (default 90%), mark the board `INCOMPLETE` and exclude it from
totals rather than under-reporting a quantity.

---

## Confidence, and what to do without it

Every emitted field carries a confidence and provenance. Three bands:

- **high** — bound cleanly inside one column band, value parsed, cross-check passed.
- **medium** — bound cleanly but no corroborating source, or a legend code
  resolved from a legend on a different page.
- **low / flagged** — ambiguous binding, placeholder value, failed cross-check,
  conflicting sources, or an unresolvable legend code.

Anything below high is surfaced in the review UI with its source crop. Nothing
below high is silently priced.
