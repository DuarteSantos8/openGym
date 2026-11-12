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

const WRONG_PATH = new Set([404, 405]);
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
  // Open WebUI's frontend answers an unknown path with 405 rather than 404 (#1035).
  if (!WRONG_PATH.has(first.status) || urls.length < 2) return first;
  const second = await send(urls[1]);
  // Only a second 404 says the other spelling is wrong too. A 429 or a 5xx from it is that
  // endpoint answering, and the caller's retries have to see it (#520): handing back the first
  // 404 ended the call as "not found" instead.
  if (WRONG_PATH.has(second.status)) { try { await second.text(); } catch { /* drained or gone */ } return first; }
  if (!second.ok) { try { await first.text(); } catch { /* drained or gone */ } return second; }
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

/* The compatibility ladder (#804). An OpenAI-compatible endpoint is any gateway at all, and
 * several (one-api/new-api resellers, Azure fronts, some LiteLLM setups) refuse a request with
 * one generic 400, "please check the request parameters", that names nothing. Each rung is one
 * change to the request a server that refuses it is known to want, in the order that gives up
 * least: close the schema (#701), drop the schema for plain JSON mode, swap the output-limit
 * field (reasoning models want max_completion_tokens, older servers only know max_tokens), drop
 * temperature (reasoning models take only their default), and last ask for JSON in the prompt
 * alone. A 400 that names the parameter goes to its rung directly; a generic one takes the next
 * rung that changes anything, and only on a spec that opts in (`compatLadder`), since OpenAI and
 * the other hosted APIs always say what is wrong. The rungs that worked are remembered per
 * provider, endpoint and model, here for the server and in the device file on the phone. */
export const COMPAT_STEPS = Object.freeze(['strict', 'json_object', 'tokens', 'temperature', 'plain']);
const compatProfiles = new Map();
const compatKey = (id, base, model) => `${id} ${base} ${model}`;
const cleanSteps = steps => (Array.isArray(steps) ? COMPAT_STEPS.filter(s => steps.includes(s)) : []);
/** The rungs an endpoint and model needed last time, or null. */
export const compatProfile = (id, cfg, model) => compatProfiles.get(compatKey(id, baseUrlFor(id, cfg), model)) || null;
/** Seed (or clear, with an empty list) what an endpoint needs, e.g. from the phone's device file. */
export function rememberCompatProfile(id, cfg, model, steps) {
  const key = compatKey(id, baseUrlFor(id, cfg), model);
  const clean = cleanSteps(steps);
  if (clean.length) compatProfiles.set(key, clean); else compatProfiles.delete(key);
}
// What a 400 says about the request, matched on the provider's words. Order matters: a schema
// complaint usually also says "response_format".
function namedRungs(msg) {
  if (/additionalProperties|must be explicitly set/i.test(msg)) return ['strict', 'json_object', 'plain'];
  if (/max_(?:completion_)?tokens/i.test(msg)) return ['tokens'];
  if (/temperature/i.test(msg)) return ['temperature'];
  // MiniMax refuses a union type in the schema with "invalid params, Mismatch type string with
  // value array" and never says "schema" (#928).
  if (/response_format|json_schema|json_object|json mode|structured|\bschema\b|mismatch(?:ed)? type/i.test(msg)) return ['json_object', 'plain'];
  return null;
}
const applySteps = (spec, base, steps) => steps.reduce((b, s) => spec.compat[s](b), base);

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

/* The status an answer failed with, or 0 when it is an answer. Usually that is the HTTP status,
 * but a gateway that holds a slow request open (OpenRouter keeps a non-streamed call alive with
 * whitespace) has already sent "200 OK" by the time the model behind it refuses, so the refusal
 * arrives as a 200 whose body is { error: { message, code } } and has no answer in it (#973).
 * That is read as the error it is, with the code it names (502 when it names none), so the
 * fallbacks below (the schema rungs above all) run instead of "the answer had no choices". */
export function embeddedErrorStatus(res, data) {
  if (!res.ok) return res.status;
  if (!data || typeof data !== 'object' || !data.error || data.choices || data.candidates || data.content) return 0;
  const code = Number(data.error.code ?? data.error.status);
  return Number.isInteger(code) && code >= 400 && code < 600 ? code : 502;
}

