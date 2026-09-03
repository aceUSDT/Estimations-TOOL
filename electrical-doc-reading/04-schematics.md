# 04 — Schematics (Single Line / LV Distribution Diagrams)

21 schematics in the corpus, mostly A0/A1 vector sheets. A schematic is a
**graph**, not a table. The extraction target is the board hierarchy with the
device and cable on every edge.

Worked reference: Perryfields Academy LV Schematic (Wintech
`SRP1295-WIN-01-ZZ-D-E-1300` rev P05).

---

## What a schematic gives you that a schedule does not

- The **feed topology** — which board feeds which, and through which device.
- The **outgoing way specification** at the feeding board (rating, poles, device
  type, cable) for board-to-board feeds, which the downstream schedule often
  states only as "Supply From".
- Sheet-wide rules in the notes block (spare-way percentages, PFC targets,
  device technology requirements).
- Life-safety segregation, shown by cable colour.

---

## Reading order

```
1. Segment the sheet    → drawing region · legend · notes · title block · revision table · embedded tables
2. Build the node set   → boards, transformer, supply, ATS, PFC, SPD, meters, panels
3. Trace the edges      → follow drawn lines, not proximity
4. Read edge annotation → the way's device + cable stack
5. Apply sheet rules    → notes and legend
6. Emit graph + flags
```

---

## Segmentation

Regions are consistently placed and detectable by density and framing:

| Region | Detection |
|---|---|
| Title block | Framed box, bottom-right; contains drawing number, revision, scale, status |
| Revision table | Immediately above/left of title block; rows of `P01 … P05` with dates |
| Legend | Framed box, symbol glyph + short text pairs, usually top-right |
| Notes | Numbered prose block, right-hand column |
| Drawing | Largest connected region of lines and symbols |
| Embedded schedule | Rectangular ruled table inside the sheet |

**Nothing from legend, notes, revision table or title block may enter the
take-off as a quantifiable item.** They are metadata and rules. This is the
explicit "filter out legends, drawing notes, boilerplate" requirement from the
project brief.

---

## Node identification

Boards appear as horizontal bars (switchboard / panelboard) or small labelled
rectangles (DBs). Attach to each node:

- **Ref** — `LVS1`, `DB-G1-LP`, `MDB-G9`, `PPC-B2-01`
- **Name / serving** — `[Main LV Switchboard]`, `[Ground Floor - Zone 1 Lighting & Power]`
- **Location** — from the label, e.g. `(00-033 Electrical Intake)`, `(GSHP Plantroom)`
- **Rating and form** — `Form 4 Type 2 - 1600A`
- **Way count** — `Way - 12+8` (lighting + power on a split board) or `24-Way`
- **Level** — from which horizontal band it sits in

### Naming conventions to parse, and not to over-trust

Observed pattern: `DB-<level><zone>-<service>`

- level `G` / `F` / `S` / `B` → ground, first, second, basement
- service suffix `LP` = lighting & power (split-metered), `M` = mechanical,
  `W` = water services
- `MDB-` prefix = metered board
- Way count `12+8` = lighting ways + power ways

These conventions are **project-specific**. Parse them opportunistically to
enrich, and never let a parsed convention override an explicitly stated field.

### Compact panelboard and switchboard blocks

Some A0 drawings place several self-contained board blocks beside the single-line
network. Treat each framed block as a small electrical document with this order:

1. Board identity and details (`REF:`, panel rating, fault current, phase, ways).
2. Incomer and busbar.
3. Every outgoing way, including MCCBs, meters, SPDs, spares and blank positions.
4. The cable and downstream load or board attached to each outgoing way.

Short labelled identities such as `REF: MSP1`, `REF: PBT1`, `REF: PBLL1`,
`REF: LS1`, `REF: DBT4` and `REF: DB ESS` are board nodes exactly as printed.
Do not shorten `PBT1` to `PB1`. By contrast, labels such as `LL PB 1` and
`LS PB 2` beside outgoing devices are circuit/load labels unless a separate
equipment block explicitly identifies a board with that reference.

Keep the board or panel rating separate from each outgoing-device rating. A
panel may be rated 400 A while an outgoing way reads `MCCB 160 A`; the take-off
for that way is the 160 A MCCB. The same separation applies to incomer rating,
fault current and downstream cable size.

An embedded schedule may be transposed: field names form horizontal bands such
as `CPC`, `CABLE`, `MCB`, `PHASE`, `AFDD`, `TYPE`, `WAY`, while each circuit is a
vertical column. Detect the intersecting field band and circuit column, then
normalise it to one ordinary outgoing record per printed way. Do not require
calibration merely because rows and columns are swapped.

PDF page rotation and Viewer rotation do not change electrical meaning. Store
all evidence in canonical source-page coordinates, transform it only for display,
and map user calibration boxes back to source coordinates before re-analysis.

---

## Edges — the critical rule

**Feed relationship is the drawn line. Never proximity, never vertical order.**

