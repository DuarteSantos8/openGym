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
import { HTTP_PROVIDERS, baseUrlFor } from '../providers.js';

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
const trim = (s, n = 300) => String(s == null ? '' : s).slice(0, n);

/** A fetch, bounded by AbortController. Never throws for HTTP status; throws for transport. */
async function call(fetchImpl, url, init, timeoutMs, signal) {
  const ctl = new AbortController();
  const onOuter = () => ctl.abort();
  if (signal) signal.addEventListener('abort', onOuter, { once: true });
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
      if (!keyOf(env) && !meta.keyOptional) return { ok: true, version: `HTTPS · ${hostOf(base)}`, needsKey: true };
      const r = await adapter.models(cfg, env, opts);
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, version: `HTTPS · ${hostOf(base)} · ${r.models.length} models`, models: r.models };
    },

    /** The models this endpoint serves, so a UI can offer a list instead of a text field. */
    async models(cfg, env, { fetch: fetchImpl = globalThis.fetch, timeoutMs = 20000, signal } = {}) {
      const base = adapter.baseUrl(cfg);
      if (!base) return { ok: false, error: 'no endpoint configured', models: [] };
      const key = keyOf(env);
      if (!key && !meta.keyOptional) return { ok: false, error: 'no API key configured', models: [] };
      let res;
      try {
        res = await call(fetchImpl, base + spec.modelsPath, { method: 'GET', headers: spec.headers(key) }, timeoutMs, signal);
      } catch (e) {
        return { ok: false, error: e.name === 'AbortError' ? 'timed out' : `could not reach ${hostOf(base)}: ${trim(e.message, 120)}`, models: [] };
      }
      const { data, text } = await readJson(res);
      if (!res.ok) return { ok: false, error: `${res.status} ${trim(spec.errorMessage(data) || text, 200)}`, models: [] };
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
      const { cfg, prompt, system, schema, env, model, timeoutMs = DEFAULT_TIMEOUT_MS, fetch: fetchImpl = globalThis.fetch, signal } = opts;
      const base = adapter.baseUrl(cfg);
      if (!base) return { code: -1, text: '', stderr: `no endpoint configured for ${id}`, spawnError: true };
      const key = keyOf(env);
      if (!key && !meta.keyOptional) return { code: -1, text: '', stderr: `no API key configured for ${id}`, spawnError: true };
      const chosen = model || meta.defaultModel;
      if (!chosen) return { code: 1, text: '', stderr: `no model chosen for ${id} — pick one from the list the endpoint serves` };

      let body = spec.body({ model: chosen, prompt, system: system || null, schema: schema || null, maxTokens: MAX_OUTPUT_TOKENS });
      let retriedWithoutJsonMode = false;
      let transientRetries = 0;
      for (;;) {
        let res;
        try {
          res = await call(fetchImpl, base + spec.path(chosen), {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...spec.headers(key) },
            body: JSON.stringify(body)
          }, timeoutMs, signal);
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
          // Some OpenAI-compatible servers reject the JSON-mode flag outright. Once, without it.
          if (res.status === 400 && spec.withoutJsonMode && !retriedWithoutJsonMode && /response_format|json_schema|json_object|json mode|structured/i.test(msg)) {
            body = spec.withoutJsonMode(body);
            retriedWithoutJsonMode = true;
            continue;
          }
          return { code: 1, text: '', stderr: `${res.status} ${trim(msg, 280)}` };
        }
        let out;
        try { out = spec.readText(data); } catch (e) { out = { error: `unexpected response shape: ${trim(e.message, 100)}` }; }
        if (out.error) return { code: 1, text: '', stderr: out.error };
        if (out.truncated) return { code: 1, text: '', stderr: 'the answer was cut off at the output limit — try a smaller plan or a bigger model' };
        return { code: 0, text: String(out.text || '').trim(), stderr: '' };
      }
    }
  };
  return adapter;
}
