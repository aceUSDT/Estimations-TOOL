# 09 — Visual Examples

Nine annotated figures in `diagrams/`. Six are real pages from the corpus with
the geometry drawn on top; three are derived diagrams built from measurements
taken out of the corpus and the issued quote.

Read this file alongside `00-core-reading-model.md` and `05-trap-catalogue.md`.
Every figure names the trap it guards, and every trap in the catalogue that has
a figure links back here.

| Figure | Teaches | Guards | Source |
|---|---|---|---|
| [V-01](diagrams/v01-column-binding.png) | A cell's meaning comes from its column, not its content | T-01 | *DB Schedules – Main house & Flats*, p.8 |
| [V-02](diagrams/v02-row-grouping.png) | Identical geometry, opposite meaning | T-04, T-05, T-06 | same page, ways 1–4 |
| [V-03](diagrams/v03-stacked-header-rows.png) | When the header stacks vertically, so does the row | T-07, T-15, T-16 | *DB LL GF C1 Rev C1*, p.1 |
| [V-04](diagrams/v04-checkbox-form.png) | The selection is a shaded box, and it isn't in the text layer | T-10 | *SRP1053…6852 Composite DB*, p.2 |
| [V-05](diagrams/v05-legend-collision.png) | The same letter, two different cables | T-09 | OCSC MCCB schedule p.14 · `DB_schedules_0.docx` |
| [V-06](diagrams/v06-schematic-junctions.png) | A crossing is not a connection | T-21, T-22, T-23 | *2425.009.E12 Clubhouse Schematic* |
| [V-07](diagrams/v07-pipeline.svg) | The five-phase pipeline, worked on one row | — | derived, worked on *Main house & Flats* p.8 |
| [V-08](diagrams/v08-device-class-decision.svg) | Deriving device class | T-02, T-03 | derived |
| [V-09](diagrams/v09-module-blank-arithmetic.svg) | Blanks are computed, never read | T-20 | Hager quote 205696330-rev6 |

---

## V-01 · A cell's meaning comes from its column, not its content

Board DB-AL-RF, way 1. The figure shows the row with its eleven column bands
recovered from ruling lines, then the same row flattened to the string a regex
would see.

Three numeric tokens survive flattening — `32`, `6`, `5` — and all three are
plausible device ratings in this domain. The correct answer, 32 A, is in the
`CPD Size(A)` band; `6` is the live conductor CSA and `5` is the core count.

Nothing in the text separates them. Only x-position does. This is the same
failure shape as the original defect (`Rd 6 6 A` misread as a 6 A device), on a
different document, which is the point: it is not a quirk of one schedule.

**Column edges used, in PDF points:** 54.5 · 98.5 · 137.2 · 178.2 · 255.5 ·
308.7 · 356.2 · 436.0 · 655.0 · 821.7 · 976.3. Recovered from vector line
segments, not guessed from whitespace.

---

## V-02 · Identical geometry, opposite meaning

The best single teaching case in the corpus, and it is on the same page.

Ways 1, 2 and 4 are `3PH` — one device spanning three sub-rows, all data on the
middle row, L1 and L3 carrying only a phase label. Way 3 is `1PH ×3` — three
*different* circuits (CONDENSER CU-07 1F, CU-08 2F, CU-09 3F) sharing one way
number.

The merged-cell shape is identical. Only the `1ph/3ph` column tells them apart.

- way 1 → **1 device**, 3 way occupancies
- way 3 → **3 devices**, 3 way occupancies

A parser that groups by "way number present in the first sub-row" builds the
same structure for both and counts them the same way. On this one board that is
a 2× device-count error; on a plant board with many three-phase circuits it
compounds hard, and it is invisible in the output.

---

## V-03 · When the header stacks vertically, so does the row

Trimble / Amtech ProDesign. The header block is three stacked lines, and each
circuit is a four-line group where line *n* maps to header line *n*:

