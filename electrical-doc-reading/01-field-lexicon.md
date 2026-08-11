# 01 — Field Lexicon

Header synonym → canonical field. Harvested from the actual header vocabulary of
the corpus (75 DB schedules across 30 distinct header fingerprints, plus CU
charts, MCCB schedules and schematic tables).

Match **case-insensitively, after stripping units, punctuation and line breaks**.
Match the longest synonym first. Where a header is a group parent, the canonical
name is the dotted path.

---

## Board-level fields (header block above the grid)

| Canonical | Observed synonyms |
|---|---|
| `board.ref` | DB Reference · Board Ref · Reference · Id No · Switchboard ref · Ref. · DIST/BD Ref · Board |
| `board.name` | Name · Description · Board Name |
| `board.location` | Location · Position · Level · Block · Room |
| `board.fed_from` | DB Fed From · Supply From · Supplied From · Connected from · Fed From · Source |
| `board.type` | Type · Board Type · ModelNo · Model No |
| `board.rating_a` | Board Rating (A) · Main Switch Rating (A) · Isolator Rating · Device Rating (A) |
| `board.fault_rating_ka` | Fault Rating (kA) · Prosp. F.C. (Ip) · Peak Fault (kA) · Busbar/panel f. level |
| `board.ze_ohm` | Ze (Ω) · Ze |
| `board.zs_ohm` | Zs (Ω) |
| `board.voltage` | Voltage · Supply details · Supply Voltage |
| `board.phases` | Phase · No. of Phases · N° of Phases · TP&N · SPN · TPN |
| `board.ways_total` | No. of Ways · Number of ways (TP) · Number of ways (SP) · Total circuit ways · Ways |
| `board.ways_spare` | Spare · Spare ways (SP) · Spare Ways · Spare capacity % · Empty ways |
| `board.incomer_device` | Incomer Details · Incomer devices · Internal Isolator Details · Main Switch · Device Protecting DB · Upstream device · Supply CPD Details · Type of incoming device |
| `board.supply_cable` | Supply Cable Details · Incoming cable |
| `board.metering` | Incoming meter (Y/N) · Metering · Meter |
| `board.form` | Form · Internal separation · Form of Segregation |
| `board.ip_rating` | IP Rating · Degree of protection |
| `board.mounting` | Mounting · Panel Arrangement |
| `board.connected_load_a` | Total Connected Load (A) · Connected load (A) |
| `board.diversified_load_a` | Total Diversified Load (A) · Diversified load (A) · Diversified+Spare load (A) |

---

## Way-level fields (the grid)

### Identity

| Canonical | Observed synonyms |
|---|---|
| `way.number` | Way · Way No · Circuit No. · Circuit Reference · Ckt · No |
| `way.phase` | Phase · Phase 3 or L1/L2/L3 · L1 / L2 / L3 · Pole |
| `way.description` | Circuit Reference · Circuit Description · Description · Description of Circuit · Serving · Name · Id No |
| `way.location` | Location · Area · Room |
| `way.circuit_type` | Circuit Type · Type of circuit · Rd/Rg · RADIAL / RING |

Note: `Circuit Reference` is a genuine collision — in some dialects it is the
**way identifier**, in others it is the **circuit description**. Disambiguate by
content type of the column (numeric/alphanumeric ID vs free prose), not by the
header string alone. See `05-trap-catalogue.md` T-12.

### Protective device

| Canonical | Observed synonyms |
|---|---|
| `device.bs_en` | Device BS (EN) · BS(EN) · BS EN · Standard · Device Standard |
| `device.class` | Device · Device Type · Protective Device · Overcurrent Protective Device · CPD · MCCB/MCB · Type of outgoing device |
| `device.curve` | Type · Curve · Tripping Curve · Char · Characteristic |
| `device.rating_a` | Rating (A) · Rating · In · In (A) · Protective Device (A) · Trip Rating (A) |
| `device.breaking_capacity_ka` | Short Circuit Capacity (kA) · SCC · Breaking Capacity · kA · Icu · Ics · kcs |
| `device.rcd_present` | RCD · RCD (×/✓) · Earth Fault Protective Device · c/w RCD |
| `device.rcd_ma` | RCD Operating Current (mA) · RCD (mA) · IΔn · Trip Rating (A) *(when expressed in amps, e.g. 0.03)* |
| `device.rcd_type` | RCD Type · Type A / Type AC / Type B / Type F |
| `device.afdd` | AFDD · AFDD (Y/N) · Arc Flash Protective Device · Arc Fault |
| `device.poles` | Poles · 1P · 1P+N · 3P · 4P · SP · TP · SPN · TPN |
| `device.manufacturer` | Manufacturer · Device Manufacturer · Make |

