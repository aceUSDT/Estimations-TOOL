# 05 — Trap Catalogue

Every entry is a real failure mode with evidence from the corpus. T-28 to T-35
come from the August 2026 defect review of the deployed tool. Use as a
review checklist before merging any parser change.

Severity: **S1** silently wrong quantity or price · **S2** wrong classification ·
**S3** missing data · **S4** noise in output.

Traps with a **Figure** line have an annotated example in `diagrams/` — see
[`09-visual-examples.md`](09-visual-examples.md) for the walkthrough.

---

### T-01 · Value bound to the wrong column — S1
**Figure:** [V-01](diagrams/v01-column-binding.png)
Flattened row scanned for a rating pattern; picked cable CSA + reference-method
letter instead.

> `L2 | 60898 | C | 32 | 10 | × | × | POWER FOR CONDENSER | Rd | 6 | 6 | A | C/E | 0.4 | 0.68`
> reported as `MCB 6A`; correct is `32 A Type C MCB`.

**Fix:** bind by x-overlap with the header band. Never regex a row string.
**Test:** T-01 in `08-acceptance-tests.md`.

---

### T-02 · Device class defaulted to MCB — S1
**Figure:** [V-08](diagrams/v08-device-class-decision.svg)
Ways carrying `61009` with RCD `✓ 30 mA` reported as `MCB 16A / MCB 6A / MCB 6A`.
BS EN 61009 is the RCBO standard. Unit cost error ≈ 3×.

**Fix:** derive class from BS EN + RCD + AFDD columns; never default.

---

### T-03 · RCD scope spanning multiple ways ignored — S1
**Figure:** [V-08](diagrams/v08-device-class-decision.svg)
An RCD shown once against a block of ways protects all of them. Read per-row,
those ways look unprotected.

**Fix:** resolve vertical span from ruling lines or bracket glyphs; distinguish
integral RCD (RCBO per way) from shared RCD (one RCCB + N MCBs) — different
product, different price.

---

### T-04 · Merged way-number cell treated as blank — S3
**Figure:** [V-02](diagrams/v02-row-grouping.png)
Way number appears once in a vertically merged cell spanning three phase rows.
Rows 2 and 3 look like they have no way.

**Fix:** inherit downward across the merge span.

---