| line | maps to | content |
|---|---|---|
| 1 | Way · Id No · Cable Type · Cores · Phase · Connected To · **Overcurrent Protective Device** · Rating (A) | `1 · Lighting · Multicore 90°C thermosetting LSF · 1 x 1 x 3c · 1.5 · Lighting · "Hager, RCBO, ADC4 - 10kA - 1P+N, C Curve - Type" · 6` |
| 2 | *(wrap)* | `"A - 30mA"` — continuation, not a new row |
| 3 | Phase · Name · Sep. CPC · Connected To Name · **Earth Fault Protective Device** · Trip Rating (A) | `L1 · Bin Store & Multifunction Room · 0 · … · None · 0.03` |
| 4 | **Arc Flash Protective Device** · Rating (A) | `None · N/A` |

Read line by line, the RCD lands in the overcurrent field and the AFDD lands in
the RCD field. Two further points only become visible once the grouping is
right: `Trip Rating (A) = 0.03` is 30 mA (T-15), and `None` in the Earth Fault
slot means *no separate RCD device* — the OCPD is already an RCBO with integral
30 mA protection, so the way **is** residual-protected (T-16).

---

## V-04 · The selection is a shaded box, and it isn't in the text layer

The composite board specification form. Text extraction returns
`Form 1 2a 3a 4a 2b 3b 4b` and `Isolator / Fuseswitch / MCCB / ACB` — every
option, with no indication of which applies. The answer is only in the drawing
layer.

Detection detail worth knowing before you write the code: **the checkbox outline
is drawn as four thin filled bars** (11.5 × 1.8 pt and 1.8 × 12 pt), not a
stroked rectangle. Searching for small stroked rects returns nothing; searching
for small filled rects returns only the 25 *selected* boxes. To get option
groups you have to reconstruct the outlines from the bars, then test each for an
enclosed grey fill.

On this one sheet, 90 checkboxes, 25 filled. Two groups do not resolve:

- `Trench/duct available` — **neither** Y nor N filled → `checkbox_unanswered`
- `Surge Protection Device` — **both** Y and N filled → `checkbox_conflict`

Neither may be guessed. Fields recovered here are commercially significant:
Form of separation, board Type, incoming and outgoing device type, neutral
busbar, IP rating, metering, SPD, spare fuse/breaker.

---

## V-05 · The same letter, two different cables

Two legends from the same corpus, side by side. Five of eight letters disagree:

| code | OCSC MCCB schedule | DB schedule in the docx review |
|---|---|---|
| A | LSOH / LSOH cables | XLPE/LSZH/SWA/LSZH |
| B | LSOH cables in metallic conduit | LSF flat multicore cables |
| C | LSOH cables in non-metallic conduit | MICC / FP400 |
| E | LSOH cables in non-metallic trunking | FP 200 Gold |
| H | Fire rated cables | FP600 |

Only D, F and G happen to be compatible, and that is coincidence, not a
convention. A cached or hardcoded cable-code table is a silent mispricing
engine — the output looks like an ordinary take-off line with the wrong cable
against it.

Resolve every code against the legend on its own document; a code with no
matching legend entry is `legend_unresolved` and is not priced.

---

## V-06 · A crossing is not a connection

The MCCB main switch panel from the clubhouse schematic. Eleven outgoing ways,
all **63 A TP/N**, and three horizontal cable-specification lines above them:
16 mm², 25 mm², 35 mm² + 25 mm² CPC.

Every vertical drop crosses all three lines and joins exactly one, marked only
by a junction dot. The figure circles all eleven, detected programmatically:

| line | cable | ways |
|---|---|---|
| 1 | 5C 16 mm² XLPE/SWA/LSOH | 2 |
| 2 | 5C 25 mm² XLPE/SWA/LSOH | 3 |
| 3 | 4C 35 mm² XLPE/SWA/LSOH + 25 mm² CPC | 6 |

2 + 3 + 6 = 11, which reconciles against the way count — a useful self-check.

**How the dots were found.** A plain crossing is a one-pixel `+`; a junction dot
is a filled blob. Score the 7×7 neighbourhood of each intersection: crossings
come out around 13 dark pixels, dots around 30. The separation is clean, with no
values in between.

