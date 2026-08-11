# 03 — Dialect Profiles

75 text-layer DB schedules in the corpus produce **30 distinct header
fingerprints**. They cluster into 9 families. Treat these as adapters over the
core model in `00`, not as separate parsers — the geometry phase is shared, only
the field mapping and device grammar differ.

Detection: score a page against each family's signature tokens; require a
threshold and a margin over the runner-up. Below threshold → generic tabular
adapter + everything flagged medium.

---

## Family 1 — Trimble / Amtech ProDesign

**Signature:** footer `© 1996-20xx Trimble Inc.`, `Created using: v22.x BS 7671:2018+A3:2024`, header block `Board Data` / `Incomer Details`, columns `Id No`, `Sep. CPC`, `Connected To:`.

**Corpus:** 10 files — `DB LL GF C1 Rev C1.pdf`, `DB K Kitchen Rev C1.pdf`, `DB EXT External Services Rev C1.pdf`, etc.

**The hard part:** header fields are **stacked vertically**, three deep, and each
data row is a 3–4 line group where line *n* maps to header line *n*.

```
   Way       Id No      Cable Type     Cores    Phase     Connected To:   Overcurrent Protective Device    Rating (A)
  Phase      Name                               Sep. CPC  Id No           Earth Fault Protective Device    Trip Rating (A)
                                                          Name            Arc Flash Protective Device      Rating (A)
```

So a single circuit reads:

```
line 1 →  way=1,  cable type, cores, phase csa=1.5, OCPD="Hager, RCBO, ADC4 - 10kA - 1P+N, C Curve - Type
line 2 →  (wrapped continuation) "A - 30mA"
line 3 →  phase=L1, name="Bin Store & Multifunction Room", EFPD="None", trip rating=0.03
line 4 →  AFPD="None", rating="N/A"
```

**Rules:**
- Detect the N-line header stack, then group data rows in N-line blocks.
- Join wrapped device strings before parsing (Grammar B in `02`).
- `Trip Rating (A) = 0.03` → RCD 30 mA. Reconcile against the `- 30mA` in the device string.
- `None` in EFPD/AFPD slots means no *separate* device, not no protection.
- Board header carries `Ze (Ω)`, `No. of Ways`, `Spare`, per-phase connected/diversified loads — use for reconciliation.

---

## Family 2 — BES / Brenbar

**Signature:** `BES INTERNAL INFO.`, `BESDDBSCH`, `DESIGN DOCUMENT`, `Brenbar Electrical Services Limited`, header fields `DB Fed From`, `Number of ways (TP)`, `Spare capacity %`.

**Corpus:** 10 files — `DB Schedule 20260420 G1-GF-DB-LL.pdf` and siblings.

**Shape:** clean single-line rows, grouped header `PROTECTIVE DEVICE(A)` over `Rating` + `Curve`, then `RCD (mA)` and `AFDD (Y/N)`.

**Rules:**
- **No device class column** — derive per `02` combination table. `Rating 32 / Curve B / RCD 30 / AFDD Y` → 32 A Type B AFDD-RCBO.
- `DB Fed From` is an explicit board-to-board edge — use it as the primary feed source, and reconcile against the schematic.
- `Device Protecting DB: (A) 100, BS(EN) 60947-2` gives the upstream device class and rating directly.
- Two description columns (`CIRCUIT DESCRIPTION` = prose, `DESCRIPTION OF CIRCUIT` = RING/RADIAL). The second is `way.circuit_type`, not a description. A naive mapping puts `RADIAL` in the description field.
- `-` in the RCD column means no RCD (boolean domain).

---

## Family 3 — ElectricalOM (MODECSOFT)

**Signature:** footer `MODECSOFT ElectricalOM … (www.electricalom.com)`, headings `Circuits schedule report :`, `Empty ways`, `Diversified+Spare load (A)`.

**Corpus:** `Guernsey DB Schedule.pdf` (177 p), `Guernsey Report` variants.

**Shape:** each circuit is a multi-line block; per-phase numeric columns to the right (power factor / diversity / harmonics stacked over L1 L2 L3 twice).

```
   Way          Description              Conductor                Protective devices        L1 L2 L3   L1 L2 L3
                                    2Cx4mm² + E(armour)                                      1
                                                              MCB C 1P/10A/10kA                         4.35
  1.L1   DB3-1L1-Hangar Lighting    SWA/XLPE90(70)/Cu                                        0.6
                                                        Hager | NCN EN 60898-1 Type C 10kA    0
                                                                                                        2.61
                                        Length: 65m
```

**Rules:**
- Way key is `<way>.<phase>` (`5.L2`). Split it.
- `empty` = unequipped spare way. The board header states `Empty ways: 1Ph: 17 (71%)` — reconcile.
- Device code + manufacturer line are two independent statements of the same device: cross-check.
- **`Length: 65m` is present** — this is the best cable-length source in the corpus. Capture it; the quote needs total length by type and size.
- `Connected from: HA-DB3` is the feed edge.
- Conductor string `2Cx4mm² + E(armour) SWA/XLPE90(70)/Cu` parses as cores × CSA + CPC arrangement + insulation/armour/conductor material.

---

## Family 4 — Quinnross / KFH style (rating-only)

**Signature:** columns `Circuit Reference`, `Circuit Type`, `Location`, `Serving`, `CPD` (or `MCCB/MCB`), `RCBO/AFDD`, `Cable Size mm2 (L&N / CPC)`, `Cable Type`.

**Corpus:** `KFH-QRL-BA-XX-SH-E-5001.pdf` (413 p), `KFH-QRL-BA-XX-DR-E-0508`.