Two DBs sitting adjacent inside the same shaded block are routinely fed from
ways at opposite ends of the switchboard. Layout position on the sheet encodes
*building level*, not electrical hierarchy.

Method:
1. Extract line segments from the vector layer.
2. Join collinear/adjacent segments into polylines, respecting corner joins.
3. Snap endpoints to node bounding boxes within a tolerance.
4. Where a line crosses another without a junction dot, it is a **crossing, not
   a connection**. Junction dots are small filled circles — detect them.
5. Unresolved endpoints → flag. Do not guess the nearest board.

Layout convention on levelled schematics: horizontal dashed bands are building
levels (`GROUND FLOOR`, `FIRST FLOOR`, `SECOND FLOOR`, `ROOF`). Vertical drop
lines run from board ways up to the DBs. Use the bands to assign
`board.location.level`, never to assign feed.

---

## Edge annotation — the take-off atom

Each outgoing way carries a stacked annotation:

```
125A
TPN
MCCB
50mm² 4C XLPE/SWA/LSZH
```

Parse as `{rating_a, poles, device_class, cable}` where cable is
`{csa_mm2, cores, insulation, armour, sheath}`.

Rating and CSA do **not** move together linearly — in the reference sheet, 125 A
appears against 35 mm², 50 mm² and 95 mm² depending on run length and method.
**CSA can never be derived from rating.** Read it or flag it.

Additional annotations seen on edges:
- `2x150mm² 4C XLPE/SWA/LSZH` — parallel cables, multiply
- `16mm² 2C FP200 + Separate CPC` — separate CPC is an extra item
- `Distance: ~5m` / `Length: 65m` — cable length; the `~` is an estimate marker → medium confidence
- `Cable ref: 14B` — foreign key into a cable schedule

---

## Colour is semantic

On the reference sheet:

| Colour | Meaning |
|---|---|
| Red | Fire safety / life safety cabling (stated in note 6) |
| Orange | Board ways band |
| Blue | Cable annotation band |
| Pink | Sub-distribution grouping per floor |

**Read the colour meaning from the notes and legend of that sheet.** It is a
per-document convention. A red line is life-safety on this drawing because note
6 says so, not because red is universally life-safety.

Practical consequence: life-safety circuits carry FP200/FP600 fire-rated cable
and separate CPC, priced differently. Losing the colour loses the distinction.

---

## Symbols to recognise

From the reference legend: MCCB panelboard · distribution board · split-metered
distribution board · fire alarm panel (FAP) · disabled services alarm panel
(DRP) · isolator · MCCB · TPN isolator · mains incoming meter · meter within
distribution board (`*` = import type) · transient voltage protection (SPD, type
as noted) · emergency power off button (EPO) · power factor correction (PFC) ·
photovoltaic system with inverter/G99/isolators/fireman's switch · EV charger
feeder pillar (EVC) · ATS.

Match by glyph geometry against the sheet's own legend, not a hardcoded symbol
library. Legends differ between practices.

Marks whose meaning must be confirmed per sheet: `1+2` and `3` against boards
read as SPD **type** under a legend entry of "transient voltage protection (type
as noted)"; a standalone `S` reads as the local isolator. Both are inferences —
emit at medium confidence with the legend entry as provenance.

---

## Notes block — sheet-wide rules

Notes are not boilerplate; they set quantities. From the reference sheet:

1. Boards to have 10% spare ways **equipped with devices** plus a further 10%
   **unequipped** with blanking plates → this is a *rule* generating quantities
   for every board on the sheet, including boards whose schedules aren't issued.
2. Space for LV panel expansion on one side.
3. PFC to achieve worst-case 0.95 — *details to be added at next stage* → **TBC, flag**.
4. All meters connected to BMS.
5. All MCCBs to be **electronic trip type** → changes the product selected.
6. Red cables denote fire safety cabling.

Parse notes for: spare-way percentages, device technology requirements,
manufacturer or standard constraints, and explicit deferrals (`TBC`,
`at next stage`, `by others`, `by specialist`).

---

## Known TBC patterns on schematics

Real examples that must flag rather than resolve:

- `TBC A TPN MCCB / TBC mm² 4C XLPE/SWA/LSZH` — an entire way undefined
- `PFC … details to be added at next stage`
- `SPD type … final details TBC by Lighting Protection Specialist`
- `TYPE TBC` inside a board type string
- `Cables by National Grid` / `by others` — outside scope, exclude from take-off but record

---

## Cross-checks against schedules

The schematic and the DB schedules are two views of the same system. Every
overlap is a free correctness check:

| Schematic | Schedule | Meaning of mismatch |
|---|---|---|
| Outgoing way device on feeding board | `Device Protecting DB` / `Supply CPD Details` | one document is stale — check revisions |
| Outgoing cable | `Supply Cable Details` | co-ordination error |
| Board rating / form | Board header | spec conflict |
| Board ref | `DB Fed From` / `Supply From` | topology error |
| Way count | `No. of Ways` | schedule may be a partial issue |

Where they disagree, prefer the **later revision** and flag both. Do not
silently merge.
