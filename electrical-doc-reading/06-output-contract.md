# 06 — Output Contract

One normalised model, whatever the source dialect. Dialect adapters produce
this; everything downstream — reconciliation, review UI, aggregation, pricing —
consumes only this.

---

## Principles

1. **Every value is a `Field`**, never a bare scalar. A bare scalar has no
   confidence and no provenance, and cannot be reviewed.
2. **Absence is typed.** `null` + reason: `not_stated` / `placeholder` /
   `unreadable` / `out_of_scope`. Never an empty string, never zero.
3. **Provenance is mandatory** — file, page, bbox. The review UI shows the source
   crop beside the value; without a bbox that is impossible.
4. **Raw text is retained** alongside the parsed value, always.

---

## Field envelope

```jsonc
{
  "value": 32,
  "unit": "A",
  "raw": "32",
  "confidence": "high",              // high | medium | low
  "flags": [],                        // see flag vocabulary
  "source": {
    "file": "DB Schedule 20260420 G1-GF-DB-LL.pdf",
    "page": 1,
    "bbox": [412.5, 388.2, 436.0, 399.1],
    "column": "protective_device.rating",
    "method": "grid_bind"             // grid_bind | header_block | device_string | legend | note_rule | derived | ocr
  }
}
```

---

## Document

```jsonc
{
  "document_id": "sha256:…",
  "file": "…pdf",
  "doc_class": "db_schedule",         // db_schedule | schematic | cu_chart | mccb_schedule
                                      // | board_spec_form | specification | settings | quote | unknown
  "dialect": "bes",                   // trimble | bes | electricalom | quinnross | ocsc
                                      // | bam_composite | cu_chart | schematic_embedded | generic
  "dialect_confidence": 0.94,
  "drawing_number": {…Field},
  "revision": {…Field},
  "revision_date": {…Field},
  "status": {…Field},                 // e.g. "S5 - For Approval", "For Construction"
  "project": {…Field},
  "originator": {…Field},
  "has_text_layer": true,
  "ocr_applied": false,
  "pages": 2,
  "supersedes": ["sha256:…"],         // same drawing_number, lower revision
  "extraction": { "coverage": 0.97, "gate_passed": true, "warnings": [] }
}
```

---

## Board

```jsonc
{
  "board_id": "uuid",
  "ref": {…Field},                    // "G1-GF-DB-LL"
  "aliases": ["DB/G1/GF/LL"],
  "name": {…Field},
  "location": {…Field},
  "level": {…Field},
  "board_type": {…Field},             // "24-Way, TPN, 125A, MCB dist.board"
  "form": {…Field},                   // "Form 4 Type 2"
  "ip_rating": {…Field},
  "rating_a": {…Field},
  "fault_rating_ka": {…Field},
  "voltage": {…Field},
  "phases": {…Field},
  "ze_ohm": {…Field},

  "ways_total": {…Field},
  "ways_populated": {…Field},
  "ways_spare_equipped": {…Field},
  "ways_spare_unequipped": {…Field},
  "modules_total": {…Field},          // single-pole module positions, for blank counts
  "modules_used": {…Field},

  "fed_from": {
    "board_ref": {…Field},
    "way_number": {…Field},
    "device": {…Device},              // upstream OCPD
    "cable": {…Cable},
    "evidence": ["schedule_header", "schematic_edge"],
    "agreement": "match"              // match | conflict | single_source | unresolved
  },

  "incomer": {…Device},
  "metering": { "present": {…Field}, "type": {…Field}, "split": {…Field} },
  "spd": { "present": {…Field}, "type": {…Field} },
  "typical": {
    "is_typical": true,
    "instances": {…Field},            // multiplier; null + flag if unresolved
    "covers": ["DB/EW", "DB/WW"]
  },
  "ways": [ {…Way} ],
  "flags": []
}
```

---

## Way

```jsonc
{
  "way_number": {…Field},             // "1", "8", "5.L2" → normalised to 5
  "phase": {…Field},                  // L1 | L2 | L3 | TP | null
  "status": "populated",              // populated | spare_equipped | spare_unequipped | not_used
  "occupies_ways": 3,                 // 1 for SP, 3 for TP
  "occupies_modules": 3,
  "description": {…Field},
  "location": {…Field},
  "circuit_type": {…Field},           // radial | ring | submain
  "life_safety": {…Field},            // from cable colour / FP cable / notes
  "device": {…Device},
  "cable": {…Cable},
  "calc": {
    "ib_a": {…Field}, "in_a": {…Field}, "iz_a": {…Field},
    "zs_ohm": {…Field}, "disconnection_time_s": {…Field},
    "volt_drop_pct": {…Field}, "load_kw": {…Field}
  },
  "section": "METER SECTION 2 - MECHANICAL POWER",   // inherited partition context
  "flags": []
}
```