**Rules:**
- Three-phase circuits are drawn with `\` and `/` bracket glyphs on the rows above and below the data row. **Rows 1L1 and 1L3 are not empty ways** — they are the same circuit.
- `c/w RCD` in the `RCBO/AFDD` column upgrades the device class.
- Device class inherits from the board header `Type:` string.
- The device column header changes between boards inside the same file — re-detect per board, never cache.
- Very high blank-row density (a 413-page file is mostly unpopulated ways). Do not treat page-level emptiness as a parse failure; treat it as spare capacity, and reconcile against the board's stated way count.

---

## Family 5 — OCSC MCCB / switchboard schedule

**Signature:** `Schedule of Electrical Plant and Equipment – MCCB Schedule`, `Board Ref:`, `Main Isolator:`, `CODES FOR TYPE OF WIRING` legend block.

**Corpus:** `W702-OCO03-XX-XX-SC-E-675-008…`, `Electrical and ICT Services … MCCB Schedule.pdf`.

**Rules:**
- **Column headers are rotated 90°** (`Circuit No.`, `Type of wiring (see code)`, `Conductors csa`). Rotation must be handled in acquisition or the header row is lost entirely.
- Per-document wiring code legend `A`–`H`, `O (Other)`. **This mapping is document-specific** — here `A = LSOH/LSOH cables`; in another corpus document `A = XLPE/LSZH/SWA/LSZH`. Never resolve wiring codes from a global table.
- Rows use `-` throughout for spare/SPD entries; combined with a full-width `SPD` label row.
- Three-phase rows grouped as L1/L2/L3 with the way number on the middle row.

---

## Family 6 — BAM / composite board specification form

**Signature:** `Composite Distribution Board Data`, `Schedule No.4`, `Internal separation`, `Form 1 2a 2b 3a 3b 4a 4b`, `Type required : 1..7`.

**Corpus:** `SRP1053-BMD-ZZ-ZZ-T-E-6852-Schedule No 4 Composite Distribution Boards.pdf`, `SRP1024-BMD-…-4857`, `SRP1053-…-6858 Schedule No 11`.

**This is not a table. It is a tick-box specification form**, and it is the
single most dangerous document type in the corpus for a text-based reader.

Every option is present as text. Which option applies is indicated **only by a
shaded checkbox glyph** — no tick character, no text difference. Extracting the
text gives you every option with no selection information, and a naive reader
will happily report "Form 1, 2a, 2b, 3a, 3b, 4a, 4b".

**Rules:**
- Locate checkbox rectangles from the vector drawing layer (`page.get_drawings()`), or by template-matching on a raster render.
- Classify each as filled/unfilled by mean pixel intensity inside the box, with a margin band; boxes in the margin band are `unknown`.
- Group boxes by their label row. Then:
  - exactly one filled → that is the selection
  - zero filled → **unanswered**, flag
  - more than one filled → **conflict**, flag
- Both outcomes above occur in this corpus. On the Ashfield sheet, `Trench/duct available Y/N` has neither box filled, and `Surge Protection Device Y/N` has **both** filled. Neither may be silently resolved.
- Fields recovered here are commercially significant: Form of separation, board Type, incoming device type, outgoing device type, neutral busbar (half/full/double), IP rating, metering, SPD presence, spare fuse/breaker.

---

## Family 7 — Consumer unit circuit charts

**Signature:** `Consumer Unit`, `Circuit Chart`, `Main Switch`, apartment/plot references, small way counts.

**Corpus:** `DUN-RYB-XX-XX-SP-E-61002 CU Circuit Chart.pdf`, `CU Schedules (P02).pdf` (116 p), `114026-NPS-… Consumer Unit Layouts`, `SLD-CONSUMER UNIT FOR REVIT`.

**Rules:**
- Almost always a **typical**: one chart covers many identical dwellings. The multiplier lives in the title, a note, or an accompanying schedule — find it or flag it. Under-counting typicals is the highest-magnitude quantity error available.
- Split-load boards: two RCD-protected banks plus non-RCD ways. The bank boundary is drawn, not written.
- Way counts are small; do not let a small table fall below the coverage gate.

---

## Family 8 — Schedule embedded in a schematic sheet

**Signature:** A0/A1 sheet size, drawing title block, plus a tabular region.

**Corpus:** `250405-GG-…-2000-P01 LV Schematic.pdf`, `260346-SJD-…-1000-P6`, `C056-BBK-…-4101`, `6997-A10-…-60-01-P01`, `2429-SGL-…-1001/1002`.

**Rules:**
- Segment the sheet before parsing: find the drawing region, the table region(s),
  the legend block, the notes block, and the title block. Parse each with the
  right reader.
- Notes and legend text must never enter the take-off as items — this is the
  "filter out anything that isn't a real quantifiable item" requirement.
- The title block gives project, drawing number, revision and status. Capture it
  for provenance and revision diffing.

---

## Family 9 — Scanned / no text layer

**Corpus:** 10 PDFs, including `LV schematic.pdf` … `LV schematic4.pdf`, `doc08967220251013144029.pdf`, `Estimating_2026…`, `SKM_C551i…`.

**Rules:**
- Detect by empty `pdffonts` output. Rasterise ≥300 dpi (400 dpi for A0 sheets),
  deskew, then OCR with word boxes.
- Ruling lines are usually still detectable in the raster — use them for banding
  rather than relying on OCR word spacing.
- Confidence ceiling: nothing from a scanned source is `high` unless it passes a
  cross-check against a text-layer document.
- OCR digit confusions to expect in this domain: `6`↔`8`, `1`↔`7`, `0`↔`O`,
  `5`↔`S`, `2`↔`Z`. Validate ratings against the standard preferred series
  (6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 320, 400,
  630, 800, 1000, 1250, 1600) and CSAs against the standard series (1.0, 1.5,
  2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400). A value
  off-series is a flag, not a correction — **do not snap silently**.
