# examples/ — test corpus for the estimating tool

A curated set of real UK electrical documents covering every document class and every
schedule **dialect** the extractor must handle. Use it to run the **coverage report**
(Workstream 0) and the acceptance tests in `docs/BUILD_BRIEF.md` §0.5 / §5 / §7.

## ⚠️ Read this about the files
These PDFs were **re-rendered from page images** of processed copies, so they are
**image-only (no native text layer)** — the tool will OCR them. That's fine for testing,
but where you still have the **original PDFs** (they keep the native text layer the
extractor prefers), commit those instead — recall on native-text documents behaves
differently from OCR'd ones, and you want to test both paths. Filenames here are cleaned
up; keep your originals' names if you swap them in.

## Structure (mirrors the 3-type classification, with dialect sub-folders for schedules)
```
examples/
  schematics/            # Class: Schematic (spatial, input→output backbone)
  db-schedules/          # Class: Distribution Board Schedule
    amtech/  bes/  syntegral/  bam-epo/  hevacomp/  simple/  switchboard-mccb/
  consumer-units/        # Class: Distribution Board Schedule (domestic sub-format)
  specifications/        # Class: Specification   ← EMPTY, add one (see below)
  revisions/             # revision set for revision-diff / Compare
  pricing-output/        # wholesaler quotes (secondary — pricing format only)
  scanned-ocr/           # image-only docs to prove auto-OCR fallback
```

## What each fixture is for

| File | Class / dialect | What it tests |
|---|---|---|
| `schematics/SRP1053-NB1-NB2_LV-Schematic_cable-sizes.pdf` | Schematic | **Flagship schematic recall (§0.5):** must yield the 2500A ACB, the F-referenced outgoing devices, **every** downstream DB (DB-00-08…14, DB-01-21…29, DB-ESS-01, DB-00-SUBEXT) and the EVC feeder pillar (28 × 7.4 kW). Also the schematic half of the **cross-reference** test. |
| `schematics/2429-SGL_LV-Schematic_Sheet1of2 / Sheet2of2.pdf` | Schematic | Multi-sheet schematic — the feed graph spans two sheets. |
| `schematics/C056-BBK_LV-Schematic.pdf` | Schematic | Another panel→sub-DB topology. |
| `schematics/250405-GG_LV-Schematic.pdf` | Schematic | Additional schematic layout variety. |
| `db-schedules/amtech/Broomfield-House_Circuit-Charts.pdf` | DB schedule — **Amtech/Trimble** | "Board Data" + per-way `In/Ir/Type/RCD/AFDD/Cable/Cores/CPC`; 32 pp (multi-board). |
| `db-schedules/bes/Kings-Road_G1-GF-DB-LL.pdf` | DB schedule — **BES/Brenbar** | **`DB Fed From` field (§5.4)** — the tabular input→output link. |
| `db-schedules/syntegral/25057_DB-Schedules_RevC02.pdf` | DB schedule — **Syntegral** | **Acceptance (§0.5):** DB-MECH is ONE 18-way TP&N board **stitched across pp 11–13**; DB-AV = 7 equipped + 4 spare + 1 SPD (way 12). Coded cables 1–5. |
| `db-schedules/bam-epo/EPO_Ashfield_Circuitry-markup.pdf` | DB schedule — **BAM/EPO** | The **one dialect the current regex extractor already parses** (`parseBamScheduleLine`); P1–P5 / T1–T6 legends; "Serving" + incoming cable ref. Regression baseline. |
| `db-schedules/hevacomp/DBG_The-Angel.pdf` | DB schedule — **Hevacomp** | Device-note block format; "Served by SBxx". |
| `db-schedules/simple/BC250847-E13_Distribution.pdf` | DB schedule — **simple markup** | Minimal `Way / Rating / Type / Phase` + hand-added cable notes. |
| `db-schedules/switchboard-mccb/Switchboard-Schedules-P02.pdf` | Switchboard schedule | Board-level (one row per outgoing device/board). |
| `db-schedules/switchboard-mccb/MCCB-Schedule_BowGreen.pdf` | MCCB schedule | Has a **Summary Index** → use it for the **reconciliation/self-check** pass (§0.3). |
| `consumer-units/Dundee_CU-Circuit-Chart.pdf` | CU circuit chart | **Acceptance (§0.5):** all **three** CU variants (General Apartment / Cluster Bedroom / Cluster Kitchen), not just the first. |
| `consumer-units/114026_Typical-CU-Layouts.pdf` | CU layout (SLD-style) | CU as a drawing rather than a table. |
| `revisions/rev2_panel.pdf`, `rev3_panel_fuse-160A-not-32A.pdf`, `rev5_847-RME…_C5.pdf` | Revision set | **Acceptance (§5.2/§5.5):** detect fuse **32A → 160A**, **UPS removed + generator added**, **SDP added**; reconcile with the drawing's P1…C5 amendment block. |
| `pricing-output/205987740_EnergyForce_Contractor / _Stockist.pdf` | Pricing output (secondary) | Target quote format (product code / description / qty / price, grouped). |
| `scanned-ocr/SKM_scanned.pdf`, `doc08967_scanned.pdf` | Image-only | **Auto-OCR fallback (§0.2 #4):** must yield boards/devices, not empty. |

## Intentionally NOT included — please add
1. **A real Specification** → `specifications/`. None of the processed copies was a true
   NBS-style specification. Add one of yours (e.g. `06. Electrical Specification.pdf` or
   `114026-…-ElectricalSpecification.pdf`) so the 3rd classification type has a fixture.
2. **The cross-reference schedule** → `db-schedules/bam-epo/`. Add
   `SRP1053-…-6858 Schedule No 11 Distribution Boards.pdf`. It shares board **DB-00-08**
   and cable **F28** with the `SRP1053-NB1-NB2` schematic already here, which is exactly
   the **schematic↔schedule cross-reference** acceptance test (§5.3). (Omitted here only
   because it's ~10 MB.)
3. **A large multi-board schedule for the pagination stress test** (§0.2 #1) →
   `db-schedules/amtech/`. Add `DB_Schedules_P02` (54 pp) or
   `DBs_with_devices_for_Ben…` (70 pp) and confirm no boards are dropped past page ~N.

## How to use
- Point the tool / coverage report at this folder.
- For each file, expected-vs-captured should match (see the table + `docs/BUILD_BRIEF.md`).
- Swap in your original PDFs where you have them; keep this set as the dialect checklist.
