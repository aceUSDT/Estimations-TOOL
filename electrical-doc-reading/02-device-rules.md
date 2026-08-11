# 02 — Device Rules

How to decide *what a protective device actually is*. This is where the second
observed defect lives: three ways reading `61009 … RCD ✓ 30 mA` were reported as
`MCB 16A / MCB 6A / MCB 6A`. BS EN 61009 **is** the RCBO standard. The engine
had defaulted the class instead of reading it.

**A device class is never a default. It is derived, or it is flagged.**

---

## BS EN standard → device class

The single most reliable classifier when the column is present.

| BS EN | Device | Notes |
|---|---|---|
| 60898 / 60898-1 | MCB | Miniature circuit breaker, domestic/commercial |
| 61009 / 61009-1 | RCBO | MCB + integral RCD — **never an MCB** |
| 61008 / 61008-1 | RCCB | RCD only, no overcurrent protection |
| 60947-2 | MCCB / ACB | Moulded case or air circuit breaker; distinguish by frame/rating |
| 60947-3 | Switch / isolator / switch-disconnector | Not a protective device |
| 60269 / 60269-2 | Fuse (HRC/BS 88) | Fuse or fuse-switch |
| 62606 | AFDD | Arc fault detection device |
| 61439 / 61439-2 | Assembly standard | Describes the **board**, not a way |
| 61643 / 61643-11 | SPD | Surge protective device; Type 1 / 2 / 3 / 1+2 |
| 60898-3 / 60947-6-1 | ATS / changeover | Transfer switching equipment |

Guard: seeing `61439-2` in a device column means the column has been
mis-bound — that is an assembly standard and belongs to the board header.

---

## Derivation when the BS EN column is absent

Many dialects give no standard per way. Derive in this order, stopping at the
first that resolves:

```
1. Explicit class string in a device column      → use it
2. BS EN number                                   → table above
3. RCD indicated (✓ / mA value / "c/w RCD")       → see combination table
4. Board-level "type of outgoing device"          → inherit
5. Otherwise                                      → UNKNOWN, flag
```

### Combination table

| Overcurrent | RCD present | AFDD | Resulting device |
|---|---|---|---|
| yes | no | no | MCB (or MCCB by rating/frame) |
| yes | yes, integral | no | **RCBO** |
| yes | yes, upstream/shared | no | MCB **downstream of** an RCCB — count both |
| no | yes | no | RCCB |
| yes | yes | yes | AFDD/RCBO combination unit |
| yes | no | yes | AFDD + MCB (or combined AFDD/MCB) |

The distinction between *integral* and *shared* RCD protection is a real
commercial difference — one RCBO per way versus one RCCB protecting six MCBs.
Resolve it from geometry: an RCD value on the way's own row is integral; an RCD
shown once against a vertical span, in a bracket, or in a column header covering
a block of ways is shared.

### MCB vs MCCB boundary

Not a clean rating threshold, and don't invent one. Use, in order: the stated
BS EN (60898 → MCB, 60947-2 → MCCB); an explicit class string; the board type
(`MCB dist.board` vs `MCCB Panelboard`); then rating as a weak last resort
(≳125 A is usually MCCB). If it comes down to rating alone, mark it medium
confidence.

**Corpus contradiction to expect:** one board header reads
`Supply CPD Details: 60898 TYPE C 20A MCCB`. BS EN 60898 is the MCB standard.
The document is internally inconsistent. Correct behaviour is to extract both,
flag the conflict, and let the operator decide — not to silently pick one.

---

## Device string grammars

Several dialects pack the whole device spec into one free-text cell. These are
parseable, and parsing them is much safer than pattern-matching loose numbers.

### Grammar A — ElectricalOM (MODECSOFT)

```
MCB C 1P/10A/10kA
AFDD\RCBO C 1P/20A/10kA/30mA/Class A
RCBO B 1P/32A/6kA/30mA/Class A
```

```
CLASS[\CLASS] SP CURVE SP POLES "/" RATING "A" "/" BREAKING "kA" [ "/" RCD_MA "mA" ] [ "/Class " RCD_TYPE ]
```

Often accompanied by a manufacturer line that independently confirms the
standard:

```
Hager | NCN EN 60898-1 Type C 10kA
```

