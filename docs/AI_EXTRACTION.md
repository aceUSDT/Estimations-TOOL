# Optional online extraction

Local PDF text extraction, OCR, electrical parsing, counting, grouping, and reporting work
without an online model. A hosted browser deployment can additionally send difficult pages
to a Netlify function for structured extraction.

This option is off by default. A page image and its detected text are sent only after the
user enables **Use online extraction** before analysis. The desktop app disables the option
and remains local-only.

## Architecture

| File | Role |
|---|---|
| `netlify/functions/extract.mjs` | Synchronous health and extraction endpoint. |
| `netlify/functions/extract-background.mjs` | Queues dense pages that need more processing time. |
| `netlify/functions/extract-status.mjs` | Returns background job status and results. |
| `netlify/functions/lib/domain-pack.mjs` | Electrical taxonomy, dialect guidance, and structured output schema. |
| `index.html` | Applies explicit opt-in, submits eligible pages, and merges results as review-pending rows. |

The model may classify and structure source information. Device counts, procurement groups,
reconciliation, and workbook totals remain deterministic code. Existing deterministic rows
win when an online result refers to the same circuit slot.

## Server configuration

Set `GEMINI_API_KEY` in the Netlify site's server-side environment (Google Gemini is the
only runtime AI provider). Optionally set `GEMINI_MODEL` — it defaults to an exact pinned
model id. Never put a key in `index.html`, a committed `.env`, the desktop bundle,
or any other browser-downloadable file.

For local hosted-function development, use `netlify dev` with an untracked `.env`. Running
the static app with `npm run dev` leaves online extraction unavailable and does not affect
the local pipeline.

## Security and operations

The key is server-side, but the function URLs still need server-side authentication before
public or multi-tenant deployment. A client-side PIN does not protect a public function.
Until authentication and per-user quotas are added, restrict deployment access and enforce
provider spend limits.

## Verification

`node tools/coverage/test-extract-function.mjs` validates handlers and schema invariants
without a key or network call. Online recall checks should be run separately with an
authorised test deployment and non-sensitive fixtures.
