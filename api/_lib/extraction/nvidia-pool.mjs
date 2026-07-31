/* NVIDIA build.nvidia.com model pool — the sub-agent workforce.
 *
 * One OpenAI-compatible endpoint fronts every model; the owner supplies up to
 * three free-tier API keys (one per NVIDIA account), each with its OWN rate
 * budget (~40 req/min). This module turns that into a dependable workforce:
 *
 *  - MODEL_REGISTRY  : model id → { key slot, vision, verified } (live-probed
 *                      2026-07-22; unverified entries stay in chains and are
 *                      skipped fast on failure, auto-recovering when NVIDIA's
 *                      serverless queue frees up).
 *  - ROLE_CHAINS     : role → ordered fallback chain. A stalled model NEVER
 *                      blocks the take-off — the next model in the chain runs.
 *  - createPool()    : dependency-injected caller with per-key pacing (token
 *                      window), per-model health cooldown, hard timeouts, and
 *                      sanitized errors (no key material, ever).
 *
 * The pool extracts and reasons; deterministic code still computes every
 * count, disagreement, and total (crossCheckExtractions, report-core).
 */

export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

/* Baidu Unlimited-OCR — the document parser, when the operator hosts one.
 *
 * A 3.3B vision-language model (MIT, built on DeepSeek-OCR) that parses a whole
 * document in ONE pass and returns text with layout and bounding boxes, rather
 * than a page at a time. That is the right shape for this product: UK tender
 * sets run to hundreds of pages, and per-page reading is where this project has
 * repeatedly lost data (see PROJECT_HISTORY 2.13 — one unreadable page abandoned
 * sixteen others).
 *
 * It is NOT on NVIDIA's hosted catalogue, so the operator runs it themselves —
 * vLLM or SGLang, both of which expose an OpenAI-compatible /chat/completions
 * endpoint, which is exactly the shape this pool already speaks. Point
 * UNLIMITED_OCR_BASE_URL at it and it becomes the head of the reading chain.
 *
 *   docker run --gpus all --network host --ipc host \
 *     vllm/vllm-openai:unlimited-ocr baidu/Unlimited-OCR
 *   UNLIMITED_OCR_BASE_URL=http://your-host:8000/v1
 *
 * Unset, nothing changes: the model is skipped exactly like any model whose key
 * is missing, and the existing chain runs. It can never be a hard dependency —
 * the desktop build must keep working from packaged assets with no network at
 * all (CLAUDE.md), which a 3.3B CUDA model can never satisfy. */
export const UNLIMITED_OCR_MODEL = 'baidu/Unlimited-OCR';

export function unlimitedOcrConfig(env = process.env) {
  const baseUrl = String(env.UNLIMITED_OCR_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!baseUrl) return null;
  return {
    baseUrl,
    model: String(env.UNLIMITED_OCR_MODEL || UNLIMITED_OCR_MODEL).trim(),
    /* A self-hosted vLLM server usually needs no key. Send one only when the
       operator set it, so a bare local endpoint is not rejected for sending
       "Bearer undefined". */
    apiKey: String(env.UNLIMITED_OCR_API_KEY || '').trim() || null,
  };
}

/* Which key slot (1..3) serves each model — mirrors the owner's key→model
 * mapping so each free account carries its intended share of the load. */
