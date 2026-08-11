# 07 — Take-off → Quote Rules

Derived from the quote outputs in the corpus (19 examples) and the RFQ intake
sheet. The target is a first-pass priced quote needing review only — not manual
counting or transcription.

---

## Target output shape

Observed structure, consistently:

```
#     Section / board ref                                    section total
      PRODUCT_CODE   Item description                        qty
      PRODUCT_CODE   Item description                        qty
      -NOTE line …
```

- Section 001 is always **Notes** — assumptions, source documents, caveats.
- Then one section **per board**, keyed on the board reference from the
  schedule/schematic (`DB-B1`, `DB-GLP`, `DB-SLPK`).
- Each section lists enclosure, incomer kit, accessories, devices, blanks.
- Section totals; quote header carries quote number, revision, estimator, date.

The take-off must therefore aggregate **by board**, not just globally. Global
totals are a secondary view.

---

## What gets quantified per board

| Line | Source | Rule |
|---|---|---|
| Enclosure / board | board type + way count + rating | select by ways, rating, phases, metering |
| Incomer kit | `board.incomer` | switch vs MCCB vs ACB; poles from board phases |
| SPD kit | `board.spd` or schematic symbol or note | type 1 / 2 / 3 / 1+2 |
| Metering kit | `board.metering` | split-metered boards need multiple |
| Door lock kit | board count / door count | observed at 2–3 per board |
| Protective devices | one line per distinct device spec | grouped by class + rating + curve + poles + RCD |
| Blanking plates | **computed** — see below | |
| Busbar blanks | **computed** in module positions | |

---

## Blanks are computed, never read

**Figure:** [V-09 — verified against six boards in the issued quote](diagrams/v09-module-blank-arithmetic.svg)

The quotes carry large blank quantities (`SINGLE POLE BUSBAR BLANK × 49`,
`SINGLE POLE BLANK 125A FRAME × 24`). These are never stated in a schedule.

```
modules_available = board module capacity (from selected enclosure)
modules_used      = Σ over populated ways of device module width
blanks            = modules_available − modules_used
```

This is not a heuristic. It reconciles exactly against every board in the
issued quote 205696330-rev6:

| board | enclosure | capacity | used | computed | quoted |
|---|---|---:|---:|---:|---:|
| DB-B1 | JK104BGSPD 4 WAY TPN | 12 | 1 | 11 | 11 ✓ |
| DB-B2 | JK104BGSPD 4 WAY TPN | 12 | 1 | 11 | 11 ✓ |
| DB-GLP | JKD1812TM POWER/LIGHTING 8/12 | 60 | 11 | 49 | 49 ✓ |
| DB-FLP | JKD1812TM POWER/LIGHTING 8/12 | 60 | 6 | 54 | 54 ✓ |
| DB-SLPK | HQR_JFD1816BGTM DUAL METERED 8+16 | 72 | 10 | 62 | 62 ✓ |
| DBS panel | JN212BG 250A 12 WAY | 36 | 12 (4 MCCB × 3) | 24 | 24 ✓ |

Six boards, six exact matches — implement it as a hard assertion, not a
best-effort estimate, and fail loudly when it doesn't reconcile.

Two things this depends on:

- **Module width, not way count.** A TPN device occupies 3 module positions;
  an RCBO may be 1 or 2 modules wide depending on range. Track modules.
  Counting ways instead understates DB-B1 above by 8.
- **Equipped spares consume modules; unequipped spares become blanks.**
  Conflating the two (T-20) gets both lines wrong at once.

If `modules_available` is unknown because the enclosure has not been selected,
blanks cannot be computed → flag, do not emit zero.

---

## Spare-way rules from notes

Where a schedule is absent but a schematic note states the rule, generate the
quantity from the note and mark it `note_derived`:

> "Switchboards and distribution boards will be provided with 10% spare ways
> equipped with a representative selection of circuit protection devices and a
> further 10% unequipped spare ways c/w blanking plates."

```
spare_equipped   = ceil(ways_total × pct_equipped)
spare_unequipped = ceil(ways_total × pct_unequipped)
```

"A representative selection" is not a determinate quantity — emit the count and
flag the device mix for operator selection.

---

## Unpopulated boards — the sample-population default

When no schedule is issued for a board, the observed house rule (from the RFQ
intake sheet) is:

> quote the board populated with **1 MCB, 1 RCBO, 1 AFDD and 1 blank**

and the quote carries the matching note:

> "FOLLOWING BOARD IS NOT POPULATED, A LIST OF SAMPLE DEVICES HAVE BEEN ALLOWED
> FOR SELF-POPULATION."

Implement as an explicit, switchable rule that always emits its note. It must
never be applied silently — the operator has to see that a board was
sample-populated rather than taken off.

---

## Device grouping

Group into quote lines by the full spec, not by rating alone:

```
key = (class, rating_a, curve, poles, neutral, rcd_ma, rcd_type, breaking_ka, afdd)
```

Two 6 A devices are not the same line if one is a Type B RCBO 30 mA and the other
a Type C MCB. Under-grouping produces noise; over-grouping produces wrong
products. Where a component of the key is `not_stated`, that is a separate
group and it is flagged, not merged into the nearest match.

---

## Cable aggregation

Total length by (type, CSA, cores). Sources, in order of preference:

1. `Length: 65m` stated in the schedule (ElectricalOM dialect gives this)
2. `Distance: ~5m` on the schematic → `estimated_length`
3. Not stated → **flag**, do not estimate

Multiply by `parallel_runs`. Keep fire-rated cable as a separate group — FP200 /
FP600 / MICC price differently and must not merge with the standard groups.
Separate CPC is an additional item, not part of the cable.

---

## Notes section — mandatory content

Section 001 in every observed quote states what the quote was built from and
what was assumed. Generate it, don't hand-write it:

- source documents with **drawing number and revision** for each
- every `placeholder`-flagged item ("X was TBC and has not been priced")
- every `source_conflict` and `internal_conflict`
- every `note_derived` quantity
- every board that was sample-populated
- every `typical_multiplier_unknown`
- value-engineering substitutions, where a specified product was not matched

This section is the safety mechanism for the whole tool. If the take-off is
wrong, this is where the operator catches it.

---

## Pricing gate

An item is priced only if:

- `device.class_basis != UNRESOLVED`
- no flag in the blocking set (see `06-output-contract.md`)
- a product match exists at the required confidence
- the source document is the latest revision for its drawing number

Everything else appears in the quote as an **unpriced flagged line** with its
reason, and is summarised in section 001. It never silently disappears, and it
never silently acquires a price.

---

## Reconciliation before pricing

Do not price a project until:

- every board in the schematic has either a schedule or an explicit "no schedule
  issued" status
- every board in a schedule appears in the schematic, or is flagged as orphaned
- feed relationships agree between the two sources, or are flagged
- all documents in the set are the latest revision, or the older ones are
  explicitly excluded

Corpus evidence for why: the same drawing appears at `P05` and `P07`, at
`REV C02` and `Rev C03`, and one file is literally named
`rev3 panel fuse now 160A not 32A` — a device that changed by a factor of five
between revisions. Pricing the wrong revision is a silent, expensive error.