Cross-check the two. A mismatch (`RCBO` in the code, `60898` in the maker line)
is a flag, not a silent pick.

### Grammar B — Trimble / Amtech ProDesign

```
Hager, RCBO, ADC4 - 10kA - 1P+N, C Curve - Type A - 30mA
Generic AFDD BS62606 Electronic
None
```

```
MANUFACTURER "," CLASS "," CATALOGUE_REF " - " BREAKING " - " POLES "," CURVE " - " RCD_TYPE " - " RCD_MA
```

Fields are comma or dash delimited and **order varies**; parse by token type
(a `kA` token is breaking capacity, a `mA` token is RCD sensitivity, `1P+N` is
poles) rather than by position. The string frequently **wraps across two
physical lines** — join before parsing.

In this dialect the rating is *not* in the string; it is in a separate
`Rating (A)` column, and the RCD sensitivity appears again in a `Trip Rating (A)`
column expressed in amps (`0.03` = 30 mA). Reconcile the two.

`None` in the Earth Fault or Arc Flash device slot means *no separate device* —
it does **not** mean no RCD protection when the OCPD is itself an RCBO.

### Grammar C — Split columns (BES, and most tabular dialects)

No device class column at all:

```
WAY | PHASE | CIRCUIT DESCRIPTION | DESCRIPTION OF CIRCUIT | Rating | Curve | RCD (mA) | AFDD (Y/N)
  1 |   L1   | Ground floor corridor socket |     RING       |   32   |   B   |    30    |     Y
  3 |   L1   | Disable Refuge System Panel  |    RADIAL      |   16   |   B   |    -     |     N
```

Class must be derived: way 1 → 32 A Type B **AFDD/RCBO** (30 mA, arc fault);
way 3 → 16 A Type B **MCB**. Note `-` in the RCD column here means *no RCD*,
because the column's value domain is boolean-ish. In a numeric column it would
mean *not stated*.

### Grammar D — Rating-only (KFH and similar)

```
CPD: 25A        RCBO/AFDD: (blank)   → MCB/MCCB per board type, 25 A
CPD: 40A        RCBO/AFDD: c/w RCD   → RCBO, 40 A
```

Class inherits from the board header (`Type: 24-Way, TPN, 125A, MCB dist.board`
or `400A, TPN, MCC/CONTROL PANEL`). Note the device column header itself changes
between boards in the same file (`CPD` vs `MCCB/MCB`) — re-detect per board.

---

## Isolators, SPDs, and things that are not circuits

| Item | How it appears | Handling |
|---|---|---|
| Main switch / incomer | Board header block | Board-level item, quantified once |
| SPD | Full-width row (`Surge Protection Device Type 1+2`), or a board header flag (`c/w SPD`), or a symbol on the schematic | A real quantifiable item; record Type (1/2/3/1+2), do **not** treat as a way |
| Isolator | `Isolating Switch`, `TPN Isolator`, `Switch-disconnector`, 60947-3 | Not a protective device; may still be a priced item |
| Metering | `M` symbol, `Incoming meter (Y/N)`, split-metered board (L/P/M/W) | Board-level; drives meter kit quantities |
| ATS / changeover | On schematic near life-safety circuits | Board-level assembly item |
| Blank / blanking plate | Implied by unequipped spare ways | Computed, not read — see `07-quote-rules.md` |
| PFC | Schematic symbol on the main board | Board-level item, often `details TBC` → flag |

---

## Poles and phase occupancy

| Notation | Poles | Neutral | Ways occupied |
|---|---|---|---|
| `1P`, `SP` | 1 | no | 1 |
| `1P+N`, `SPN` | 1 | yes | 1 |
| `2P`, `DP` | 2 | — | 2 |
| `3P`, `TP` | 3 | no | 3 |
| `3P+N`, `TPN`, `4P` | 3 | yes | 3 (plus neutral bar) |

Ways occupied drives blank-plate counts and board sizing. A three-phase device
shown across `xL1 / xL2 / xL3` is **one device occupying three ways**, not three
devices. Getting this wrong inflates device counts by 3× on plant boards.

Physical module width is a separate quantity again — an RCBO may be 1 or 2
modules wide depending on range. Where the quote counts module positions
(`SINGLE POLE BUSBAR BLANK`), track modules, not just ways.
