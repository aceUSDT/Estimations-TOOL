# AI-active vs regex-only recall — deployed endpoint

Generated 2026-07-07 UTC.
Endpoint: `https://estimationtoolz.netlify.app/.netlify/functions/extract`
(health: `{"status":"ok","configured":true,"model":"claude-opus-4-8"}`).

> ⚠️ **AI-active column is BLOCKED — the Anthropic account is out of credits.**
> The function is deployed and the key is valid, but every extraction request returns:
> `400 invalid_request_error — "Your credit balance is too low to access the Anthropic API.
> Please go to Plans & Billing to upgrade or purchase credits."` (request_id `req_011CcoUYUKhZ8coSzQNWhRWa`).
> No inference ran, so nothing was billed. **Add credits in the Anthropic Console, then re-run**
> `node tools/coverage/coverage-ai.mjs` (add `--all` for the full corpus) to populate the AI column.

## Method

- **regex-only** — the deployed app's inline pipeline (`extractor-core.js` + the verbatim
  `index.html` copy in `app-pipeline.cjs`), over the OCR'd fixture pages.
- **AI-active** — the same regex result, then every schedule/schematic page and every
  regex-empty page POSTed to the deployed `extract` function (the exact request shape the
  front-end sends); AI rows merge with **regex winning on slots it already filled, the model
  filling the gaps**. All counting/scoring is deterministic code (`extractor-core.buildCoverage`),
  never the model. Way-slots = distinct (board, way).

## Results — ground-truth anchor set (§0.5)

| Document | Pages | Boards (regex → AI) | Way-slots (regex → AI) | GT (regex) |
|---|---:|---:|---:|:--:|
| db-schedules/syntegral/25057_DB-Schedules_RevC02.pdf | 13 | 5 → _pending_ | 1 → _pending_ | ❌ |
| consumer-units/Dundee_CU-Circuit-Chart.pdf | 5 | 0 → _pending_ | 0 → _pending_ | ❌ |
| schematics/SRP1053-NB1-NB2_LV-Schematic_cable-sizes.pdf | 1 | 0 → _pending_ | 0 → _pending_ | ❌ |
| db-schedules/bam-epo/EPO_Ashfield_Circuitry-markup.pdf | 9 | 5 → _pending_ | 2 → _pending_ | ❌ |
| db-schedules/amtech/Broomfield-House_Circuit-Charts.pdf | 32 | 21 → _pending_ | 0 → _pending_ | ✅ |
| db-schedules/switchboard-mccb/MCCB-Schedule_BowGreen.pdf | 19 | 38 → _pending_ | 4 → _pending_ | ✅ |

**Regex-only headline (this run):** 69 boards but only **7 way-slots** captured across the six
anchor documents — i.e. board *references* are now found well (WS0.2), but per-circuit *rows* are
still almost entirely missed by OCR-then-regex on these image-only dialect pages. This is exactly
the gap the AI pass exists to close.

### DB-MECH stitch + DB-AV checks (regex-only)

| Check | regex-only | AI-active |
|---|---|---|
| DB-MECH: 18 ways (§0.5 — one board stitched pp 11–13) | ❌ captured 1/18 | _pending credits_ |
| DB-AV: 12-way (7 equipped + 4 spare + 1 SPD) | ❌ captured 0/12 | _pending credits_ |

Both fail on regex-only — the Syntegral `n/Lx` phase-slot rows don't match the BAM-tuned line
parser (confirmed in `reports/dialect-probe.md`: Syntegral 2/8 on *perfect* text, and OCR of the
dense grid is worse). The AI pass is expected to close both once credits are available.

## Reproduce

```bash
# regex-only baseline (no API, no key):
node tools/coverage/coverage-report.mjs        # → reports/coverage-baseline.{md,json}

# AI-active (needs credits on the account behind the deployed function):
node tools/coverage/coverage-ai.mjs            # ground-truth set → reports/coverage-ai.{md,json}
node tools/coverage/coverage-ai.mjs --all      # full corpus
# override endpoint if the URL changes:
AI_ENDPOINT=https://<host>/.netlify/functions/extract node tools/coverage/coverage-ai.mjs
```

The Anthropic key is never read locally — extraction happens server-side behind the function.
