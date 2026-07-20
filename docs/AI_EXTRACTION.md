# Optional online extraction

Local PDF text extraction, OCR, electrical parsing, counting, grouping, and reporting work
without an online model. A hosted browser deployment can additionally send difficult pages
to a Netlify function for structured extraction.

This option is off by default. A page image and its detected text are sent only after the
user enables **Use online extraction** before analysis. The desktop app disables the option
and remains local-only.

## Architecture

Hosted extraction runs on **Vercel Node.js API routes** (the Netlify functions were removed
in the platform migration — see `docs/MIGRATION_VERCEL_SUPABASE.md`).

| File | Role |
|---|---|
| `api/extract/health.mjs` | Health probe: reports Gemini-only configuration (no secrets). |
| `api/extract/run.mjs` | Stateless per-page extraction for the local-first browser — runs Gemini inline (maxDuration 60s), returns the structured result; no auth, no database, no Netlify Blobs. |
| `api/extractions/{start,status,result}.mjs` | Durable, authenticated, auditable job routes (Supabase-backed) for the multi-tenant account path. |
| `api/_lib/extraction/domain-pack.mjs` | Electrical taxonomy, dialect guidance, and structured output schema. |
| `api/_lib/extraction/providers.mjs` | Gemini-only provider + deterministic cross-check. |
| `index.html` | Applies explicit opt-in consent, submits eligible pages to `/api/extract/run`, and merges results as review-pending rows. |

The model may classify and structure source information. Device counts, procurement groups,
reconciliation, and workbook totals remain deterministic code. Existing deterministic rows
win when an online result refers to the same circuit slot.

## Server configuration

Set `GEMINI_API_KEY` in the Vercel server-side environment (Google Gemini is the only hosted
AI provider). Optionally set `GEMINI_MODEL` (pinned default; never changed silently) and
`GEMINI_VERIFY_MODEL` (second Gemini pass whose disagreements are computed by deterministic
code). Never put a key in `index.html`, a committed `.env`, the desktop bundle,
or any other browser-downloadable file.

For local development, use `vercel dev` with an untracked `.env.local`. Running the static
app with `npm run dev` leaves hosted extraction unavailable and does not affect the local
deterministic pipeline. The desktop app never enables hosted extraction.

## Security and operations

The key is server-side, but the function URLs still need server-side authentication before
public or multi-tenant deployment. A client-side PIN does not protect a public function.
Until authentication and per-user quotas are added, restrict deployment access and enforce
provider spend limits.

## Verification

`node tools/coverage/test-extract-function.mjs` validates handlers and schema invariants
without a key or network call. Online recall checks should be run separately with an
authorised test deployment and non-sensitive fixtures.