Three consequences:

- **Proximity is worthless.** Each drop passes within a couple of pixels of two
  cable specs it has nothing to do with.
- **CSA is not derivable from rating.** Identical 63 A devices, three different
  conductors, decided by run length and installation method.
- **Sheet position says nothing about hierarchy.** DB-B1 sits at the far left of
  the drawing and DB-SL at the far right; both are fed from this one panel.

---

## V-07 · The five-phase pipeline

The spine from `00-core-reading-model.md`, with the shortcut that produces every
defect in the catalogue drawn as the dashed line from phase 1 straight to phase
4 — and then worked end to end on one real row.

The value of the worked column is that each phase's output is checkable. After
phase 2 you have eleven numbers; after phase 3, `"32" ∈ [308.7, 356.2]` is
already decided, before any domain rule has run. If the grid is wrong you find
out at phase 3, not by noticing a strange price three weeks later.

---

## V-08 · Deriving device class

Four ordered branches — explicit string, BS EN number, RCD/AFDD combination,
board header — then `UNKNOWN`. Whichever branch resolves is recorded as
`class_basis`, and `class_basis == UNRESOLVED` blocks pricing.

That field is the whole defence. Without it, "we couldn't tell, so we assumed
MCB" and "the document said MCB" are indistinguishable downstream.

The combination table at the foot of the figure carries the integral-vs-shared
distinction: an RCD on the way's own row is integral (one RCBO per way); an RCD
spanning a block of ways is shared (one RCCB plus N MCBs). Different products,
materially different cost, and the only thing separating them is the geometry of
the RCD's span.

---

## V-09 · Blanks are computed, never read

No schedule anywhere in the corpus states a blanking-plate quantity, yet the
issued quote carries lines like `JK01B SINGLE POLE BUSBAR BLANK × 49`. The
quantity falls out of:

```
modules_available = Σ ways × poles per way
modules_used      = Σ device module width
blanks            = modules_available − modules_used
```

Checked against every board in Hager quote 205696330-rev6:

| board | enclosure | capacity | modules used | computed | on the quote |
|---|---|---:|---:|---:|---:|
| DB-B1 | JK104BGSPD 4 WAY TPN | 12 | 1 | 11 | 11 ✓ |
| DB-B2 | JK104BGSPD 4 WAY TPN | 12 | 1 | 11 | 11 ✓ |
| DB-GLP | JKD1812TM POWER/LIGHTING 8/12 | 60 | 11 | 49 | 49 ✓ |
| DB-FLP | JKD1812TM POWER/LIGHTING 8/12 | 60 | 6 | 54 | 54 ✓ |
| DB-SLPK | HQR_JFD1816BGTM DUAL METERED 8+16 | 72 | 10 | 62 | 62 ✓ |
| DBS panel | JN212BG 250A 12 WAY | 36 | 12 (4 MCCB × 3) | 24 | 24 ✓ |

Six boards, six exact matches. This is a derived rule with evidence behind it,
not a heuristic — worth implementing as a hard assertion rather than a
best-effort estimate.

Failure modes: counting **ways** instead of **modules** understates DB-B1 by 8;
conflating equipped and unequipped spares gets both lines wrong at once (an
equipped spare consumes a module, an unequipped one becomes a blank); and if the
enclosure has not been selected, capacity is unknown — flag it rather than
emitting zero.

---

## Making more of these

The generators are straightforward and worth keeping if you want figures for new
dialects as they are added:

- **Column bands** come from `page.get_drawings()`, filtering line segments by
  orientation and length, then de-duplicating within ~2 pt.
- **Crops** come from `page.get_pixmap(matrix=Matrix(dpi/72, dpi/72), clip=Rect(...))`
  at 150–220 dpi; annotate with PIL in the crop's pixel space.
- **Checkbox states** come from small filled rects tested against reconstructed
  outlines.
- **Junction dots** come from 2D blob density at intersections.

A figure per dialect, added at the same time as the adapter, is a cheap way to
keep the reference honest — and it forces you to look at the page before you
write the parser.
