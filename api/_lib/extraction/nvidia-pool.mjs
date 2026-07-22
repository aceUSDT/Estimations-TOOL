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

/* Which key slot (1..3) serves each model — mirrors the owner's key→model
 * mapping so each free account carries its intended share of the load. */
export const MODEL_REGISTRY = {
  'deepseek-ai/deepseek-v4-flash':            { key: 1, vision: false, verified: true  },
  'openai/gpt-oss-120b':                      { key: 1, vision: false, verified: false },
  'qwen/qwen3-next-80b-a3b-instruct':         { key: 1, vision: false, verified: false },
  'minimaxai/minimax-m3':                     { key: 1, vision: false, verified: true  },
  'nvidia/nemotron-parse':                    { key: 1, vision: true,  verified: false },
  'meta/llama-3.3-70b-instruct':              { key: 2, vision: false, verified: false },
  'z-ai/glm-5.2':                             { key: 2, vision: false, verified: true  },
  'nvidia/llama-3.3-nemotron-super-49b-v1.5': { key: 2, vision: false, verified: true  },
  'nvidia/nemotron-nano-12b-v2-vl':           { key: 2, vision: true,  verified: false },
  'deepseek-ai/deepseek-v4-pro':              { key: 3, vision: false, verified: true  },
  'nvidia/llama-3.1-nemotron-nano-vl-8b-v1':  { key: 3, vision: true,  verified: false },
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
    'nvidia/nemotron-parse',
    'nvidia/nemotron-nano-12b-v2-vl',
    'nvidia/llama-3.1-nemotron-nano-vl-8b-v1',
  ],
};

export function poolKeysFromEnv(env = process.env) {
  const keys = {};
  for (const n of [1, 2, 3]) {
    const v = env[`NVIDIA_API_KEY_${n}`];
    if (typeof v === 'string' && v.length > 8) keys[n] = v;
  }
  return keys;
}

export function poolStatus(env = process.env) {
  const keys = poolKeysFromEnv(env);
  return {
    configured: Object.keys(keys).length > 0,
    keys: { 1: Boolean(keys[1]), 2: Boolean(keys[2]), 3: Boolean(keys[3]) },
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

/* Error factory: stable codes, no key material, no raw provider body. */
function poolError(code, detail) {
  const e = new Error(`nvidia-pool: ${code}${detail ? ` (${detail})` : ''}`);
  e.code = code;
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

  const stamps = { 1: [], 2: [], 3: [] };          // per-key request timestamps (60s window)
  const health = new Map();                        // model → { fails, lastFailAt }

  function paceDelay(keyId) {
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
    const key = keys[meta.key];
    if (!key) throw poolError('no_key', `slot ${meta.key} for ${model}`);

    const delay = paceDelay(meta.key);
    if (delay > 0) await sleep(delay);
    stamps[meta.key].push(now());

    const messages = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    if (req.imageBase64 && meta.vision) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: req.prompt || '' },
          { type: 'image_url', image_url: { url: `data:${req.mediaType || 'image/jpeg'};base64,${req.imageBase64}` } },
        ],
      });
    } else {
      messages.push({ role: 'user', content: req.prompt || '' });
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const t0 = now();
    let res;
    try {
      res = await fetchImpl(`${NVIDIA_BASE_URL}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: req.maxTokens != null ? req.maxTokens : 4000,
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
      throw poolError(res.status === 429 ? 'rate_limited' : `http_${res.status}`, model);
    }
    let data;
    try { data = await res.json(); } catch { markResult(model, false); throw poolError('bad_json', model); }
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : null;
    if (typeof content !== 'string' || !content) { markResult(model, false); throw poolError('empty_reply', model); }
    markResult(model, true);
    return { content, model, keyId: meta.key, ms: now() - t0 };
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
      if (!meta || !keys[meta.key]) { attempts.push({ model, skipped: 'no_key' }); continue; }
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