### T-05 · Bracket glyphs `\` `/` misread as empty ways — S1
**Figure:** [V-02](diagrams/v02-row-grouping.png)
`KFH-QRL-BA-XX-SH-E-5001.pdf` p.2: ways `1L1 \`, `1L2 Radial … 25A`, `1L3 /`.
One three-phase circuit, not one circuit and two empty ways.

**Fix:** detect bracket glyphs; group into one circuit occupying 3 ways.

---

### T-06 · Three-phase device counted three times — S1
**Figure:** [V-02](diagrams/v02-row-grouping.png)
The mirror of T-05. A TPN device across L1/L2/L3 is **one device**.

**Fix:** device count keyed on circuit, not on row. Way occupancy is separate.

---

### T-07 · Vertically stacked header fields flattened — S2
**Figure:** [V-03](diagrams/v03-stacked-header-rows.png)
Trimble/ProDesign stacks `Overcurrent Protective Device` / `Earth Fault
Protective Device` / `Arc Flash Protective Device` down the header, with data in
matching N-line groups. Read line-by-line, the RCD lands in the OCPD field.

**Fix:** detect the header stack depth; group data rows in blocks of N.

---

### T-08 · Full-width rows treated as circuits — S4/S3
`METER SECTION 2 — MECHANICAL POWER` is a partition, not a circuit.
`Surge Protection Device Type 1+2` is the same shape but **is** a real item.

**Fix:** classify full-width rows into *partition* (sets context, not counted)
vs *device* (counted, not a way) by whether the text names a device from the
device vocabulary.

---

### T-09 · Legend codes resolved from a global table — S1
**Figure:** [V-05](diagrams/v05-legend-collision.png)

Comparing the two lettered cable legends in the corpus in full, **five of eight
letters disagree** — A, B, C, E and H. Only D, F and G happen to coincide, and
that is coincidence rather than convention.

| code | OCSC MCCB schedule | DB schedule in the docx review |
|---|---|---|
| A | LSOH / LSOH cables | XLPE/LSZH/SWA/LSZH |
| B | LSOH cables in metallic conduit | LSF flat multicore cables |
| C | LSOH cables in non-metallic conduit | MICC / FP400 |
| E | LSOH cables in non-metallic trunking | FP 200 Gold |
| H | Fire rated cables | FP600 |

**Fix:** parse the legend on the document itself; scope the mapping to that
document. Unresolvable code → flag, never fall back to a default table.

---

### T-10 · Tick-box selections invisible to text extraction — S1
**Figure:** [V-04](diagrams/v04-checkbox-form.png)
`SRP1053-…-6852 Composite Distribution Boards`: every option is present as text
(`Form 1 2a 2b 3a 3b 4a 4b`), and only a shaded box says which applies. Text
extraction reports all options.

**Fix:** detect checkbox rectangles and fill state geometrically.
**And:** on the same sheet, `Trench/duct available` has **no** box filled and
`Surge Protection Device` has **both** Y and N filled. Zero-selected → flag
unanswered; multi-selected → flag conflict. Never resolve either.

---

### T-11 · Rotated headers lost — S3
MCCB/switchboard schedules set `Circuit No.`, `Type of wiring`, `Conductors csa`
at 90°. Extracted as body text, the header row vanishes and column mapping fails
wholesale.

**Fix:** read span rotation; rotate boxes into page space before banding.

---

### T-12 · `Circuit Reference` collision — S2
In some dialects it is the **way ID**; in others the **circuit description**.

**Fix:** disambiguate by the column's value domain (short alphanumeric IDs vs
free prose), not by the header string.

---

### T-13 · Two description columns, one is circuit type — S2
BES dialect: `CIRCUIT DESCRIPTION` (prose) and `DESCRIPTION OF CIRCUIT`
(`RING` / `RADIAL`). Naive mapping stores `RADIAL` as the circuit description
and loses the prose.

**Fix:** value-domain check; `RING|RADIAL` → `way.circuit_type`.

---

### T-14 · Header cached across pages — S1
`KFH-QRL-BA-XX-SH-E-5001.pdf` (413 p) changes its device column header between
`CPD` and `MCCB/MCB` at different boards inside the same file.

**Fix:** re-detect the header per board and per page.

---

### T-15 · RCD sensitivity expressed in amps — S2
**Figure:** [V-03](diagrams/v03-stacked-header-rows.png)
Trimble dialect: `Trip Rating (A) = 0.03` is 30 mA.

**Fix:** any value < 1 in a trip/RCD column is amps → convert to mA.

---

### T-16 · `None` misread as no protection — S2
**Figure:** [V-03](diagrams/v03-stacked-header-rows.png)
Trimble `Earth Fault Protective Device: None` on a way whose OCPD is an RCBO
means *no separate RCD device*, not *no residual protection*.

**Fix:** interpret device-slot `None` relative to the OCPD class.

---

### T-17 · `-` interpreted globally — S2/S3
In a boolean column `-` means *no*. In a numeric column it means *not stated*
(→ flag). In a description column it means *nothing here*.

**Fix:** resolve against the column's value domain.

---

### T-18 · Placeholders priced silently — S1
Real strings in the corpus: `TBC A TPN MCCB`, `TBC mm²`, `TYPE TBC`,
`(TYPE TBC)`, `details to be added at next stage`, `Final details TBC by …
Specialist`, `??M`, `GUESS`.

**Fix:** placeholder vocabulary → `null` + `flag: placeholder`. Never priced,
never defaulted, always surfaced. This is an explicit project requirement.

---

### T-19 · "Typical" boards counted once — S1
`DIST/BD Ref: DB/EW & DB/WW BEDROOMS TYPICAL BOARD` — one schedule, two named
boards, and "typical" usually implies more. CU charts in the corpus cover many
identical apartments from one sheet.

**Fix:** detect `TYPICAL`, `& `, `Type 1..7`, plot/apartment ranges; resolve the
multiplier from the accompanying schedule or layout, or flag. Highest-magnitude
quantity error available.

---

### T-20 · Equipped vs unequipped spares conflated — S1
**Figure:** [V-09](diagrams/v09-module-blank-arithmetic.svg)
They are different products. An equipped spare is a fitted device; an unequipped
spare is a blanking plate. Notes typically require 10% of each.

**Fix:** three-state way status — `populated` / `spare_equipped` /
`spare_unequipped`. Apply sheet-note percentages where board schedules are
absent.

---

### T-21 · Crossing lines read as connections — S1
**Figure:** [V-06](diagrams/v06-schematic-junctions.png)
On a dense A0 schematic, lines cross constantly without connecting. Junction
dots mark real joins.

**Fix:** require a junction dot or a shared endpoint; a bare crossing is not an
edge.

---

### T-22 · Proximity used for feed relationships — S1
**Figure:** [V-06](diagrams/v06-schematic-junctions.png)
Adjacent DBs in the same shaded block are frequently fed from opposite ends of
the switchboard. Sheet position encodes building level, not hierarchy.

**Fix:** trace lines. Unresolved endpoint → flag, never nearest-neighbour.

---

### T-23 · CSA derived from rating — S1
**Figure:** [V-06](diagrams/v06-schematic-junctions.png)
125 A appears against 35 mm², 50 mm² and 95 mm² on the same reference sheet.

**Fix:** read CSA; never compute it from the rating.

---

### T-24 · Overlapping labels merged on dense drawings — S3
Vector text on A0 sheets extracts in spatial order and adjacent labels collide:
`Way - 8+68` is almost certainly `8+6` colliding with a neighbouring label.

**Fix:** cluster by position with a gap threshold before tokenising; validate way
counts against the board header and flag impossible values.

---

### T-25 · Notes and legend text entering the take-off — S4
Legend entries name real devices (`MCCB`, `SPD`, `Meter`, `Fire Alarm Panel`) and
will be picked up as items by any content-based extractor.

**Fix:** segment the sheet first; legend/notes/title/revision regions are
excluded from the item stream by construction.

---

### T-26 · Revision confusion — S1
The corpus holds multiple revisions of the same drawing under different file
names (`P05` vs `P07`, `REV C02` vs `Rev C03 (002)`, `rev2 panel` vs
`rev3 panel fuse now 160A not 32A`). That last filename is itself a change note:
a 32 A device became 160 A.

**Fix:** parse drawing number + revision from the title block, not the filename;
group by drawing number; use the latest revision by default; surface a
revision diff. Never merge two revisions into one take-off.

---

### T-27 · Page rotation ignored at acquisition — S3
`2425.009.E12 Clubhouse Distribution Schematic.pdf` carries a `/Rotate` entry.
PyMuPDF returns text coordinates in **unrotated** page space, so y-values exceed
the stated page height and every box is in the wrong frame. Column and row
banding then fails wholesale on a page that looks perfectly readable.

**Fix:** read `page.rotation` and transform word and drawing boxes into rendered
page space before banding. Assert that every box falls inside the page rect; a
box outside it means the frame is wrong, not that the box is bad. Where the
transform is uncertain, work in raster pixel space from `get_pixmap()` instead —
the render is always in the displayed orientation.

---

### T-28 · Note labels not linked to the rows they govern — S1
`DB-G9 [Kitchen]`, Perryfields Academy. The header carries a Notes block:
`(#5) Circuit wired via contactors to mushroom push button emergency stop key
reset buttons within kitchen`. Every circuit it applies to is tagged `(#5)` at
the end of its Load description — `Servery Counter (28) (#5)`.

Read without the link, five circuits lose their contactor and EPO entirely. The
devices are never mentioned in a device column; they exist only in the note.

**Fix:** parse note blocks anywhere on the sheet into `{label → text}`, scan
every cell for label references, and attach the note to those rows as a
`governing_note`. Notes that name equipment (contactor, EPO, key reset,
time switch, BMS interface) generate take-off items. The note block is **not**
always in the header — treat position as unknown and search the whole sheet.

**Also:** `Servery Counter (28) (#5)` contains two parenthesised tokens with
different meanings — `(28)` is an equipment tag, `(#5)` is a note reference.
Distinguish by whether the token resolves against the note table.

---

### T-29 · Phase span encoded inside a single cell — S1
Same sheet. Ways 1–5 each occupy **one visual row** and look single-phase, but
the Phase column reads `L1-L3`. They are three-phase circuits.

This is the inverse of T-05: there, three rows were one circuit; here, one row
is a three-phase circuit. Both are decided by the Phase column, never by row
count.

**Fix:** parse the phase cell as a set, not a label. `L1`, `L2`, `L3` → single;
`L1-L3`, `L1,L2,L3`, `L1/L2/L3`, `TP`, `TPN`, `3PH` → three. Occupancy and pole
count follow from the set size, and `poles` must never be emitted as `Unclear`
when the phase cell resolves it.

---

### T-30 · Board rating recoverable only by cross-reference — S3
`DB-G9`'s schedule header states no board rating. The Perryfields schematic
shows the upstream device feeding DB-G9 as a **250 A MCCB**, which puts the
board at 250 A.

**Fix:** when a board-level field is absent, look for it in the other document.
The upstream device rating bounds the board rating; the schematic's outgoing way
gives device, cable and rating for the feed. Emit with
`method: cross_reference`, medium confidence, and provenance naming **both**
documents. This is inference — label it as such, and never overwrite a stated
value with an inferred one.

---

### T-31 · Non-numeric way identifiers break way counting — S1
Split power-and-lighting boards number ways `L1, L2 … L7, L8, P1, P2, P3, P4` —
lighting side and power side, each with its own sequence. A parser expecting
`1..N` either miscounts or collides `L1` (lighting way 1) with `L1` (phase L1).

**Fix:** treat the way identifier as an opaque token plus an optional section.
Way count is the number of distinct identifiers within the board, not the
maximum integer. Reconcile against the board header's stated split
(`Way - 12+8`). And resolve the `L1` collision by column: a value in the Way
column is a way identifier; in the Phase column it is a phase.

---

### T-32 · Document type not recognised at all — S1
A distribution schedule was ingested and not classified as a distribution
schedule, so no schedule rules ran.

**Fix:** classify on structure before content. A **schedule** is a ruled grid:
board header block plus repeated rows of way / device / cable columns. A
**schematic** is a drawing: symbols joined by lines, boards drawn as bars or
boxes, few or no ruled tables. Score both hypotheses (ruling-line density, ratio
of line segments to text, presence of a title block, presence of a header row
matching the field lexicon) and record the margin. **Never fall back to a
default type** — an unclassified document is `doc_class: unknown`, flagged, and
excluded from the take-off until a human types it.

---

### T-33 · Incoherent totals accepted silently — S1
An ingest produced **29 boards and 18 devices**. That is impossible: every board
has at least an incomer, and a real project averages tens of devices per board.
The output was emitted anyway.

**Fix:** coherence gates that run before anything is shown, and that fail the
extraction rather than degrade it:

- `devices ≥ boards` — a board with zero devices is a failed parse, not an empty board
- devices per board within a plausible band; flag boards outside it
- ways populated + spare ≤ ways total
- every board has a feed edge or an explicit `orphaned` flag

A board that yields no devices is marked `INCOMPLETE` and excluded from totals.
Under-reporting silently is worse than reporting nothing.

---

### T-34 · Out-of-scope assemblies priced — S1
Schematic elements that must be excluded, not extracted: **MSDB panels**, and
any board whose outgoing ways are **4 or more fuses** (e.g. `A0.MSDB.02, 10x TPN
WAYS 200A BUS BAR` with `100A TPN BS88 FUSE` outgoers). There is no offer for
these.

**Fix:** an exclusion pass after node identification and before take-off.
Match on board reference containing `MSDB`, on outgoing device class `FUSE`
where count ≥ 4, and on `BS88` / fuse-switch outgoers. Excluded nodes are
recorded with `out_of_scope` and listed in the quote notes — removed from
pricing, never removed from the record.

---

### T-35 · Unresolved attributes emitted as prose into reports — S2
Deliverable take-offs currently contain `Not specified`, `Unclear`, and
`10A Unclear MCB` as device descriptions. Pole count and description are
resolvable from the schedule in almost every case in this corpus.

**Fix:** two separate rules. First, resolve — poles follow from the phase set
(T-29), the device string, or the pole notation, and a device that reaches the
report with unknown poles indicates a binding failure upstream, not a document
gap. Second, if it genuinely cannot be resolved, it is a **flag with a source
crop**, not a word in a description field. `Unclear` must never appear in a
device description.

---

## Review checklist

Before merging any change to the extraction path:

- [ ] Is page rotation handled before any banding?
- [ ] Does any code path derive a field from a flattened row string?
- [ ] Does any code path default a device class?
- [ ] Are legend codes scoped to the document?
- [ ] Are merged and spanned cells inherited?
- [ ] Are three-phase circuits counted once, occupying three ways?
- [ ] Is the header re-detected per page and per board?
- [ ] Are placeholders flagged rather than defaulted or dropped?
- [ ] Are note labels linked to the rows that reference them?
- [ ] Is the phase cell parsed as a set rather than a label?
- [ ] Do coherence gates run before any output is shown?
- [ ] Are out-of-scope assemblies excluded rather than priced?
- [ ] Are equipped and unequipped spares distinguished?
- [ ] Is every emitted value carrying page + bounding box provenance?
- [ ] Does any quantity change without a corresponding revision check?