async function readJson(res) {
  const text = await res.text();
  try { return { data: JSON.parse(text), text }; } catch { return { data: null, text }; }
}

/* Streaming (#1035, after #546). A thinking model can sit silent for minutes before its first
 * word, and on mobile data a carrier NAT, a CDN's idle limit or a locked phone drops a connection
 * that carries no bytes long before the provider is done. A stream keeps bytes flowing, so every
 * spec that knows how to stream (`spec.stream`) asks for one. The answer is still folded back into
 * the one-shot shape readText reads, so parser, validator and repair round see nothing new.
 *
 * Endpoints that refuse `stream` (a strict gateway, #804) are asked once more without it and
 * remembered here, per provider, endpoint and model, so the next job goes straight there. */
const noStream = new Set();
/** Test seam: forget which endpoints refused to stream. */
export const _forgetStreamRefusals = () => noStream.clear();
export const looksLikeSse = text => /^\s*(?:data|event|id|retry|:)/.test(text);

/** The events of a text/event-stream body: `{ event, data }` with `data` parsed as JSON. A
 *  `[DONE]` sentinel and lines that do not parse are skipped. Tolerates servers that put one
 *  JSON object per `data:` line without the blank line between events. */
export function sseEvents(text) {
  const out = [];
  let event = null, data = [];
  const push = raw => { if (!raw || raw === '[DONE]') return true; try { out.push({ event, data: JSON.parse(raw) }); return true; } catch { return false; } };
  const flush = () => {
    if (data.length && !push(data.join('\n'))) data.forEach(push);
    event = null; data = [];
  };
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line === '') { flush(); continue; }
    if (line.startsWith(':')) continue;
    const i = line.indexOf(':');
    const field = i < 0 ? line : line.slice(0, i);
    let v = i < 0 ? '' : line.slice(i + 1);
    if (v.startsWith(' ')) v = v.slice(1);
    if (field === 'event') { if (data.length) flush(); event = v; }
    else if (field === 'data') data.push(v);
  }
  flush();
  return out;
}

/* The body as text, read chunk by chunk where the runtime offers a reader (node, browsers) so the
 * caller can tell "nothing came" from "it stopped halfway". The phones' native fetch has only
 * text(); there the bytes still flow and keep the connection alive, they just arrive at once. */
async function bodyText(res, progress) {
  const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
  if (!reader) { const t = await res.text(); progress.chars = t.length; return t; }
  const dec = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
    progress.chars = text.length;
    progress.partial = text;
  }
  return text + dec.decode();
}

/* A streamed answer, folded by the spec into the shape of its one-shot answer. A server that
 * ignored `stream` answers plain JSON, read as before. An error event after the 200 comes back
 * as { error }, which embeddedErrorStatus treats like any embedded error. */
async function readStreamed(res, spec, progress) {
  const text = await bodyText(res, progress);
  if (!looksLikeSse(text)) {
    try { return { data: JSON.parse(text), text }; } catch { return { data: null, text }; }
  }
  const events = sseEvents(text);
  const bad = events.find(e => e.data && e.data.error);
  if (bad) return { data: { error: bad.data.error }, text };
  return { data: spec.stream.fold(events), text };
}