export const MODEL_REGISTRY = {
  'deepseek-ai/deepseek-v4-flash':            { key: 1, vision: false, verified: true  },
  'openai/gpt-oss-120b':                      { key: 1, vision: false, verified: false },
  'qwen/qwen3-next-80b-a3b-instruct':         { key: 1, vision: false, verified: false },
  'minimaxai/minimax-m3':                     { key: 1, vision: false, verified: true  },
  // Layout zoner, NOT a row reader: on dense UK DB schedules it returns the
  // page's zones (header table, footer, and the circuit table as a Picture
  // bbox) — useful for cropping, never for row extraction. Its API rejects
  // ANY text content (image-only message), caps total context at 9k tokens,
  // and answers via a markdown_bbox tool call (live-probed 2026-07-22).
  'nvidia/nemotron-parse':                    { key: 1, vision: true,  verified: true, imageOnly: true, maxTokensCap: 8000, responseKind: 'nemotron_parse' },
  'meta/llama-3.3-70b-instruct':              { key: 2, vision: false, verified: false },
  'z-ai/glm-5.2':                             { key: 2, vision: false, verified: true  },
  'nvidia/llama-3.3-nemotron-super-49b-v1.5': { key: 2, vision: false, verified: true  },
  'nvidia/nemotron-nano-12b-v2-vl':           { key: 2, vision: true,  verified: false, timeoutMs: 150000 },
  'deepseek-ai/deepseek-v4-pro':              { key: 3, vision: false, verified: true  },
  // Live-probed 2026-07-22 on EPO_Ashfield p2 @2400px long edge: board
  // DB-00-08P correct, 18/18 row lines read (13 populated + blanks —
  // conservative over-capture; deterministic code filters). ~107s latency →
  // needs the long per-model timeout and an async budget when routed.
  'nvidia/llama-3.1-nemotron-nano-vl-8b-v1':  { key: 3, vision: true,  verified: true, timeoutMs: 150000 },
  /* Self-hosted, so it carries its own endpoint and key rather than an NVIDIA
     slot. `selfHosted` exempts it from the pool's per-key NVIDIA pacing: that
     budget models a free-tier account's ~40 req/min, and throttling an operator's
     own GPU against someone else's rate limit would be nonsense. A whole-document
     pass is long, hence the generous timeout. */
  [UNLIMITED_OCR_MODEL]:                      { vision: true, verified: false, selfHosted: true, timeoutMs: 300000, maxTokensCap: 32000 },
};

/* Ordered fallback chains per sub-agent role. Verified-responsive models
 * lead; stalled-but-configured models trail (they auto-recover via health
 * cooldown). `second_opinion` additionally excludes whatever model produced
 * the primary extraction at call time — vendor diversity is the point. */
export const ROLE_CHAINS = {
  extract: [
    'deepseek-ai/deepseek-v4-flash',
    'z-ai/glm-5.2',
    'minimaxai/minimax-m3',
    'qwen/qwen3-next-80b-a3b-instruct',
    'openai/gpt-oss-120b',
  ],
  second_opinion: [
    'z-ai/glm-5.2',
    'minimaxai/minimax-m3',
    'nvidia/llama-3.3-nemotron-super-49b-v1.5',
    'meta/llama-3.3-70b-instruct',
  ],
  audit: [
    'deepseek-ai/deepseek-v4-pro',
    'nvidia/llama-3.3-nemotron-super-49b-v1.5',
    'z-ai/glm-5.2',
  ],
  vision_parse: [
    UNLIMITED_OCR_MODEL,                         // the master reader, when hosted
    'nvidia/llama-3.1-nemotron-nano-vl-8b-v1',   // the proven row reader
    'nvidia/nemotron-nano-12b-v2-vl',
  ],
  // Page zoning (bboxes for cropping table regions before OCR/vision).
  layout: [
    UNLIMITED_OCR_MODEL,                         // returns layout AND bboxes in one pass
    'nvidia/nemotron-parse',
  ],
};

/* Reads every NVIDIA_API_KEY_n the operator has configured, not a fixed three.
 * Each key is a separate NVIDIA account with its own rate limit, so an owner
 * who adds keys 4-7 is buying headroom — silently ignoring them wasted it. */
export const MAX_KEY_SLOTS = 8;

export function poolKeysFromEnv(env = process.env) {
  const keys = {};
  for (let n = 1; n <= MAX_KEY_SLOTS; n++) {
    const v = env[`NVIDIA_API_KEY_${n}`];
    if (typeof v === 'string' && v.length > 8) keys[n] = v;
  }
  return keys;
}

export function poolStatus(env = process.env) {
  const keys = poolKeysFromEnv(env);
  const slots = {};
  for (let n = 1; n <= MAX_KEY_SLOTS; n++) slots[n] = Boolean(keys[n]);
  return {
    configured: Object.keys(keys).length > 0,
    count: Object.keys(keys).length,
    keys: slots,
  };
}

/* Strip ```json fences etc. and parse; returns null (never throws) so a
 * malformed sub-agent reply degrades to a fallback, not a crash. */