### Conductor / cable

| Canonical | Observed synonyms |
|---|---|
| `cable.live_csa_mm2` | Live (mm²) · L&N · Live · Phase csa · Cable Size mm² · Size · csa · Conductors csa |
| `cable.cpc_csa_mm2` | CPC (mm²) · CPC · Sep. CPC · Earth · E |
| `cable.cores` | Cores · No. of Cores · Conductor |
| `cable.type` | Cable Type · Type of wiring · Conductor · Cable · Cable Type (see code) |
| `cable.install_method` | Install Ref Method BS 7671 · Ref Method · Reference Method · Installation Method · Method |
| `cable.length_m` | Length · Length (m) · Distance · Cable Length · Run |
| `cable.reference` | Cable ref · Cable Reference · Cable No |

### Calculated / compliance

| Canonical | Observed synonyms |
|---|---|
| `calc.ib_a` | Ib · Ib (A) · Design Current · Connected Load (A) |
| `calc.iz_a` | Iz · Iz (A) · Current Carrying Capacity |
| `calc.in_a` | In · In (A) *(same as `device.rating_a` — see collision note below)* |
| `calc.zs_ohm` | Zs · Max Zs BS 7671 (Ω) · Zs (Ω) · Earth Fault Loop Impedance |
| `calc.disconnection_time_s` | Max Dis-conn. Time BS 7671 (s) · Disconnection Time · Max Disc. Time |
| `calc.volt_drop` | VD · Volt Drop · %VD · Voltage Drop |
| `calc.load_kw` | kW · Load (kW) · Connected Load · Load |
| `calc.power_factor` | PF · Power Factor · cos φ |
| `calc.diversity` | Diversity · Diversity Factor |

---

## Known collisions — resolve by context, not string

| Ambiguous header | Possible meanings | Resolution |
|---|---|---|
| `In` | device rating (A) · "in" as a preposition in prose | Only accept as a field when it sits in a header band; require a numeric column beneath |
| `Type` | tripping curve (B/C/D) · device class (MCB/RCBO) · board type · cable type | Resolve by parent header group and by the value domain of the column |
| `Rating (A)` | OCPD rating · RCD trip rating · board rating | Resolve by parent group: `Overcurrent…` vs `Earth Fault…` vs board header |
| `Description` | circuit description · board description · cable description | Resolve by parent group and column position |
| `Circuit Reference` | way ID · circuit description | Resolve by value type in the column body |
| `Phase` | which line (L1/L2/L3) · number of phases | Resolve by value domain: `L1\|L2\|L3` vs `1\|3\|SP\|TP` |
| `Conductor` | cable spec string · CPC column · cores | Resolve by parent group |
| `Trip Rating (A)` | RCD trip in **amps** (0.03 = 30 mA) | Convert: values < 1 A in a trip column are RCD sensitivities |
| `Spare` | spare way count (board header) · spare marker (way row) | Resolve by whether it sits in the header block or the grid |

---

## Value normalisation

| Field | Accept | Normalise to |
|---|---|---|
| ratings | `32`, `32A`, `32 A`, `32.0` | integer or decimal amps |
| RCD sensitivity | `30`, `30mA`, `0.03`, `0.03A`, `30 mA` | milliamps (integer) |
| CSA | `1.5`, `1.50`, `1.5mm2`, `1.5mm²`, `2.5 mm sq` | mm² decimal |
| booleans | `Y`/`N`, `Yes`/`No`, `✓`/`×`, `x`, `-`, `•`, shaded box | tri-state: true / false / **unknown** |
| curve | `B`, `C`, `D`, `Type C`, `C Curve`, `Curve C` | single letter |
| poles | `1P`, `SP`, `1P+N`, `SPN`, `3P`, `TP`, `4P`, `TPN`, `3P+N` | `{poles: int, neutral: bool}` |
| spare | `SPARE`, `Spare`, `empty`, `-`, blank, `N/A`, `SPARE WAY` | `spare` status + equipped/unequipped |
| placeholder | `TBC`, `T.B.C.`, `??`, `?`, `GUESS`, `TBA`, `XXX`, `-` in a numeric column | `null` + `flag: placeholder` |

**`-` is context-dependent** and this matters. In a boolean column it means
*no*. In a numeric column it means *not stated* → placeholder → flag. In a
description column it means *nothing here*. Resolve by the column's value
domain, never globally.
