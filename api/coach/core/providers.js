/* The providers that speak plain HTTPS, described once for both runtimes.
 *
 * The server's config.PROVIDERS spreads these rows in next to the runtime-backed providers
 * (Claude Agent SDK, Codex CLI); the phone reads them directly for its own picker. Keeping the
 * facts in one place is what stops the two ever offering different endpoints or defaults.
 *
 * `defaultModel` is a starting point, not a pin. Every one of these providers lists its models
 * over the same API, and the UI offers that list — a name typed here goes stale, a list does
 * not. `compatible` has no default at all: an OpenAI-compatible endpoint is whatever the owner
 * pointed it at, so the model has to come from what that endpoint actually serves.
 */
import { apiBase } from './origins.js';

export const HTTP_PROVIDERS = Object.freeze({
  anthropic: Object.freeze({
    label: 'Anthropic API', runtime: 'HTTPS', http: true,
    apiKeyEnv: 'ANTHROPIC_API_KEY', oauthEnv: null,
    defaultBase: 'https://api.anthropic.com',
    defaultModel: 'claude-opus-5',
    keyPlaceholder: 'sk-ant-…'
  }),
  openai: Object.freeze({
    label: 'OpenAI API', runtime: 'HTTPS', http: true,
    apiKeyEnv: 'OPENAI_API_KEY', oauthEnv: null,
    defaultBase: 'https://api.openai.com',
    defaultModel: 'gpt-5.6',
    keyPlaceholder: 'sk-…'
  }),
  gemini: Object.freeze({
    label: 'Google Gemini', runtime: 'HTTPS', http: true,
    apiKeyEnv: 'GEMINI_API_KEY', oauthEnv: null,
    defaultBase: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.5-pro',
    keyPlaceholder: 'AIza… or AQ.…'
  }),
  // OrcaRouter — an OpenAI-compatible gateway in front of many vendors' models. First-class
  // rather than a `compatible` entry with a pasted base URL, because it is a named service with
  // a fixed endpoint, its own console, and a credential flow of its own; the base URL stays
  // movable for a self-hosted gateway but is not something an owner retypes.
  //
  // `connect: 'pkce'` is what makes the admin card offer "Connect with OrcaRouter" beside the
  // API-key field. Both end at the same key, and nothing downstream reads this flag — it selects
  // an acquisition adapter, not a different provider.
  orcarouter: Object.freeze({
    label: 'OrcaRouter', runtime: 'HTTPS', http: true,
    apiKeyEnv: 'ORCAROUTER_API_KEY', oauthEnv: null,
    // The origin, not `<origin>/v1`: every path in openai.js's spec already carries its own
    // `/v1` (`/v1/chat/completions`, `/v1/models`), exactly as it does for OpenAI — which is why
    // openai's own default is the bare host. The requests still land on
    // `https://api.orcarouter.ai/v1/...`; putting the `/v1` in both places would ask for
    // `/v1/v1/models`.
    defaultBase: null, resolveBase: () => apiBase(),
    defaultModel: 'orcarouter/auto',
    keyPlaceholder: 'sk-orca-…',
    keyPrefix: 'sk-orca-',
    connect: 'pkce',
    // The official classic mark, served from this app's own /public rather than hot-linked: a
    // self-hosted instance should not make its admin page call the vendor's server, and the
    // asset is the one published at https://www.orcarouter.ai/orca-logo-classic.png.
    // The rest of the icon set is the in-repo stroke SVG; this is a brand mark, and the design
    // system's policy is that a brand mark is not redrawn by hand.
    logo: '/orcarouter-logo.png',
    // The catalog is filtered by capability before a picker sees it (core/catalog.js). Without
    // this the list would be an aggregator's whole inventory — embeddings, image, video and
    // rerank entries included — none of which this request shape can call.
    catalog: { capability: 'chat' }
  }),
  // Ollama, LM Studio, vLLM, a corporate gateway: anything that serves the
  // Chat Completions shape. The base URL is the whole configuration; a key is optional
  // because a model on your own LAN usually has none.
  compatible: Object.freeze({
    label: 'OpenAI-compatible endpoint', runtime: 'HTTPS', http: true,
    apiKeyEnv: 'OPENAI_COMPAT_API_KEY', oauthEnv: null,
    defaultBase: null, baseUrl: true, keyOptional: true,
    defaultModel: null,
    keyPlaceholder: '(optional)'
  })
});

export const HTTP_PROVIDER_IDS = Object.freeze(Object.keys(HTTP_PROVIDERS));

/**
 * The base URL a provider will actually be called at. Precedence: the configured override, then
 * a provider's own resolver, then the default a fixed-endpoint provider carries.
 *
 * `resolveBase` exists for a provider whose endpoint is real but not a constant in this file:
 * OrcaRouter's is resolved per call so a self-hosted deployment can move it with an env var
 * without this table (which the phone also reads) having to watch the environment.
 */
export function baseUrlFor(id, cfg) {
  const meta = HTTP_PROVIDERS[id];
  const set = cfg && cfg.providerOptions && cfg.providerOptions[id] && cfg.providerOptions[id].baseUrl;
  if (typeof set === 'string' && set.trim()) return set.replace(/\/+$/, '');
  const resolved = typeof meta?.resolveBase === 'function' ? meta.resolveBase() : null;
  const raw = resolved || (meta && meta.defaultBase) || '';
  return String(raw).replace(/\/+$/, '');
}

/**
 * Only http(s), only a parseable URL, and never credentials in it — a base URL is admin
 * configuration, but "admin-configured" and "safe to log" are different properties, and the
 * host is written into the job log so an operator can see where jobs went.
 */
export function validateBaseUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return { ok: true, value: null };
  let u;
  try { u = new URL(s); } catch { return { ok: false, error: 'not a valid URL' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'only http:// and https:// endpoints are supported' };
  if (u.username || u.password) return { ok: false, error: 'put the key in the credential field, not in the URL' };
  if (u.search || u.hash) return { ok: false, error: 'a base URL has no query string' };
  return { ok: true, value: u.toString().replace(/\/+$/, '') };
}
