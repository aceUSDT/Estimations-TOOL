# Coverage baseline — deployed extractor vs examples/ corpus

Generated 2026-07-07 by `tools/coverage/` (Workstream 0, BUILD_BRIEF §2A).
Pipeline under test: **the deployed app's own code** — `extractor-core.js` + a verbatim copy of
`index.html`'s inline extraction path (classify → detect boards → parse schedule lines → feeders).

Two modes per document:
- **auto** — what "⚙ Analyse documents" extracts on ingest (native text layer only).
- **ocr** — the same pipeline after the manual "OCR scans" action (tesseract text via the app's `ocrWordsToLines`).

> **Corpus reality check:** every page of every fixture is image-only (re-rendered scans, no text layer),
> so the deployed app's automatic path extracts **zero rows from the entire corpus** until the user
> manually clicks OCR. That is failure mode §0.2‑4 (no auto-OCR) at 100% incidence.

| Document | Pages | auto rows | OCR rows | Boards named | Boards w/ rows | Way-slots captured | Expected ways (headers) | 0-row sched. pages | GT |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| consumer-units/114026_Typical-CU-Layouts.pdf | 1 | 0 | 0 | 0 | 0 | 0 | — | 1 |  |
| consumer-units/Dundee_CU-Circuit-Chart.pdf | 5 | 0 | 0 | 0 | 0 | 0 | — | 3 | ❌ |
| db-schedules/amtech/Broomfield-House_Circuit-Charts.pdf | 32 | 0 | 0 | 21 | 0 | 0 | 250 | 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32 | ✅ |
| db-schedules/bam-epo/EPO_Ashfield_Circuitry-markup.pdf | 9 | 0 | 2 | 5 | 1 | 2 | 112 | 1,2,3,4,5,6,7,9 | ❌ |
| db-schedules/bes/Kings-Road_G1-GF-DB-LL.pdf | 2 | 0 | 0 | 0 | 0 | 0 | — | 1,2 |  |
| db-schedules/hevacomp/DBG_The-Angel.pdf | 2 | 0 | 0 | 1 | 0 | 0 | — | 1 |  |
| db-schedules/simple/BC250847-E13_Distribution.pdf | 1 | 0 | 0 | 1 | 0 | 0 | 50 | 1 |  |
| db-schedules/switchboard-mccb/MCCB-Schedule_BowGreen.pdf | 19 | 0 | 4 | 38 | 3 | 4 | 28 | 7,9,11,13 | ✅ |
| db-schedules/switchboard-mccb/Switchboard-Schedules-P02.pdf | 5 | 0 | 4 | 11 | 1 | 4 | — | 1,5 |  |
| db-schedules/syntegral/25057_DB-Schedules_RevC02.pdf | 13 | 0 | 1 | 5 | 1 | 1 | 98 | 1,3,5,6,9,10,11 | ❌ |
| pricing-output/205987740_EnergyForce_Contractor.pdf | 3 | 0 | 0 | 0 | 0 | 0 | 8 | — |  |
| pricing-output/205987740_EnergyForce_Stockist.pdf | 3 | 0 | 0 | 0 | 0 | 0 | 8 | — |  |
| revisions/rev2_panel.pdf | 1 | 0 | 0 | 0 | 0 | 0 | — | 1 |  |
| revisions/rev3_panel_fuse-160A-not-32A.pdf | 1 | 0 | 0 | 0 | 0 | 0 | — | — |  |
| revisions/rev5_847-RME_Main-LV-Distribution_C5.pdf | 1 | 0 | 0 | 0 | 0 | 0 | — | 1 |  |
| scanned-ocr/SKM_scanned.pdf | 1 | 0 | 0 | 1 | 0 | 0 | — | 1 |  |
| scanned-ocr/doc08967_scanned.pdf | 6 | 0 | 0 | 15 | 0 | 0 | 34 | 3,4,5 |  |
| schematics/2429-SGL_LV-Schematic_Sheet1of2.pdf | 1 | 0 | 0 | 0 | 0 | 0 | — | 1 |  |
| schematics/2429-SGL_LV-Schematic_Sheet2of2.pdf | 1 | 0 | 0 | 0 | 0 | 0 | — | 1 |  |
| schematics/250405-GG_LV-Schematic.pdf | 1 | 0 | 0 | 0 | 0 | 0 | — | 1 |  |
| schematics/C056-BBK_LV-Schematic.pdf | 1 | 0 | 0 | 0 | 0 | 0 | — | 1 |  |
| schematics/SRP1053-NB1-NB2_LV-Schematic_cable-sizes.pdf | 1 | 0 | 0 | 0 | 0 | 0 | — | — | ❌ |

## Ground-truth anchor checks (BUILD_BRIEF §0.5)

### consumer-units/Dundee_CU-Circuit-Chart.pdf — **FAIL**
- ❌ boards_expected (3) — missing: CU General Apartment, CU Cluster Bedroom, CU Cluster Kitchen
- ❌ min_boards ≥ 3 — actual 0

### db-schedules/amtech/Broomfield-House_Circuit-Charts.pdf — PASS
- ✅ min_boards ≥ 10 — actual 21

### db-schedules/bam-epo/EPO_Ashfield_Circuitry-markup.pdf — **FAIL**
- ❌ min_rows ≥ 30 — actual 2

### db-schedules/switchboard-mccb/MCCB-Schedule_BowGreen.pdf — PASS
- ✅ min_boards ≥ 5 — actual 38

### db-schedules/syntegral/25057_DB-Schedules_RevC02.pdf — **FAIL**
- ✅ boards_expected (2)
- ❌ min_boards ≥ 10 — actual 5
- ❌ DB-MECH: 18 ways expected — captured 1
- ❌ DB-AV: 12 ways expected — captured 0

### schematics/SRP1053-NB1-NB2_LV-Schematic_cable-sizes.pdf — **FAIL**
- ❌ boards_expected (19) — missing: DB-00-08, DB-00-09, DB-00-10, DB-00-11, DB-00-12, DB-00-13, DB-00-14, DB-00-50, DB-01-21, DB-01-22, DB-01-23, DB-01-24, DB-01-25, DB-01-26, DB-01-27, DB-01-28, DB-01-29, DB-ESS-01, DB-00-SUBEXT
- ❌ min_boards ≥ 19 — actual 0

## Per-document page detail (OCR mode)

<details><summary><b>consumer-units/114026_Typical-CU-Layouts.pdf</b> — 0 rows, boards: none</summary>

| Page | Classified as | Lines | Rows | Boards on page |
|---:|---|---:|---:|---|
| 1 | spec | 64 | 0 |  |

</details>

<details><summary><b>consumer-units/Dundee_CU-Circuit-Chart.pdf</b> — 0 rows, boards: none</summary>

| Page | Classified as | Lines | Rows | Boards on page |
|---:|---|---:|---:|---|
| 1 | unknown | 6 | 0 |  |
| 2 | unknown | 9 | 0 |  |
| 3 | unknown | 27 | 0 |  |
| 4 | unknown | 21 | 0 |  |
| 5 | unknown | 21 | 0 |  |

</details>

<details><summary><b>db-schedules/amtech/Broomfield-House_Circuit-Charts.pdf</b> — 0 rows, boards: DBBY, DBB1, DBC, DBEVC, DBEXT, DBFF1, DBFFY, DBFF2, DBGF, DBGF1, DBK, DBL…</summary>

| Page | Classified as | Lines | Rows | Boards on page |
|---:|---|---:|---:|---|
| 1 | cover | 36 | 0 | DBBY, DBB1 |
| 2 | unknown | 31 | 0 | DBB1 |
| 3 | unknown | 13 | 0 | DBC |
| 4 | unknown | 16 | 0 | DBEVC |
| 5 | unknown | 15 | 0 | DBEXT |
| 6 | unknown | 35 | 0 | DBFF1 |
| 7 | unknown | 19 | 0 | DBFFY, DBFF1 |
| 8 | unknown | 39 | 0 | DBFF2 |
| 9 | unknown | 37 | 0 | DBFF2 |
| 10 | unknown | 18 | 0 | DBFF2 |
| 11 | unknown | 35 | 0 | DBGF, DBGF1 |
| 12 | unknown | 34 | 0 | DBGF1 |
| 13 | unknown | 38 | 0 | DBGF1 |
| 14 | unknown | 19 | 0 | DBGF1 |
| 15 | unknown | 32 | 0 | DBK |
| 16 | unknown | 13 | 0 | DBK |
| 17 | unknown | 31 | 0 | DBL |
| 18 | unknown | 31 | 0 | DBPR |
| 19 | unknown | 35 | 0 | DBRP |
| 20 | unknown | 13 | 0 | DBRP |
| 21 | unknown | 35 | 0 | DBSFT, DBSF1 |
| 22 | unknown | 19 | 0 | DBSF1 |
| 23 | unknown | 39 | 0 | DBSF2 |
| 24 | unknown | 38 | 0 | DBSF2 |
| 25 | unknown | 14 | 0 | DBSF2 |
| 26 | unknown | 35 | 0 | DBTF1 |
| 27 | unknown | 19 | 0 | DBTFY, DBTF1 |
| 28 | unknown | 38 | 0 | DBTF2 |
| 29 | unknown | 38 | 0 | DBTF2 |
| 30 | unknown | 12 | 0 | DBTF2 |
| 31 | unknown | 28 | 0 | DBC, DBEXT, DBB1, DBFF1, DBFF2, DBGF1 |
| 32 | unknown | 11 | 0 | DBSFI, DBSF2, DBTF1, DBTF2, DBEVC |

</details>

<details><summary><b>db-schedules/bam-epo/EPO_Ashfield_Circuitry-markup.pdf</b> — 2 rows, boards: DB0008P, DB0011P, DB0013P, DB0023P, UEU4</summary>

| Page | Classified as | Lines | Rows | Boards on page |
|---:|---|---:|---:|---|
| 1 | db-schedule | 50 | 0 | DB0008P |
| 2 | db-schedule | 40 | 0 | DB0008P |
| 3 | db-schedule | 51 | 0 | DB0011P |
| 4 | db-schedule | 34 | 0 | DB0011P |
| 5 | db-schedule | 55 | 0 | DB0013P |
| 6 | db-schedule | 30 | 0 | DB0013P |
| 7 | db-schedule | 52 | 0 | DB0023P |
| 8 | db-schedule | 47 | 2 |  |
| 9 | db-schedule | 49 | 0 | UEU4 |

</details>

<details><summary><b>db-schedules/bes/Kings-Road_G1-GF-DB-LL.pdf</b> — 0 rows, boards: none</summary>

| Page | Classified as | Lines | Rows | Boards on page |
|---:|---|---:|---:|---|
| 1 | db-schedule | 44 | 0 |  |
| 2 | unknown | 26 | 0 |  |

</details>

<details><summary><b>db-schedules/hevacomp/DBG_The-Angel.pdf</b> — 0 rows, boards: G1</summary>

| Page | Classified as | Lines | Rows | Boards on page |
|---:|---|---:|---:|---|
| 1 | cover | 92 | 0 | G1 |
| 2 | unknown | 23 | 0 |  |

</details>

<details><summary><b>db-schedules/simple/BC250847-E13_Distribution.pdf</b> — 0 rows, boards: PB1</summary>

| Page | Classified as | Lines | Rows | Boards on page |
|---:|---|---:|---:|---|
| 1 | sld | 91 | 0 | PB1 |

</details>

<details><summary><b>db-schedules/switchboard-mccb/MCCB-Schedule_BowGreen.pdf</b> — 5 rows, boards: DBLM, DBLS, DBLLD, DBLLE, DBLLG, DBALLF, DBLLSP, DBLLWF, DBLLWS, DBLLCP1, DBCP1LM1EV, DBLLEX…</summary>

| Page | Classified as | Lines | Rows | Boards on page |
|---:|---|---:|---:|---|
| 1 | cover | 18 | 0 |  |
| 2 | unknown | 33 | 0 |  |
| 3 | unknown | 7 | 0 |  |
| 4 | unknown | 0 | 0 |  |
| 5 | unknown | 15 | 1 | DBLM, DBLS, DBLLD, DBLLE, DBLLG |
| 6 | unknown | 0 | 0 |  |
| 7 | db-schedule | 44 | 0 | DBLLD, DBLLE, DBALLF, DBLLG, DBLLSP, DBLLWF |
| 8 | db-schedule | 33 | 1 |  |
| 9 | db-schedule | 49 | 0 |  |
| 10 | db-schedule | 44 | 1 | PANELH35 |
| 11 | db-schedule | 47 | 0 | DBLLD, PANELH, DB10100A, DBALD2, DB16100A, DB100A |
| 12 | unknown | 8 | 0 |  |
| 13 | db-schedule | 46 | 0 | DBLLE, PANELT, DBLLE1, DB10100A, DBLLE2, DBLLE3LTG |
| 14 | unknown | 9 | 0 |  |
| 15 | db-schedule | 46 | 1 | DBLLF, DBLLF1, DB100A, DBLLF2, DBLLF3, DBLLF4 |
| 16 | unknown | 10 | 0 |  |
| 17 | db-schedule | 45 | 1 | DBLLG, DBLLG1, DB100A, DBLLG2, DB10100A, DBLLG3 |
| 18 | unknown | 10 | 0 |  |
| 19 | spec | 46 | 0 |  |

</details>

<details><summary><b>db-schedules/switchboard-mccb/Switchboard-Schedules-P02.pdf</b> — 4 rows, boards: DBAPTGF, DBAPTAST, DBAPT2ND, DBAPT3RD, DBAPT4TH, DBAPT5TH, DBLLSTH, DBLL3RD, DBLL1ST, DBLLGE, DBPLANTH</summary>

| Page | Classified as | Lines | Rows | Boards on page |
|---:|---|---:|---:|---|
| 1 | db-schedule | 31 | 0 | DBAPTGF, DBAPTAST |
| 2 | db-schedule | 25 | 1 | DBAPT2ND, DBAPT3RD, DBAPT4TH, DBAPT5TH, DBLLSTH |
| 3 | db-schedule | 29 | 2 | DBLL3RD, DBLL1ST, DBLLGE |
| 4 | db-schedule | 22 | 1 | DBPLANTH |
| 5 | db-schedule | 15 | 0 |  |

</details>

<details><summary><b>db-schedules/syntegral/25057_DB-Schedules_RevC02.pdf</b> — 1 rows, boards: DB01, DB02, DB03, DBAV, DBMECH</summary>

| Page | Classified as | Lines | Rows | Boards on page |
|---:|---|---:|---:|---|
| 1 | db-schedule | 18 | 0 |  |
| 2 | unknown | 37 | 0 |  |
| 3 | db-schedule | 34 | 0 | DB01 |
| 4 | unknown | 30 | 0 |  |
| 5 | db-schedule | 21 | 0 | DB02 |
| 6 | db-schedule | 27 | 0 | DB02 |
| 7 | unknown | 30 | 0 |  |
| 8 | unknown | 28 | 0 |  |
| 9 | db-schedule | 42 | 0 | DB03 |
| 10 | db-schedule | 28 | 0 | DBAV |
| 11 | db-schedule | 42 | 0 | DBMECH |
| 12 | unknown | 36 | 0 |  |
| 13 | db-schedule | 31 | 1 | DBMECH |

</details>

<details><summary><b>pricing-output/205987740_EnergyForce_Contractor.pdf</b> — 2 rows, boards: none</summary>

| Page | Classified as | Lines | Rows | Boards on page |
|---:|---|---:|---:|---|
| 1 | cover | 35 | 0 |  |
| 2 | unknown | 37 | 2 |  |
| 3 | spec | 14 | 0 |  |

</details>

<details><summary><b>pricing-output/205987740_EnergyForce_Stockist.pdf</b> — 4 rows, boards: none</summary>

| Page | Classified as | Lines | Rows | Boards on page |
|---:|---|---:|---:|---|
| 1 | cover | 30 | 0 |  |
| 2 | unknown | 39 | 4 |  |
| 3 | spec | 12 | 0 |  |

</details>

<details><summary><b>revisions/rev2_panel.pdf</b> — 0 rows, boards: none</summary>

| Page | Classified as | Lines | Rows | Boards on page |
|---:|---|---:|---:|---|
| 1 | unknown | 84 | 0 |  |

</details>

<details><summary><b>revisions/rev3_panel_fuse-160A-not-32A.pdf</b> — 0 rows, boards: none</summary>

| Page | Classified as | Lines | Rows | Boards on page |
|---:|---|---:|---:|---|
| 1 | sld | 106 | 0 |  |

</details>

<details><summary><b>revisions/rev5_847-RME_Main-LV-Distribution_C5.pdf</b> — 0 rows, boards: none</summary>

| Page | Classified as | Lines | Rows | Boards on page |
|---:|---|---:|---:|---|
| 1 | unknown | 99 | 0 |  |

</details>

<details><summary><b>scanned-ocr/SKM_scanned.pdf</b> — 0 rows, boards: DB00</summary>

| Page | Classified as | Lines | Rows | Boards on page |
|---:|---|---:|---:|---|
| 1 | spec | 69 | 0 | DB00 |

</details>

<details><summary><b>scanned-ocr/doc08967_scanned.pdf</b> — 7 rows, boards: DBM, DBB1, DBC, DBEVC, DBEXT, DBFF1, DBFF2, DBGF1, DBK, DBL, DBRP, DBSF1…</summary>

| Page | Classified as | Lines | Rows | Boards on page |
|---:|---|---:|---:|---|
| 1 | cover | 38 | 0 |  |
| 2 | unknown | 56 | 7 | DBM |
| 3 | sld | 55 | 0 | DBB1, DBC, DBEVC, DBEXT, DBFF1 |
| 4 | sld | 58 | 0 | DBFF2, DBGF1, DBK, DBL |
| 5 | sld | 60 | 0 | DBRP, DBSF1, DBSF2, DBTF1, DBTF2 |
| 6 | sld | 30 | 0 |  |

</details>

<details><summary><b>schematics/2429-SGL_LV-Schematic_Sheet1of2.pdf</b> — 0 rows, boards: none</summary>

| Page | Classified as | Lines | Rows | Boards on page |
|---:|---|---:|---:|---|
| 1 | sld | 90 | 0 |  |

</details>

<details><summary><b>schematics/2429-SGL_LV-Schematic_Sheet2of2.pdf</b> — 0 rows, boards: none</summary>

| Page | Classified as | Lines | Rows | Boards on page |
|---:|---|---:|---:|---|
| 1 | sld | 121 | 0 |  |

</details>

<details><summary><b>schematics/250405-GG_LV-Schematic.pdf</b> — 0 rows, boards: none</summary>

| Page | Classified as | Lines | Rows | Boards on page |
|---:|---|---:|---:|---|
| 1 | unknown | 90 | 0 |  |

</details>

<details><summary><b>schematics/C056-BBK_LV-Schematic.pdf</b> — 0 rows, boards: none</summary>

| Page | Classified as | Lines | Rows | Boards on page |
|---:|---|---:|---:|---|
| 1 | sld | 116 | 0 |  |

</details>

<details><summary><b>schematics/SRP1053-NB1-NB2_LV-Schematic_cable-sizes.pdf</b> — 0 rows, boards: none</summary>

| Page | Classified as | Lines | Rows | Boards on page |
|---:|---|---:|---:|---|
| 1 | unknown | 65 | 0 |  |

</details>