export function parseModelJson(content) {
  if (typeof content !== 'string' || !content.trim()) return null;
  let t = content.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

/* Error factory: stable codes, no key material, no raw provider body.
 * `httpStatus` is carried through as `status` when the failure came from an
 * HTTP response, because the worker's transient-retry set tests e.status. */
function poolError(code, detail, httpStatus) {
  const e = new Error(`nvidia-pool: ${code}${detail ? ` (${detail})` : ''}`);
  e.code = code;
  if (Number.isInteger(httpStatus)) e.status = httpStatus;
  return e;
}

export function createPool(opts = {}) {
  const keys = opts.keys || poolKeysFromEnv();
  const fetchImpl = opts.fetchImpl || fetch;
  const now = opts.now || (() => Date.now());
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 60000;
  const rpmPerKey = opts.rpmPerKey != null ? opts.rpmPerKey : 30;   // headroom under NVIDIA's ~40
  const cooldownMs = opts.cooldownMs != null ? opts.cooldownMs : 120000;
  const registry = opts.registry || MODEL_REGISTRY;
  const chains = opts.chains || ROLE_CHAINS;
  /* Resolved once per pool, and injectable so tests can exercise the self-hosted
     path without a GPU anywhere in sight. */
  const selfHostedCfg = opts.selfHosted !== undefined ? opts.selfHosted : unlimitedOcrConfig();

  /* Where a model is called, and with what credential. NVIDIA models use the
     shared endpoint and a pooled account key; a self-hosted model brings its own
     endpoint and may need no key at all. Returns null when a self-hosted model
     has no endpoint configured, which is how it gets skipped rather than
     throwing — an operator without a GPU box must lose nothing. */
  function endpointFor(model, meta) {
    if (!meta.selfHosted) return null;
    if (!selfHostedCfg || !selfHostedCfg.baseUrl) return null;
    return { url: `${selfHostedCfg.baseUrl}/chat/completions`, key: selfHostedCfg.apiKey, sendModel: selfHostedCfg.model || model };
  }

  /* Per-key request timestamps (60s window). Keyed lazily rather than to a
     fixed 1-2-3, because the pool now accepts every configured slot: an owner
     whose only key sits in slot 5 would otherwise hit `undefined.filter` here
     the moment a model borrowed it. */
  const stamps = {};
  const health = new Map();                        // model → { fails, lastFailAt }

  function paceDelay(keyId) {
    if (!stamps[keyId]) stamps[keyId] = [];
    const t = now();
    stamps[keyId] = stamps[keyId].filter((s) => t - s < 60000);
    if (stamps[keyId].length < rpmPerKey) return 0;
    return 60000 - (t - stamps[keyId][0]) + 25;    // wait until the oldest stamp expires
  }

  function markResult(model, ok) {
    if (ok) { health.delete(model); return; }
    const h = health.get(model) || { fails: 0, lastFailAt: 0 };
    h.fails += 1; h.lastFailAt = now();
    health.set(model, h);
  }

  function isCoolingDown(model) {
    const h = health.get(model);
    return Boolean(h && h.fails >= 2 && now() - h.lastFailAt < cooldownMs);
  }

  async function callModel(model, req = {}) {
    const meta = registry[model];
    if (!meta) throw poolError('unknown_model', model);
    const endpoint = endpointFor(model, meta);
    if (meta.selfHosted && !endpoint) throw poolError('no_endpoint', model);
    let key = endpoint ? endpoint.key : keys[meta.key];
    /* A model is PINNED to a key slot to spread load across accounts, but a
       pin is not a reason to go dark: if that slot is unconfigured, borrow any
       key the operator did provide. Without this, models pinned to slot 2 or 3
       simply never ran for an owner who had only key 1 — a silent loss of most
       of the chain. */
    let usedKeyId = meta.key;
    if (!key && !endpoint) {
      const spare = Object.keys(keys).map(Number).sort((a, b) => a - b)[0];
      if (spare) { key = keys[spare]; usedKeyId = spare; }
    }
    /* A self-hosted endpoint legitimately needs no key — a bare vLLM server
       accepts unauthenticated calls — so only pooled models require one. */
    if (!key && !endpoint) throw poolError('no_key', `slot ${meta.key} for ${model}`);

    /* Pace and report against the key ACTUALLY used, not the pinned slot.
       Pacing the wrong slot would let a borrowed key exceed its own rate limit
       while an unconfigured slot's budget was spent on paper, and reporting
       the wrong slot would tell the operator a key was working when it was
       never called. */
    /* Pacing models a free NVIDIA account's ~40 req/min. An operator's own GPU
       has no such budget, so throttling it against someone else's rate limit
       would just make their hardware slower for no reason. */
    if (!endpoint) {
      const delay = paceDelay(usedKeyId);
      if (delay > 0) await sleep(delay);
      (stamps[usedKeyId] = stamps[usedKeyId] || []).push(now());
    }

    const messages = [];
    if (req.system && !meta.imageOnly) messages.push({ role: 'system', content: req.system });
    if (req.imageBase64 && meta.vision) {
      const imagePart = { type: 'image_url', image_url: { url: `data:${req.mediaType || 'image/jpeg'};base64,${req.imageBase64}` } };
      // Some dedicated parsers (nemotron-parse) reject ANY text content.
      messages.push({ role: 'user', content: meta.imageOnly ? [imagePart] : [{ type: 'text', text: req.prompt || '' }, imagePart] });
    } else {
      messages.push({ role: 'user', content: req.prompt || '' });
    }

    let maxTokens = req.maxTokens != null ? req.maxTokens : 4000;
    if (meta.maxTokensCap && maxTokens > meta.maxTokensCap) maxTokens = meta.maxTokensCap;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), meta.timeoutMs || timeoutMs);
    const t0 = now();
    let res;
    try {
      res = await fetchImpl(endpoint ? endpoint.url : `${NVIDIA_BASE_URL}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: endpoint ? endpoint.sendModel : model,
          messages,
          max_tokens: maxTokens,
          temperature: req.temperature != null ? req.temperature : 0,
        }),
      });
    } catch (e) {
      clearTimeout(timer);
      markResult(model, false);
      throw poolError(e && e.name === 'AbortError' ? 'timeout' : 'network', model);
    }
    clearTimeout(timer);

    if (!res.ok) {
      markResult(model, false);
      throw poolError(res.status === 429 ? 'rate_limited' : `http_${res.status}`, model, res.status);
    }
    let data;
    try { data = await res.json(); } catch { markResult(model, false); throw poolError('bad_json', model); }
    const msg = data && data.choices && data.choices[0] && data.choices[0].message || null;
    let content = msg ? msg.content : null;
    // Dedicated parsers answer via a tool call (markdown_bbox) instead of
    // content: synthesize the elements JSON so every caller sees `content`.
    if (meta.responseKind === 'nemotron_parse' && (!content || !content.length)) {
      const call = msg && Array.isArray(msg.tool_calls) ? msg.tool_calls[0] : null;
      content = call && call.function ? call.function.arguments : null;
    }
    if (typeof content !== 'string' || !content) { markResult(model, false); throw poolError('empty_reply', model); }
    markResult(model, true);
    return { content, model, keyId: endpoint ? 'self-hosted' : usedKeyId, ms: now() - t0 };
  }

  /* Walk a role's chain: skip excluded + cooling-down models, try the rest in
   * order. Every attempt is recorded so failures are diagnosable. */
  async function callRole(role, req = {}, o = {}) {
    const chain = chains[role];
    if (!chain) throw poolError('unknown_role', role);
    const exclude = new Set(o.exclude || []);
    const attempts = [];
    for (const model of chain) {
      if (exclude.has(model)) { attempts.push({ model, skipped: 'excluded' }); continue; }
      if (isCoolingDown(model)) { attempts.push({ model, skipped: 'cooldown' }); continue; }
      const meta = registry[model];
      /* A self-hosted model is available when its endpoint is configured, not
         when an NVIDIA slot holds a key. Without this it was skipped as
         "no_key" forever and the head of the chain never ran. */
      if (!meta) { attempts.push({ model, skipped: 'unknown_model' }); continue; }
      if (meta.selfHosted) {
        if (!endpointFor(model, meta)) { attempts.push({ model, skipped: 'no_endpoint' }); continue; }
      } else if (!keys[meta.key]) { attempts.push({ model, skipped: 'no_key' }); continue; }
      try {
        const out = await callModel(model, req);
        return { ...out, role, attempts };
      } catch (e) {
        attempts.push({ model, error: e.code || 'error' });
      }
    }
    const err = poolError('role_exhausted', role);
    err.attempts = attempts;
    throw err;
  }

  return { callModel, callRole, isCoolingDown, _paceDelay: paceDelay, keysConfigured: Object.keys(keys).map(Number) };
}