---

## Device

```jsonc
{
  "class": {…Field},                  // MCB | RCBO | RCCB | MCCB | ACB | AFDD | AFDD_RCBO
                                      // | FUSE | SWITCH | ISOLATOR | SPD | ATS | UNKNOWN
  "class_basis": "bs_en",             // bs_en | explicit | derived_rcd | board_type | UNRESOLVED
  "bs_en": {…Field},
  "rating_a": {…Field},
  "curve": {…Field},                  // B | C | D
  "breaking_capacity_ka": {…Field},
  "poles": { "count": {…Field}, "neutral": {…Field} },
  "rcd": {
    "present": {…Field},
    "sensitivity_ma": {…Field},
    "type": {…Field},                 // AC | A | F | B
    "scope": "integral"               // integral | shared_upstream | none | unknown
  },
  "afdd": {…Field},
  "manufacturer": {…Field},
  "catalogue_ref": {…Field},
  "electronic_trip": {…Field},        // note-driven requirement
  "flags": []
}
```

`class_basis` is not optional. If it is `UNRESOLVED`, the device may not be
priced. This single field is what prevents the T-02 defect class from returning.

---

## Cable

```jsonc
{
  "live_csa_mm2": {…Field},
  "cpc_csa_mm2": {…Field},
  "separate_cpc": {…Field},
  "cores": {…Field},
  "parallel_runs": {…Field},          // "2x150mm²" → 2
  "insulation": {…Field},             // XLPE | PVC | LSZH | thermosetting
  "armour": {…Field},                 // SWA | none
  "sheath": {…Field},                 // LSZH | LSF | PVC
  "fire_rated": {…Field},             // FP200 | FP400 | FP600 | MICC | none
  "type_code": {…Field},              // raw legend letter, e.g. "B"
  "type_resolved": {…Field},          // resolved against THIS document's legend
  "legend_source": { "file": "…", "page": 14 },
  "install_method": {…Field},
  "length_m": {…Field},
  "length_basis": "stated",           // stated | estimated | derived | unknown
  "reference": {…Field},              // "Cable ref: 14B"
  "flags": []
}
```

---

## Flag vocabulary

Stable strings — the review UI and the pricing gate both key on these.

| Flag | Meaning | Blocks pricing |
|---|---|---|
| `placeholder` | `TBC` / `??` / `GUESS` / `TBA` in source | yes |
| `not_stated` | Field genuinely absent | depends on field |
| `ambiguous_binding` | Word straddled two column bands | yes |
| `class_unresolved` | Device class could not be derived | yes |
| `legend_unresolved` | Code with no legend entry in this document | yes |
| `checkbox_unanswered` | Option group with zero selections | yes |
| `checkbox_conflict` | Option group with multiple selections | yes |
| `source_conflict` | Schematic and schedule disagree | yes |
| `internal_conflict` | Document contradicts itself (e.g. `60898 … MCCB`) | yes |
| `off_series_value` | Rating or CSA not in the standard series | yes |
| `typical_multiplier_unknown` | Typical board, instance count unresolved | yes |
| `coverage_gate_failed` | Too few ways bound for the board | yes |
| `ocr_low_confidence` | Below OCR threshold | yes |
| `superseded_revision` | A later revision of this drawing exists | yes |
| `out_of_scope` | `by others` / `by National Grid` | excluded, not flagged for review |
| `estimated_length` | Length given with `~` | no — priced, marked |
| `note_derived` | Quantity generated by a sheet note rule | no — priced, marked |

---

## Review pairing

The project brief calls for input and output side by side, filterable by board
reference and device type. That requires, for every emitted item:

- `source.file`, `source.page`, `source.bbox` → render the crop
- `raw` → show exactly what was on the page
- `value`, `confidence`, `flags` → show what the engine concluded
- `board_ref`, `device.class` → the two filter axes

Design the extractor so this is always available. Anything that cannot be traced
back to a rectangle on a page should not be in the take-off.
