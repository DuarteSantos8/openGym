/* One adapter shape for every provider that is just an HTTPS endpoint.
 *
 * Runs unchanged on the server (node's fetch) and on the phone (an injected fetch that goes
 * through the native HTTP layer, so the WebView's CORS rules never apply). It spawns nothing,
 * so it needs no unprivileged user, no job directory and no AI runtime in the image — the
 * default api image has everything it needs.
 *
 * The return shape is the one the pipeline already classifies for the runtime-backed
 * adapters — { code, text, stderr, timedOut, spawnError } — and the mapping is deliberate:
 *
 *   2xx with text            → code 0, text
 *   non-2xx                  → code 1, stderr "<status> <message>"   the leading 401/403 is what
 *                                                                    the pipeline's auth regex
 *                                                                    keys on
 *   cut off at max tokens    → code 1                                 a half JSON object would
 *                                                                    burn the single repair round
 *   fetch threw / aborted    → code 1 with the host / timedOut
 *   no key and one required  → spawnError                             "missing", like an absent CLI
 *
 * A provider is described by a spec (see anthropic.js etc.); this file owns the transport.
 */
import { HTTP_PROVIDERS, baseUrlFor, extraHeadersFor } from '../providers.js';

export const MAX_OUTPUT_TOKENS = 16000;
const DEFAULT_TIMEOUT_MS = 5 * 60000;
// A hosted API answers 429 (rate limit) and 529/503 (overloaded) routinely and briefly. One
// job is minutes of a person's patience; failing it on a status the provider itself calls
// transient would be wrong, so those statuses get two more tries with a short pause, and
// only then become the job's failure. Never on a 4xx that means "the request is wrong".
export const RETRY_STATUSES = new Set([429, 500, 502, 503, 504, 529]);
const RETRY_DELAYS_MS = [2000, 5000];
const sleep = (ms, signal) => new Promise(resolve => {
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

const hostOf = url => { try { return new URL(url).host; } catch { return url; } };
// What the admin card's Runtime line names: the scheme the endpoint is actually called with. An
// OpenAI-compatible model on the LAN is usually plain http://, and calling that "HTTPS" told the
// owner the traffic was encrypted when it was not.
const schemeOf = url => { try { return new URL(url).protocol === 'http:' ? 'HTTP' : 'HTTPS'; } catch { return 'HTTPS'; } };
const trim = (s, n = 300) => String(s == null ? '' : s).slice(0, n);

// A base that already names its API version (OpenRouter's …/api/v1, Zhipu's …/paas/v4, Gemini's
// …/v1beta/openai) is the whole prefix, so the spec's own leading version is dropped instead of
// doubled into …/v4/v1/chat/completions (#437). A bare host still gets the spec's version.
const VERSION_SEGMENT = /\/v\d+(?:(?:alpha|beta)\d*)?(?=\/|$)/i;
export function endpointUrl(base, path) {
  const basePath = base.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  if (!VERSION_SEGMENT.test(basePath)) return base + path;
  return base + path.replace(LEADING_VERSION, '');
}
const LEADING_VERSION = new RegExp('^' + VERSION_SEGMENT.source, 'i');

// The third shape (#508): a prefix but no version at all, like Open WebUI's /openai mount, which
// answers {base}/chat/completions and 404s anything with /v1 in it. A spec that opts in
// (`versionlessFallback`) tries the other form once on a 404, and the base that answered
// without the version is remembered so the next request goes there first. A bare host and every
// base that works today still gets exactly the request it got before.
const versionlessBases = new Set();
// What an error answer is allowed to say back: the provider's own JSON error message, never the
// raw body. The endpoint of a compatible provider is any URL an admin types, so echoing the body
// would let one admin read the first lines of any page the server can reach (a router, a service
// on the LAN). A provider that failed says why in JSON; anything else is reported by its status.
function shownError(spec, data, max = 200) {
  const m = spec.errorMessage(data);
  return typeof m === 'string' && m ? trim(m, max) : '(the endpoint sent no error message)';
}

function candidateUrls(spec, base, path) {
  const url = endpointUrl(base, path);
  if (!spec.versionlessFallback) return [url];
  const bare = base + path.replace(LEADING_VERSION, '');
  if (bare === url) return [url];
  return versionlessBases.has(base) ? [bare, url] : [url, bare];
}

/** `send(url)` with the fallback above. When the other form fails as well, the first answer is
 *  the one returned, so Ollama's "model not found" 404 still reaches the person unchanged. */
async function reach(spec, base, path, send) {
  const urls = candidateUrls(spec, base, path);
  const first = await send(urls[0]);
  if (first.status !== 404 || urls.length < 2) return first;
  const second = await send(urls[1]);
  if (!second.ok) { try { await second.text(); } catch { /* drained or gone */ } return first; }
  if (urls[1] === endpointUrl(base, path)) versionlessBases.delete(base);
  else versionlessBases.add(base);
  return second;
}

// A model the key cannot call (#758). Google retires names for new keys while old keys keep
// them (gemini-2.5-pro: "no longer available to new users"), so a default that worked for the
// person who wrote it 404s for the next one, and a model saved on a phone goes stale the same
// way. Every provider says it in its own words: 404 with "model" in it, or a 400 that names a
// model as unknown (OpenRouter: "is not a valid model ID").
const MODEL_REFUSED = /\bmodels?\b.*(not found|does not exist|no longer available|not available|not supported|not a valid|invalid|unknown)|(unknown|invalid|no such|not a valid) model/i;
export const isModelGone = (status, msg) => (status === 404 && /\bmodel/i.test(msg)) || (status === 400 && MODEL_REFUSED.test(msg));
// What a substitute must not be: the listing also carries speech, image and embedding models
// that answer generateContent or chat with something useless for a plan.
const NOT_TEXT = /embed|tts|audio|image|imagen|veo|lyria|live|transcri|robotics|aqa|banana|omni|computer-use|deep-research|whisper|dall-e|moderation|realtime|guard/i;
// The model that answered in place of a refused one, per provider, endpoint and refused name, so
// the repair round and the next job go straight there instead of paying for the 404 again.
const substitutes = new Map();
const substituteKey = (id, base, model) => `${id} ${base} ${model}`;
/** The model used in place of `model` after the provider refused it, or null. */
export const modelSubstitute = (id, cfg, model) => substitutes.get(substituteKey(id, baseUrlFor(id, cfg), model)) || null;

/** A fetch, bounded by AbortController. Never throws for HTTP status; throws for transport. */
async function call(fetchImpl, url, init, timeoutMs, signal) {
  const ctl = new AbortController();
  const onOuter = () => ctl.abort();
  if (signal) signal.addEventListener('abort', onOuter, { once: true });
  // An abort that already landed (during a retry pause, say) must not let a fresh request leave.
  if (signal && signal.aborted) ctl.abort();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onOuter);
  }
}

