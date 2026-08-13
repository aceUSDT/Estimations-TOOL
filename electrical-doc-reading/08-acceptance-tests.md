# 08 — Acceptance Tests

Fixtures drawn from the corpus. Each test names a source, the assertion, and the
trap it guards. Build these before optimising anything — they are what stops the
known defects from returning.

---

## Tier 1 — Regression tests for observed defects

These reproduce failures that have already happened in production.

### T-00 · Authored phase-label error is reconciled, not hidden
**Source:** a TPN way drawn as three physical phase lanes but printed `L1 / L1 / L1`.

```text
if a neighbouring way or the same board header proves a three-phase sequence:
    assert phases == ["L1", "L2", "L3"]
    assert every changed phase retains original_text == "L1"
    assert every changed phase is review_required and confidence < 0.85
else:
    assert source_phase_labels_unresolved
    assert no replacement phase is invented
```

Guards source-error reconciliation. Evidence must come from the same document.

### T-00A · Occupancy words inside load names do not erase devices
**Source:** populated row `MCB | C | 10A | Ltg: Open Space next to dining` between peer 10A C-curve MCB rows.

```text
assert row.device.class.value == "MCB"
assert row.space is False
assert row.device_count == 1
assert viewer.specification_colour == peer_mcb.specification_colour
assert viewer.message does not contain "not counted"

for exact_cell in ["SPACE", "FITTED BLANK", "BLANK WAY"]:
    assert exact_cell is an unpopulated space

for description in ["Open Space next to dining", "Spare office lighting", "Blank Canvas room"]:
    assert description is not an occupancy label
```

If an exact occupancy cell conflicts with populated protection columns, keep the
fitted device, preserve the conflict, lower confidence, and require review.
Guards bounded occupancy parsing and cross-surface count/colour consistency.

### T-01 · Rating bound to the correct column
**Source:** DB schedule row `L2 | 60898 | C | 32 | 10 | × | × | POWER FOR CONDENSER | Rd | 6 | 6 | A | C/E | 0.4 | 0.68`

```
assert device.rating_a.value      == 32
assert device.curve.value         == "C"
assert device.class.value         == "MCB"
assert cable.live_csa_mm2.value   == 6
assert cable.cpc_csa_mm2.value    == 6
assert cable.install_method.value == "A"
```

Guards T-01. **This test must fail on the current deployed extractor** — if it
passes on day one, the harness is wired to the wrong code path.

### T-02 · RCBO not reported as MCB
**Source:** board with rows `61009 | B | 16 | 10 | × | ✓ | 30 | SMALL POWER` and two at `61009 | B | 6 | … ✓ | 30`

```
for way in board.ways[:3]:
    assert way.device.class.value        == "RCBO"
    assert way.device.rcd.present.value  is True
    assert way.device.rcd.sensitivity_ma.value == 30
    assert way.device.class_basis        == "bs_en"
assert [w.device.rating_a.value for w in board.ways[:3]] == [16, 6, 6]
```

Guards T-02.

### T-03 · Three-phase bracket group
**Source:** `KFH-QRL-BA-XX-SH-E-5001.pdf` p.2, ways 1L1/1L2/1L3

```
circuits = board.ways_grouped()
assert len(circuits) == 1 for way_number 1
assert circuits[0].occupies_ways        == 3
assert circuits[0].device.rating_a.value == 25
assert circuits[0].description.value.startswith("TPN Isolator for AHU")
assert device_count(board, rating=25) == 1        # not 3
```

Guards T-05, T-06.

### T-04 · `c/w RCD` upgrades the class
**Source:** same file, way 2 — `40A` + `c/w RCD`

```
assert way.device.class.value == "RCBO"
assert way.device.class_basis == "derived_rcd"
```

---

## Tier 2 — Dialect adapters

One end-to-end fixture per family. Assert the whole board object, not fields in
isolation.

