# Baidu Unlimited-OCR as the document parser

`baidu/Unlimited-OCR` is a 3.3B vision-language model (MIT, built on DeepSeek-OCR)
that parses a whole document in **one pass** and returns text with layout and
bounding boxes, instead of a page at a time.

That shape matters here. UK tender sets run to hundreds of pages, and per-page
reading is where this project has repeatedly lost data — see
`PROJECT_HISTORY.md` §2.13, where one unreadable page abandoned sixteen others.

## What it is and is not, in this product

**It is** the head of the reading chain (`vision_parse` and `layout`) whenever the
operator hosts one.

**It is not** — and cannot be — the extractor for the desktop or browser build.
`CLAUDE.md` requires the desktop app to work from packaged assets with no hosted
dependency; a 3.3B model needing CUDA and ~6 GB of weights cannot satisfy that.
Tesseract in WASM and the deterministic parser remain the local path, and they
remain what runs when nothing is configured.

**It is unproven on these documents.** Nobody has yet probed it against a real UK
DB schedule, so `MODEL_REGISTRY` marks it `verified: false` and a verified model
always sits behind it in the chain. Do not flip that flag without a measurement —
`test-agent-team.mjs` asserts it, and the chain logic acts on it.

## Standing one up

It needs an NVIDIA GPU. Any host that exposes an OpenAI-compatible
`/chat/completions` works — vLLM and SGLang both do, and that is the only shape
the pool speaks.

```bash
docker run --rm --gpus all --network host --ipc host \
  vllm/vllm-openai:unlimited-ocr baidu/Unlimited-OCR
```

Then point the app at it:

| variable | required | meaning |
|---|---|---|
| `UNLIMITED_OCR_BASE_URL` | yes | e.g. `http://gpu-box:8000/v1`. Unset ⇒ the feature does not exist. |
| `UNLIMITED_OCR_API_KEY` | no | Sent as `Bearer` when set. A bare vLLM server needs none, and sending `Bearer undefined` is rejected — so it is omitted entirely when unset. |
| `UNLIMITED_OCR_MODEL` | no | Defaults to `baidu/Unlimited-OCR`. Set it for a quantised build published under another name. |

Confirm it is live:

```
GET /api/extract/health
→ { "providers": { "document_parser": true }, "document_parser": "baidu/Unlimited-OCR" }
```

## How it behaves in the chain

- **Configured** — leads `vision_parse` and `layout`. Exempt from the pool's
  per-key pacing, which models a free NVIDIA account's ~40 req/min; throttling an
  operator's own GPU against someone else's rate limit would be nonsense. Long
  timeout (300 s), because a whole-document pass is not a page read.
- **Unreachable** — the pool's existing health cooldown applies. It fails, cools
  down, and the proven NVIDIA reader takes over. Costs latency, never rows.
- **Not configured** — skipped as `no_endpoint`, exactly like a model whose key is
  missing. Nothing is sent anywhere. Asserted in `test-agent-team.mjs`.

## What still needs doing

- **Measure it.** Probe it on `EPO_Ashfield` p2 and a mirrored circuit chart, the
  way `nvidia/llama-3.1-nemotron-nano-vl-8b-v1` was probed (see its registry
  comment), and record the result in `PROJECT_HISTORY.md`. Only then is
  `verified: true` honest.
- **Exploit one-shot parsing.** Today it is called per page like every other
  vision model. Its actual advantage is reading a whole PDF in a single pass —
  taking that would mean a new role, not just a new model in an existing chain.