async function readJson(res) {
  const text = await res.text();
  try { return { data: JSON.parse(text), text }; } catch { return { data: null, text }; }
}

export function httpAdapter(spec) {
  const id = spec.id;
  const meta = HTTP_PROVIDERS[id];
  if (!meta) throw new Error(`httpAdapter: unknown provider "${id}"`);

  const keyOf = env => (env && env[meta.apiKeyEnv]) || null;

  /** A model to try in place of the refused one, or null when there is nothing better to try. */
  async function usableModel(refused, { cfg, env, fetchImpl, signal }) {
    const listed = await adapter.models(cfg, env, { fetch: fetchImpl, signal });
    const fallback = meta.defaultModel && meta.defaultModel !== refused ? meta.defaultModel : null;
    if (!listed.ok) return fallback;
    if (fallback && listed.models.includes(fallback)) return fallback;
    const text = listed.models.filter(m => m !== refused && !NOT_TEXT.test(m));
    if (spec.preferModel) return spec.preferModel(text) || null;
    // Generic: the same family as the refused name (its vendor/ or name- prefix), newest-looking
    // last in the sorted list, so a stale google/gemini-2.5-pro lands on another Gemini.
    const family = /^[^/]+\//.exec(refused)?.[0] || /^[^-:]+/.exec(refused)?.[0] || '';
    const kin = family ? text.filter(m => m.startsWith(family)) : [];
    return (kin.length ? kin[kin.length - 1] : text[0]) || null;
  }

  const adapter = {
    id,
    runtime: meta.runtime,
    // The two facts the server's job runner branches on. Stated, not inferred from absence.
    spawns: false,
    needsRuntime: false,

    baseUrl: cfg => baseUrlFor(id, cfg),

    /**
     * Can this provider be reached? Without a key there is nothing to ask the provider, and
     * fetch itself is never absent — so the runtime is "ready" and the credential tile says
     * what is missing. With a key, listing the models is the cheapest real round trip and
     * doubles as the auth check the admin card renders.
     */
    async check(cfg, env, opts = {}) {
      const base = adapter.baseUrl(cfg);
      if (!base) return { ok: false, error: 'no endpoint configured' };
      if (!keyOf(env) && !meta.keyOptional) return { ok: true, version: `${schemeOf(base)} · ${hostOf(base)}`, needsKey: true };
      const r = await adapter.models(cfg, env, opts);
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, version: `${schemeOf(base)} · ${hostOf(base)} · ${r.models.length} models`, models: r.models };
    },

    /** The models this endpoint serves, so a UI can offer a list instead of a text field. */
    async models(cfg, env, { fetch: fetchImpl = globalThis.fetch, timeoutMs = 20000, signal } = {}) {
      const base = adapter.baseUrl(cfg);
      if (!base) return { ok: false, error: 'no endpoint configured', models: [] };
      const key = keyOf(env);
      if (!key && !meta.keyOptional) return { ok: false, error: 'no API key configured', models: [] };
      let res;
      try {
        res = await reach(spec, base, spec.modelsPath, url => call(fetchImpl, url, { method: 'GET', headers: { ...extraHeadersFor(id, cfg), ...spec.headers(key) } }, timeoutMs, signal));
      } catch (e) {
        return { ok: false, error: e.name === 'AbortError' ? 'timed out' : `could not reach ${hostOf(base)}: ${trim(e.message, 120)}`, models: [] };
      }
      const { data, text } = await readJson(res);
      if (!res.ok) return { ok: false, error: `${res.status} ${shownError(spec, data)}`, models: [] };
      let models;
      try { models = spec.readModels(data); } catch { models = null; }
      if (!Array.isArray(models)) return { ok: false, error: 'unexpected model list shape', models: [] };
      return { ok: true, models: models.filter(m => typeof m === 'string' && m).sort() };
    },

    /**
     * One question, one answer. `env` carries the key under the provider's declared variable
     * and nothing else is read from it; `fetch` is injectable so the phone can route through
     * native HTTP and a test can hand in a fake.
     */
    async invoke(opts = {}) {
      const { cfg, prompt, system, schema, env, model, timeoutMs = DEFAULT_TIMEOUT_MS, maxTokens = MAX_OUTPUT_TOKENS, fetch: fetchImpl = globalThis.fetch, signal } = opts;
      const base = adapter.baseUrl(cfg);
      if (!base) return { code: -1, text: '', stderr: `no endpoint configured for ${id}`, spawnError: true };
      const key = keyOf(env);
      if (!key && !meta.keyOptional) return { code: -1, text: '', stderr: `no API key configured for ${id}`, spawnError: true };
      const asked = model || meta.defaultModel;
      if (!asked) return { code: 1, text: '', stderr: `no model chosen for ${id} (pick one from the list the endpoint serves)` };
      let chosen = substitutes.get(substituteKey(id, base, asked)) || asked;

      let body = spec.body({ model: chosen, prompt, system: system || null, schema: schema || null, maxTokens });
      let triedOtherModel = false;
      let retriedWithStrictSchema = false;
      let retriedWithoutJsonMode = false;
      let transientRetries = 0;
      for (;;) {
        let res;
        try {
          res = await reach(spec, base, spec.path(chosen), url => call(fetchImpl, url, {
            method: 'POST',
            headers: { ...extraHeadersFor(id, cfg), 'content-type': 'application/json', ...spec.headers(key) },
            body: JSON.stringify(body)
          }, timeoutMs, signal));
        } catch (e) {
          if (e.name === 'AbortError') return { code: -1, text: '', stderr: 'timed out', timedOut: true };
          return { code: 1, text: '', stderr: `could not reach ${hostOf(base)}: ${trim(e.message, 200)}` };
        }
        const { data, text } = await readJson(res);
        if (!res.ok) {
          const msg = spec.errorMessage(data) || trim(text, 200);
          if (RETRY_STATUSES.has(res.status) && transientRetries < RETRY_DELAYS_MS.length && !(signal && signal.aborted)) {
            await sleep(opts.retryDelayMs != null ? opts.retryDelayMs : RETRY_DELAYS_MS[transientRetries], signal);
            transientRetries++;
            continue;
          }
          // A hosted validator that enforces strict JSON Schema refuses the flat schemas on
          // additionalProperties (OpenRouter, #701). The strict copy is a wire-only change —
          // local grammar-sampling servers keep getting the flat shape they can convert — and
          // only after the endpoint itself said no to it, so Ollama, LM Studio and vLLM never
          // see a request they did not already ask for.
          if (res.status === 400 && spec.withStrictSchema && !retriedWithStrictSchema
            && body.response_format && body.response_format.type === 'json_schema'
            && /additionalProperties|must be explicitly set/i.test(msg)) {
            body = spec.withStrictSchema(body);
            retriedWithStrictSchema = true;
            continue;
          }
          // Some OpenAI-compatible servers reject the JSON-mode flag outright, and some providers
          // reject a schema they cannot serve (Gemini: "the specified schema produces a constraint
          // that has too many states"). Once, without it: the validator still judges the answer.
          if (res.status === 400 && spec.withoutJsonMode && !retriedWithoutJsonMode && /response_format|json_schema|json_object|json mode|structured|\bschema\b/i.test(msg)) {
            body = spec.withoutJsonMode(body);
            retriedWithoutJsonMode = true;
            continue;
          }
          // The model is gone for this key: once, with one it can use. The provider's own
          // default when the key serves it (or the list could not be read), else the first text
          // model the key lists. Only then is it the job's failure, naming the model.
          if (isModelGone(res.status, msg) && !triedOtherModel && !(signal && signal.aborted)) {
            triedOtherModel = true;
            const next = await usableModel(chosen, { cfg, env, fetchImpl, signal });
            if (next) {
              substitutes.set(substituteKey(id, base, asked), next);
              chosen = next;
              if ('model' in body) body = { ...body, model: next };
              transientRetries = 0;
              continue;
            }
          }
          if (isModelGone(res.status, msg)) {
            substitutes.delete(substituteKey(id, base, asked));
            const tried = chosen !== asked ? ` (and neither is "${chosen}")` : '';
            return { code: 1, text: '', stderr: `${res.status} the model "${asked}" is not available to this key${tried}: ${shownError(spec, data, 200)}. Pick another one in the Coach settings.` };
          }
          return { code: 1, text: '', stderr: `${res.status} ${shownError(spec, data, 280)}` };
        }
        let out;
        try { out = spec.readText(data); } catch (e) { out = { error: `unexpected response shape: ${trim(e.message, 100)}` }; }
        if (out.error) return { code: 1, text: '', stderr: out.error };
        if (out.truncated) return { code: 1, text: '', stderr: 'the answer was cut off at the output limit; try a smaller plan or a bigger model' };
        return { code: 0, text: String(out.text || '').trim(), stderr: '', ...(chosen !== asked ? { model: chosen } : {}) };
      }
    }
  };
  return adapter;
}