| Test | Source | Key assertions |
|---|---|---|
| D-01 Trimble | `DB LL GF C1 Rev C1.pdf` p.1 | 4-line row grouping; way 1 has three phase circuits; device string `Hager, RCBO, ADC4 - 10kA - 1P+N, C Curve - Type A - 30mA` parses to RCBO/6 A/C/1P+N/10 kA/30 mA/Type A; `Trip Rating 0.03` → 30 mA and reconciles; `board.ways_total == 6`; `board.ze_ohm == 0.19874` |
| D-02 BES | `DB Schedule 20260420 G1-GF-DB-LL.pdf` | `fed_from.board_ref == "G-B1-MSB-LL"`; upstream device 100 A / 60947-2 → MCCB; way 1 L1 → 32 A Type B AFDD-RCBO 30 mA, circuit_type `ring`; way 3 L1 → 16 A Type B MCB (RCD `-` → false, not null); `ways_total(SP) == 42`, `spare(SP) == 19` |
| D-03 ElectricalOM | `Guernsey DB Schedule.pdf` p.20–22 | way key `1.L1` splits; `MCB C 1P/10A/10kA` parses; maker line `Hager \| NCN EN 60898-1 Type C 10kA` cross-checks; `Length: 65m` captured; `AFDD\RCBO C 1P/20A/10kA/30mA/Class A` → AFDD_RCBO 20 A C 30 mA Type A; `empty` → `spare_unequipped`; `Connected from: HA-DB3` |
| D-04 Quinnross | `KFH-QRL-BA-XX-SH-E-5001.pdf` | header re-detected per board (`CPD` p.2 vs `MCCB/MCB` p.40); board type parsed from header; blank pages counted as spare capacity, not parse failure |
| D-05 OCSC MCCB | `W702-OCO03-…-675-008…pdf` p.8–14 | rotated headers recovered; wiring legend resolved to **this document's** table (`A = LSOH/LSOH cables`); full-width `SPD` row → device, not way |
| D-06 BAM composite | `SRP1053-…-6852…pdf` p.2 | checkbox states read; Form `2a`; Type `2`; incoming `Isolator`; outgoing `MCB`; neutral `Double`; IP `IP4X`; `Trench/duct` → `checkbox_unanswered`; `Surge Protection Device` → `checkbox_conflict` |
| D-07 Schematic | Perryfields `SRP1295-WIN-01-ZZ-D-E-1300` P05 | source chain substation → 1000 kVA transformer → LVS1 (Form 4 Type 2, 1600 A); LVS2 fed by 630 A TPN MCCB on 2×150 mm²; `parallel_runs == 2`; life-safety edges flagged from red; `TBC A TPN MCCB` → `placeholder`; legend and notes contribute **zero** take-off items |
| D-08 Junctions | `2425.009.E12 Clubhouse Distribution Schematic.pdf` | page rotation transformed before banding; 11 junction dots found and no crossings promoted to edges; cable assignment splits 2 / 3 / 6 across 16 mm² / 25 mm² / 35 mm²; dot count == way count |

### D-09 · Blank plates computed, not read
**Source:** any board with a selected enclosure

```
assert board.modules_total.value  == ways * poles_per_way
assert board.modules_used.value   == sum(w.occupies_modules for w in populated + spare_equipped)
assert blanks                     == modules_total - modules_used
```

Parameterise over the six boards in the V-09 table; all six must match the
issued quote exactly. Guards T-20.

---

## Tier 3 — Invariants across the whole corpus

Run over all 149 files. These catch regressions that fixtures miss.

```
INV-1   No item is emitted with confidence "high" and any blocking flag.
INV-2   Every emitted item has file + page + bbox.
INV-3   Every device with class_basis == "UNRESOLVED" is unpriced.
INV-4   For every board: populated + spare_equipped + spare_unequipped
        ≤ ways_total (or the board is flagged coverage_gate_failed).
INV-5   No rating or CSA outside the standard series is emitted without
        off_series_value.
INV-6   No legend code is resolved from a document other than its own.
INV-7   Every drawing_number with multiple revisions yields exactly one
        current document; the rest carry superseded_revision.
INV-8   Total device count is invariant under re-parsing the same file
        (determinism).
INV-9   No take-off item's raw text originates from a legend, notes,
        title-block or revision-table region.
INV-10  Every three-phase circuit contributes 1 device and 3 way occupancies.
INV-11  Every word box falls inside its page rect after rotation transform.
INV-12  For every board with a selected enclosure, modules_used + blanks
        == modules_total.
```

---

## Tier 4 — Adversarial cases already present in the corpus

| Case | File | Expected behaviour |
|---|---|---|
| Internally contradictory device | board header `60898 TYPE C 20A MCCB` | extract both, `internal_conflict`, unpriced |
| Whole way undefined | `TBC A TPN MCCB / TBC mm²` | `placeholder`, unpriced, listed in notes |
| Typical board covering two refs | `DB/EW & DB/WW BEDROOMS TYPICAL BOARD` | two board instances, or `typical_multiplier_unknown` |
| Colliding labels on A0 | `Way - 8+68` | flagged, not silently accepted as 68 ways |
| Same drawing, two revisions | `370-009-MAJ-…-001 P05` and `… P07` | P07 current, P05 superseded |
| Revision changes a device 5× | `rev2 panel` vs `rev3 panel fuse now 160A not 32A` | revision diff surfaces the 32 A → 160 A change |
| Scanned schematic | `LV schematic.pdf` … `4.pdf` | OCR route taken; nothing emitted above medium confidence |
| Zero-selection checkbox | Composite form, `Trench/duct` | `checkbox_unanswered` |
| Multi-selection checkbox | Composite form, `Surge Protection Device` | `checkbox_conflict` |
| 413-page mostly-empty file | `KFH-…-5001.pdf` | completes; empty ways counted as spare capacity |

---

## Test data policy

- Fixtures are **page-level extracts**, not whole files — fast, and they keep the
  assertion close to the evidence.
- Store expected output as the normalised JSON from `06-output-contract.md`, with
  bboxes rounded to 0.5 pt so minor renderer differences don't cause churn.
- Every new document family added to the tool ships with at least one Tier 2
  fixture before the adapter merges.
- Every production defect becomes a Tier 1 test **before** it is fixed.

---

## Suggested order of work

1. Tier 1 tests, red. Then the geometry pipeline in `00` until T-01 and T-02 pass.
2. INV-1, INV-2, INV-3 — the flagging and provenance contract.
3. Dialect adapters in corpus-frequency order: BES and Trimble (10 files each),
   then ElectricalOM, Quinnross, OCSC, BAM composite.
4. Schematic ingest and the schedule↔schematic reconciliation.
5. Aggregation and pricing behind the gate in `07`.

Do not start at step 5. A priced number carries authority that an unreconciled
take-off has not earned.