/** How much answer text a partial stream had carried, for the "cut off after N characters" line. */
function answerCharsOf(spec, partial) {
  try { const d = spec.stream.fold(sseEvents(partial || '')); const out = d && spec.readText(d); return out && out.text ? out.text.length : 0; } catch { return 0; }
}
// Longer than this without any answer, and a transport error is the connection giving up while
// the model was thinking, not an endpoint that was never there.
const WAITED_MS = 20000;

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
      // A web app's HTML under the API path (Open WebUI serves its SPA at /v1/models, #1035).
      if (!Array.isArray(models) && /^\s*</.test(text || '')) return { ok: false, error: 'the endpoint answered with a web page, not a model list: check the base URL (Open WebUI\'s API is under /api)', models: [] };
      if (!Array.isArray(models)) return { ok: false, error: 'unexpected model list shape', models: [] };
      let prices = null;
      if (spec.readPrices) { try { prices = spec.readPrices(data); } catch { prices = null; } }
      return { ok: true, models: models.filter(m => typeof m === 'string' && m).sort(), ...(prices ? { prices } : {}) };
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

      const streamKey = () => `${id} ${base} ${chosen}`;
      let useStream = !!spec.stream && opts.stream !== false && !noStream.has(streamKey());
      const build = () => {
        const b = spec.body({ model: chosen, prompt, system: system || null, schema: schema || null, maxTokens, base, ...(opts.web ? { web: true } : {}) });
        return useStream ? spec.stream.body(b) : b;
      };
      // Drops the stream for this endpoint and model, remembered; true when that changed anything.
      const stopStreaming = () => {
        if (!useStream || (signal && signal.aborted)) return false;
        useStream = false;
        noStream.add(streamKey());
        body = spec.compat ? applySteps(spec, build(), steps) : build();
        return true;
      };
      let steps = spec.compat ? (compatProfiles.get(compatKey(id, base, chosen)) || []) : [];
      let body = spec.compat ? applySteps(spec, build(), steps) : build();
      let triedOtherModel = false;
      let transientRetries = 0;
      let firstRefusal = null;
      // Every request shape sent in this call, so no rung ever asks the same thing twice.
      const sent = new Set();
      // The next rung out of `rungs` that changes the request at all, or null. A 400 that names a
      // token field already swapped (`undo`) swaps it back: a remembered "tokens" step that the
      // first guess of the field (#869) has made the wrong way round.
      const nextRung = (rungs, undo = false) => {
        if (!spec.compat) return null;
        const now = JSON.stringify(body);
        for (const r of rungs) {
          if (steps.includes(r) && !(undo && r === 'tokens')) continue;
          const next = steps.includes(r) ? steps.filter(x => x !== r) : cleanSteps([...steps, r]);
          const tried = applySteps(spec, build(), next);
          const key = JSON.stringify(tried);
          if (key !== now && !sent.has(key)) return { steps: next, body: tried };
        }
        return null;
      };
      for (;;) {
        sent.add(JSON.stringify(body));
        let res;
        const sentAt = Date.now();
        const streaming = useStream;
        try {
          res = await reach(spec, base, streaming && spec.stream.path ? spec.stream.path(chosen) : spec.path(chosen), url => call(fetchImpl, url, {
            method: 'POST',
            headers: { ...extraHeadersFor(id, cfg), 'content-type': 'application/json', ...(streaming ? { accept: 'text/event-stream' } : {}), ...spec.headers(key) },
            body: JSON.stringify(body)
          }, timeoutMs, signal));
        } catch (e) {
          if (e.name === 'AbortError') return { code: -1, text: '', stderr: 'timed out', timedOut: true };
          const waited = Math.round((Date.now() - sentAt) / 1000);
          if (Date.now() - sentAt >= WAITED_MS) return { code: 1, text: '', stderr: `the connection to ${hostOf(base)} dropped while waiting for the answer (after ${waited} s): ${trim(e.message, 200)}` };
          return { code: 1, text: '', stderr: `could not reach ${hostOf(base)}: ${trim(e.message, 200)}` };
        }
        let read;
        const progress = { chars: 0, partial: '' };
        try { read = await (streaming && res.ok ? readStreamed(res, spec, progress) : readJson(res)); }
        catch (e) {
          if (e.name === 'AbortError') return { code: -1, text: '', stderr: 'timed out', timedOut: true };
          const got = streaming ? answerCharsOf(spec, progress.partial) : 0;
          if (got > 0) return { code: 1, text: '', stderr: `the connection to ${hostOf(base)} dropped after ${got} characters of the answer: ${trim(e.message, 200)}` };
          return { code: 1, text: '', stderr: `the connection to ${hostOf(base)} dropped mid-answer: ${trim(e.message, 200)}` };
        }
        const { data, text } = read;
        const status = embeddedErrorStatus(res, data);
        if (status) {
          const msg = spec.errorMessage(data) || trim(text, 200);
          // An endpoint that will not stream after all: back to one answer, and remembered. A
          // strict gateway that refuses with a 400 naming nothing (#804) loses the stream first,
          // before any rung of the ladder changes the request itself.
          if (status === 400 && useStream && (/\bstream/i.test(msg) || (spec.compatLadder && !namedRungs(msg) && !isModelGone(status, msg))) && stopStreaming()) continue;
          if (RETRY_STATUSES.has(status) && transientRetries < RETRY_DELAYS_MS.length && !(signal && signal.aborted)) {
            await sleep(opts.retryDelayMs != null ? opts.retryDelayMs : RETRY_DELAYS_MS[transientRetries], signal);
            transientRetries++;
            continue;
          }
          // A 400 that names what it refuses (OpenRouter's strict-schema validator, #701; a server
          // without JSON mode; a reasoning model's output-limit field or temperature) goes to the
          // rung for it. A rung that changes nothing (a complaint about a temperature this request
          // never sent) is no retry: asking again would be asking the same wrong thing.
          const named = status === 400 ? namedRungs(msg) : null;
          let rung = named ? nextRung(named, true) : null;
          // A 400 that names nothing walks the ladder, on an endpoint that opted in (#804).
          if (!rung && status === 400 && !named && spec.compatLadder && !isModelGone(status, msg)) rung = nextRung(COMPAT_STEPS);
          if (rung && !(signal && signal.aborted)) {
            if (!firstRefusal) firstRefusal = `${status} ${shownError(spec, data, 280)}`;
            steps = rung.steps;
            body = rung.body;
            transientRetries = 0;
            continue;
          }
          // The model is gone for this key: once, with one it can use. The provider's own
          // default when the key serves it (or the list could not be read), else the first text
          // model the key lists. Only then is it the job's failure, naming the model.
          if (isModelGone(status, msg) && !triedOtherModel && !(signal && signal.aborted)) {
            triedOtherModel = true;
            const next = await usableModel(chosen, { cfg, env, fetchImpl, signal });
            if (next) {
              substitutes.set(substituteKey(id, base, asked), next);
              chosen = next;
              if ('model' in body) body = { ...body, model: next };
              // What the refused model needed says nothing about this one.
              if (spec.compat) { steps = compatProfiles.get(compatKey(id, base, next)) || []; body = applySteps(spec, build(), steps); }
              transientRetries = 0;
              continue;
            }
          }
          if (isModelGone(status, msg)) {
            substitutes.delete(substituteKey(id, base, asked));
            const tried = chosen !== asked ? ` (and neither is "${chosen}")` : '';
            return { code: 1, text: '', stderr: `${status} the model "${asked}" is not available to this key${tried}: ${shownError(spec, data, 200)}. Pick another one in the Coach settings.` };
          }
          // Every rung refused too: the gateway's own first words are the ones worth reading, and
          // what was learnt for this endpoint is dropped rather than kept half-right.
          if (spec.compat && firstRefusal) {
            compatProfiles.delete(compatKey(id, base, chosen));
            const last = `${status} ${shownError(spec, data, 200)}`;
            return { code: 1, text: '', stderr: last === firstRefusal ? `${firstRefusal} (also tried ${steps.length} compatibility fallbacks)` : `${firstRefusal} (fallbacks tried: ${steps.join(', ')}; last answer: ${last})`.slice(0, 600) };
          }
          return { code: 1, text: '', stderr: `${status} ${shownError(spec, data, 280)}` };
        }
        let out;
        try { out = spec.readText(data); } catch (e) { out = { error: `unexpected response shape: ${trim(e.message, 100)}` }; }
        if (out.error) return { code: 1, text: '', stderr: out.error };
        if (out.truncated) return { code: 1, text: '', stderr: 'the answer was cut off at the output limit; try a smaller plan or a bigger model' };
        if (spec.compat) rememberCompatProfile(id, cfg, chosen, steps);
        return { code: 0, text: String(out.text || '').trim(), stderr: '', ...(chosen !== asked ? { model: chosen } : {}), ...(Array.isArray(out.sources) && out.sources.length ? { sources: out.sources } : {}) };
      }
    }
  };
  return adapter;
}
