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

## Two routes, and which one you want

| | Baidu Cloud (hosted) | Self-hosted (vLLM/SGLang) |
|---|---|---|
| hardware | **none** | NVIDIA GPU, ~6 GB weights |
| protocol | Baidu's own async REST | OpenAI `/chat/completions` |
| what it takes | a whole PDF, **up to 500 pages / 100 MB**, in one submission | one image per call |
| cost | 200 free pages (individual verified), 1000 (enterprise); limited-time free | your GPU |
| in this repo | `unlimited-ocr-cloud.mjs` | `nvidia-pool.mjs`, head of the reading chain |
| configure | `BAIDU_OCR_API_KEY` + `BAIDU_OCR_SECRET_KEY` | `UNLIMITED_OCR_BASE_URL` |

**Start with Baidu Cloud.** It needs no hardware, and its whole-document
submission is the actual advantage of this model — the thing a per-page vision
call throws away.

## The hosted route (no GPU)

Sign up at Baidu AI Cloud and create an application for the Document Parsing
(`unlimited-ocr-parser`) service; it issues an **API Key** and a **Secret Key**.
Docs: <https://cloud.baidu.com/doc/OCR/s/fmr1p39gb>

```
BAIDU_OCR_API_KEY=...
BAIDU_OCR_SECRET_KEY=...
```

Confirm with `GET /api/extract/health` → `"document_parser_cloud": true`.

The client is `api/_lib/extraction/unlimited-ocr-cloud.mjs`:

```js
const client = createUnlimitedOcrCloud();
const task = await client.parseDocument({ fileBase64, fileName: 'tender.pdf' });
const markdown = await client.fetchMarkdown(task.markdownUrl);
```

It is asynchronous by design — submit, poll, fetch — because a 500-page parse is
not a request/response. Things it handles that are easy to get wrong:

- **Rejects before uploading.** Unsupported extension or over 100 MB fails
  locally. Discovering that after pushing 100 MB is slow and, on a metered
  connection, not free.
- **Quota is not a failure.** Error codes 17/18/19 return
  `quota_or_rate_limited`. Your 200 free pages running out is an ordinary
  Tuesday; an estimator must not read it as "the document could not be parsed".
- **Submit is paced to 2 QPS**, the documented limit, so two documents dropped
  together do not spend quota on rejected calls.
- **The token is cached** and refreshed early. Baidu tokens last ~30 days, and one
  expiring mid-poll would turn a finished 400-page parse into a failure.
- **No credential ever reaches an error.** The key and secret travel in the
  request URL, so a raw URL in a message or log would expose both. Asserted, and
  verified by deliberately leaking one and watching the test fail.
- **A parse that does not finish returns `timedOut: true` with its task id**,
  rather than throwing — so it can be resumed instead of restarted.

## The self-hosted route (your own GPU)

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

## From a parsed document to board rows

`api/_lib/extraction/parsed-markdown.mjs` lowers the returned markdown into the
LINE shape the extractor already reads, rather than adding a second extraction
path. A table row

```
| 7 | L1 | Kitchen ring | 32 | B | 30 |
```

becomes `7  L1  Kitchen ring  32  B  30`, which `parseScheduleLine` reads with
the same four way-marker forms, damaged-phase handling and classless-dialect
rules that were measured against real documents in `PROJECT_HISTORY.md` §2.

That is deliberate. Everything valuable in this project is in what already reads
a line; none of it should be re-derived for a new input format. It is also a
*cleaner* input than OCR: the cell boundaries are known rather than inferred from
pixel gaps — §2.4 measured the widest whitespace corridor on a real sheet at 1.2%
of the page span.

Two details worth keeping:

- **Cells join with two spaces, not one.** A single space glues `32` and `B` into
  a token that reads as neither a rating nor a curve.
- **No recognisable page marker means one page, not a guess.** A wrong split puts
  a page number on every Review item that the estimator then cannot find in the
  document.

`tableDensity()` reports how much of the result is table. A schedule parsed well
is mostly table; a result that is nearly all prose means the parser read the
sheet as text, and the take-off will be thin — worth surfacing before the
workbook does (§2.8).

## What still needs doing

- **Measure it.** Probe it on `EPO_Ashfield` p2 and a mirrored circuit chart, the
  way `nvidia/llama-3.1-nemotron-nano-vl-8b-v1` was probed (see its registry
  comment), and record the result in `PROJECT_HISTORY.md`. Only then is
  `verified: true` honest.
- **Call it from ingestion.** The client and the markdown→lines adapter both
  exist and are tested; nothing in the app sends a document to either yet. That
  is the last connecting piece.
- **The self-hosted route is still called per page** like every other vision
  model. The hosted route is what exploits one-shot parsing today.
