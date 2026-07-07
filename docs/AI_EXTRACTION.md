# AI extraction — setup & key handling

The "AI extracts" half of the architecture (BUILD_BRIEF §0.0/§8): the browser posts one
page at a time (rendered JPEG + OCR/native text lines) to a Netlify Function, which calls
Claude with the domain pack and returns structured boards/devices/feeds. All counting,
aggregation and pricing remain deterministic code in the app — the model never counts.

## Pieces

| File | Role |
|---|---|
| `netlify/functions/extract.mjs` | Serverless endpoint. Reads `ANTHROPIC_API_KEY` server-side; `GET` is a health probe (`{configured: true/false}`), `POST` extracts one page. |
| `netlify/functions/lib/domain-pack.mjs` | The persisted extraction prompt (document classes, 7+ schedule dialects, P/T/Syntegral legends, spare-vs-space phase-slot rules) + the structured-output JSON schema. |
| `netlify.toml` | Functions dir + esbuild bundler; publish root. |
| `index.html` (AI EXTRACTION section) | Probes the endpoint once per session; if configured, sends schedule/schematic/unknown pages and any page the regex pass left empty. Results merge as **review-pending** rows — regex rows always win on a slot they already filled. If the endpoint is missing or unconfigured the app runs regex-only, exactly as before. |

## Enabling it (one-time, in Netlify)

1. **Rotate the key first.** Any key that has appeared in chat/tickets is compromised —
   generate a fresh one in the Anthropic Console (§8 of the brief).
2. Netlify → Site configuration → **Environment variables** → add `ANTHROPIC_API_KEY`.
   Never put it in the repo, `.env` committed files, or anything the browser downloads.
3. Optional: `EXTRACTION_MODEL` to override the default (`claude-opus-4-8`).
4. Deploy. The Documents tab's "Extraction coverage" panel shows
   `AI extraction: active (model)` when the probe succeeds.

## Local dev

`netlify dev` serves the function locally (reads `ANTHROPIC_API_KEY` from an untracked
`.env` — `.env*` is gitignored). Plain `python3 -m http.server` also works: the probe
fails and the app just runs regex-only.

## Costs, latency, and abuse

- One request per page, `max_tokens` 16000, prompt cached (the domain pack carries a
  `cache_control` breakpoint so repeat pages hit the cache).
- Netlify synchronous functions cap at ~26 s. If dense A0 schematics time out, set a
  faster `EXTRACTION_MODEL` or convert the function to a background function + polling.
- The endpoint is publicly invocable once deployed (the workspace password is client-side
  only — see §8). Until the gate moves server-side, watch usage in the Anthropic Console
  and set a spend limit on the key.

## Verifying

- `node tools/coverage/test-extract-function.mjs` — handler validation + schema invariants
  (no network, no key).
- With a key configured: drop `examples/db-schedules/syntegral/25057_DB-Schedules_RevC02.pdf`
  into a project; the coverage panel should show way-capture climbing well above the
  regex-only baseline, with AI rows flagged `[AI]` in the review queue.
