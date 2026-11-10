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
    // Stable and on the free tier, which is where the Discord setup guide sends people. The
    // 2.5 names are refused for keys made after Google retired them (#758).
    defaultModel: 'gemini-3.8-flash',
    keyPlaceholder: 'AIza… or AQ.…'
  }),
  // Ollama, LM Studio, vLLM, OpenRouter, a corporate gateway: anything that serves the
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

/** The base URL a provider will actually be called at: the configured override, else the default. */
export function baseUrlFor(id, cfg) {
  const meta = HTTP_PROVIDERS[id];
  const set = cfg && cfg.providerOptions && cfg.providerOptions[id] && cfg.providerOptions[id].baseUrl;
  const raw = (typeof set === 'string' && set.trim()) || (meta && meta.defaultBase) || '';
  return raw.replace(/\/+$/, '');
}

/* Extra static headers a provider is called with (compatible endpoints only in practice):
 * gateways that demand routing/session headers (opencode Go's `x-opencode-session`,
 * `X-Title` style attribution headers elsewhere). Stored plaintext next to baseUrl —
 * routing aids, not credentials. Caps keep a mis-paste from becoming a smuggling vector:
 * at most 8 entries, token-shaped names, short values, and the names that would
 * override auth framing or transport are refused outright (re-checked at send time). */
export const MAX_HEADERS = 8;
export const MAX_HEADER_VALUE = 500;
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9a-z]+$/i;
const RESERVED_HEADERS = new Set([
  'authorization', 'proxy-authorization', 'content-type', 'content-length',
  'host', 'connection', 'transfer-encoding', 'upgrade', 'cookie', 'set-cookie'
]);
export const isReservedHeader = name => RESERVED_HEADERS.has(String(name || '').toLowerCase());

export function validateHeaders(raw) {
  if (raw == null || raw === '') return { ok: true, value: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'headers must be an object of name to value' };
  const names = Object.keys(raw);
  if (names.length > MAX_HEADERS) return { ok: false, error: `at most ${MAX_HEADERS} headers` };
  const out = {};
  for (const name of names) {
    const n = String(name).toLowerCase();
    if (!HEADER_NAME.test(name) || name.length > 64) return { ok: false, error: `bad header name: ${name}` };
    if (isReservedHeader(n)) return { ok: false, error: `header is reserved: ${name}` };
    const v = raw[name];
    if (typeof v !== 'string' || !v.trim()) return { ok: false, error: `header ${name} needs a value` };
    if (v.length > MAX_HEADER_VALUE) return { ok: false, error: `header ${name} is too long` };
    out[n] = v.trim();
  }
  return { ok: true, value: Object.keys(out).length ? out : null };
}

/** The extra headers a provider call carries: the configured map minus anything reserved
 *  (validated at write; this is the belt to that suspenders — a stored map from before a
 *  name was reserved must not override auth framing). */
export function extraHeadersFor(id, cfg) {
  const set = cfg && cfg.providerOptions && cfg.providerOptions[id] && cfg.providerOptions[id].headers;
  if (!set || typeof set !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(set)) {
    if (!isReservedHeader(k) && typeof v === 'string' && v) out[String(k).toLowerCase()] = v;
  }
  return out;
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
  // Azure OpenAI's portal hands out a full Responses or deployment URL with ?api-version=…;
  // the Coach speaks Chat Completions under Azure's versionless v1 path instead (#869).
  const azure = /(^|\.)(openai\.azure\.com|cognitiveservices\.azure\.com|services\.ai\.azure\.com)$/i.test(u.hostname);
  const fullPath = /\/(chat\/completions|responses|completions)\/?$/i.test(u.pathname);
  if (azure && (u.search || fullPath || !/\/openai\/v1\/?$/i.test(u.pathname))) return { ok: false, error: `for Azure OpenAI use https://${u.hostname}/openai/v1 as the base URL and the deployment name as the model` };
  if (u.search || u.hash) return { ok: false, error: 'a base URL has no query string' };
  if (fullPath) return { ok: false, error: 'enter the base URL only, without /chat/completions or /responses at the end' };
  return { ok: true, value: u.toString().replace(/\/+$/, '') };
}

/*
 * Plain http:// from the phone (#913). The phone calls the Coach's endpoint itself, and a model on
 * the home network (llama.cpp, Ollama, LM Studio on 192.168.x.x) usually has no certificate a
 * phone would trust: Let's Encrypt cannot issue one for a bare IP. So http:// is allowed there,
 * and only there; anything on the internet stays https://, since the key and the training data
 * ride in the request.
 *
 * Private means what both phone platforms let through in clear: the IPv4 private ranges
 * (10/8, 172.16/12, 192.168/16), loopback, link-local 169.254/16, the 100.64/10 shared range
 * Tailscale hands its devices, IPv6 loopback, unique-local fc00::/7 (the fd… addresses) and
 * link-local fe80::/10, `localhost`, mDNS names under .local and single-label names (a host on
 * the LAN's own DNS). iOS: NSAllowsLocalNetworking in Info.plist, and App Transport Security
 * never applies to IP literals. Android: cleartext is allowed app wide
 * (network_security_config.xml, #428), because Android cannot scope it to address ranges; this
 * check is the guard that keeps http:// to the home network.
 */
const v4 = h => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return null;
  const b = m.slice(1).map(Number);
  return b.every(x => x <= 255) ? b : null;
};
export function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return false;
  const ip = v4(h);
  if (ip) {
    const [a, b] = ip;
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(':')) {
    // IPv6: loopback, unique-local fc00::/7, link-local fe80::/10, and an IPv4 address mapped
    // into IPv6 (::ffff:192.168.1.2, which the URL parser writes as ::ffff:c0a8:102).
    if (h === '::1') return true;
    if (/^f[cd][0-9a-f]{0,2}:/.test(h)) return true;
    if (/^fe[89ab][0-9a-f]?:/.test(h)) return true;
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
    if (mapped) {
      const hi = parseInt(mapped[1], 16), lo = parseInt(mapped[2], 16);
      return isPrivateHost(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return false;
  }
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  // A single label (`ollama`, `nas`) only resolves through the LAN's own DNS. Not an IPv4 address
  // in another spelling: the URL parser has already turned those into dotted quads.
  return /^[a-z0-9-]+$/.test(h) && !/^\d+$/.test(h);
}

/** Whether the phone may call `url` (already validated): https:// anywhere, http:// only on the home network. */
export function phoneMayCall(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return false; }
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && isPrivateHost(u.hostname);
}
