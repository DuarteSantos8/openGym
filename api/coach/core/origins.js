/* The two origins, resolved once.
 *
 * OrcaRouter serves authentication from `www.orcarouter.ai` and inference from
 * `api.orcarouter.ai`. They are different hosts on purpose and neither is derived from the other:
 * `https://api.orcarouter.ai/v1/auth/keys` is a 404, and a hostname substitution or a blind
 * `+ '/v1'` is exactly how a client ends up there. So there are two functions, each with its own
 * default, and no code anywhere builds one from the other.
 *
 * Precedence, highest first:
 *   ORCA_AUTH_BASE_URL / ORCA_API_BASE_URL   explicit, per-origin
 *   ORCA_BASE_URL                            one origin for a self-hosted deployment serving both
 *   the public defaults below
 *
 * A self-hosted deployment that puts both behind one address sets ORCA_BASE_URL alone; one that
 * splits them (auth on an identity host, relay elsewhere) sets the two explicit values, which win
 * over the shared one. Reading happens per call rather than at import, so a test can point the
 * whole flow at a local fake server without reloading the module.
 *
 * Transport: HTTPS everywhere except loopback. A plain-HTTP origin is accepted for
 * `localhost`/`127.0.0.1`/`[::1]` because that is how a developer runs a fake auth server, and
 * refused for anything else because a credential exchange over cleartext to a remote host is the
 * thing this check exists to stop. */

export const DEFAULT_AUTH_BASE = 'https://www.orcarouter.ai';
export const DEFAULT_API_BASE = 'https://api.orcarouter.ai';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
export const isLoopback = host => LOOPBACK.has(String(host || '').toLowerCase());

const trimSlashes = s => String(s || '').replace(/\/+$/, '');

/**
 * Normalize one configured origin. Returns null for anything unusable rather than throwing:
 * a bad override should fall back to the default, not take the Coach down at boot.
 */
export function normalizeOrigin(raw, { fallback }) {
  const s = trimSlashes(raw).trim();
  if (!s) return fallback;
  let u;
  try { u = new URL(s); } catch { return fallback; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return fallback;
  if (u.protocol === 'http:' && !isLoopback(u.hostname)) return fallback;
  if (u.username || u.password) return fallback;
  // An origin, not a path: /v1 belongs to the inference URL the caller appends, and an auth base
  // with a path on it would silently produce /auth under the wrong prefix.
  return u.origin;
}

// `process` is absent in the browser, where this module is bundled for the phone's setup screen;
// the phone never reads an override, it just needs the public defaults to render a label.
const env = (name, source) => (source
  ? source[name]
  : (typeof process !== 'undefined' && process.env ? process.env[name] : undefined));

/**
 * Where the browser is sent to authorize, and where the code is exchanged.
 * `source` is an env-shaped object for tests; production passes nothing.
 */
export function authBase(source = null) {
  const explicit = env('ORCA_AUTH_BASE_URL', source);
  if (trimSlashes(explicit)) return normalizeOrigin(explicit, { fallback: DEFAULT_AUTH_BASE });
  return normalizeOrigin(env('ORCA_BASE_URL', source), { fallback: DEFAULT_AUTH_BASE });
}

/** Where inference and model discovery happen. Its own default, its own override — see above. */
export function apiBase(source = null) {
  const explicit = env('ORCA_API_BASE_URL', source);
  if (trimSlashes(explicit)) return normalizeOrigin(explicit, { fallback: DEFAULT_API_BASE });
  return normalizeOrigin(env('ORCA_BASE_URL', source), { fallback: DEFAULT_API_BASE });
}

/** The inference root every request path hangs off: `<apiBase>/v1`. */
export const apiV1 = (source = null) => apiBase(source) + '/v1';

/** True when the operator pointed this at something other than the public service. */
export function isSelfHosted(source = null) {
  return authBase(source) !== DEFAULT_AUTH_BASE || apiBase(source) !== DEFAULT_API_BASE;
}
