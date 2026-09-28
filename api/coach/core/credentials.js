/* Two ways to get an OrcaRouter credential, one result.
 *
 * The whole point of this module is that nothing downstream can tell which one ran. An API key
 * pasted from the console and an API key minted by a browser authorization are the same object
 * with the same lifetime — a normal `sk-orca-…` key, billed to the user's account — so the
 * transport, the model catalog, the job environment and every AI entry point read one field and
 * never ask where it came from. If a caller ever needs to know, the answer is in `via`, and the
 * only caller that reads it is the admin card, to say which choice is connected.
 *
 * What is deliberately NOT here: any notion of refreshing. OrcaRouter returns a durable key, not
 * an access/refresh pair, and there is no refresh endpoint to call. `refresh` is absent rather
 * than a stub, so there is nothing for a future caller to mistake for a working grant.
 *
 * Origins live in ./origins.js and are never derived from one another. */

import { authBase, apiBase } from './origins.js';

export const KEY_PREFIX = 'sk-orca-';

/**
 * The credential shape every adapter returns — identical fields whichever adapter filled it, so
 * a caller can compare two results without knowing which path produced them.
 *   { ok:true, token, type:'apikey', account, scope, via:'api-key'|'pkce' }
 *   { ok:false, reason, message }
 * `reason` is a stable machine value; `message` is what a person reads.
 */
export const credentialResult = ({ token, account = null, scope = DEFAULT_SCOPE, via }) => ({
  ok: true, token, type: 'apikey', account: account || null, scope, via
});

/* Bounded, and honest about what a prefix is worth. `sk-orca-` catches a pasted OpenAI, Anthropic
 * or OpenRouter key before it is stored and silently sent to the wrong host; it is not evidence
 * the key works, and nothing here claims to have verified one. The first real request establishes
 * that, which is why no paid probe is made to make a settings form say "valid". */
export const KEY_MIN_LENGTH = KEY_PREFIX.length + 8;
export function validateKeyShape(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return { ok: false, reason: 'empty', message: 'Enter an OrcaRouter API key.' };
  if (!s.startsWith(KEY_PREFIX)) return { ok: false, reason: 'prefix', message: `An OrcaRouter key starts with ${KEY_PREFIX}` };
  if (s.length < KEY_MIN_LENGTH) return { ok: false, reason: 'short', message: 'That key looks truncated.' };
  if (/\s/.test(s)) return { ok: false, reason: 'whitespace', message: 'A key has no spaces in it.' };
  return { ok: true, value: s };
}

/** Never let a credential reach a log, an error body or a snapshot. */
export function redact(text, secret) {
  let out = String(text == null ? '' : text);
  if (secret) out = out.split(String(secret)).join('[redacted]');
  // Catch a key that arrived from somewhere other than the argument (a provider echoing it back).
  return out.replace(/sk-orca-[A-Za-z0-9_\-]{4,}/g, '[redacted]');
}

/* ------------------------------- adapter: API key ------------------------------- */

/**
 * The existing-key path. Takes what the admin typed, checks nothing but its shape, and hands back
 * the same result object the PKCE path produces. Storage is not this adapter's job — routes.js
 * already owns the encrypted store and would have to be duplicated to move it here.
 */
export const apiKeyAdapter = Object.freeze({
  id: 'api-key',
  via: 'api-key',
  label: 'API key',
  acquire({ token } = {}) {
    const v = validateKeyShape(token);
    if (!v.ok) return { ok: false, reason: v.reason, message: v.message };
    return credentialResult({ token: v.value, via: 'api-key' });
  }
});

/* --------------------------- adapter: OAuth 2.0 + PKCE --------------------------- */

export const PKCE_METHOD = 'S256';
export const APP_NAME = 'openGym';
export const DEFAULT_SCOPE = 'api';
export const AUTHORIZE_PATH = '/auth';
// Authentication is served from the auth origin. `/v1/auth/keys` on the *inference* origin is a
// 404 — the single most common way this integration is got wrong — so the path is spelled out
// here once and never built by appending to a base that might be the wrong one.
export const EXCHANGE_PATH = '/api/v1/auth/keys';

/**
 * The PKCE adapter's *client* half: everything about an attempt that is not HTTP.
 *
 * The server holds the verifier between `start` and `complete`; the browser only ever sees the
 * challenge and the state. `buildAuthorizeUrl` is pure so a test can assert the exact query a
 * user's browser would be sent to, and so the admin card can show the URL as a copyable fallback
 * when the browser does not open by itself.
 */
export const pkceAdapter = Object.freeze({
  id: 'pkce',
  via: 'pkce',
  label: 'OrcaRouter account',
  method: PKCE_METHOD,

  /**
   * Start an attempt and build the URL the admin opens. The registry owns the attempt — verifier
   * included — so there is exactly one verifier in the process and exactly one generation to
   * quote back. `oauth` is ./oauth.js; injected so this module stays free of transport and the
   * pure half stays testable without a server. `registry` defaults to the module singleton and is
   * overridable so a test can drive its own.
   */
  async begin(oauth, { scope = DEFAULT_SCOPE, loginHint = null, registry = null } = {}) {
    const reg = registry || oauth.registry;
    const attempt = reg.start();
    return {
      attempt,
      url: buildAuthorizeUrl(attempt, { scope, loginHint }),
      scope,
      generation: reg.generation(),
      expiresAt: attempt.expiresAt
    };
  },

  /** Exchange the displayed code. Flow B fixes S256, so the method is not a parameter. */
  async complete(oauth, attempt, code, opts = {}) {
    const r = await oauth.exchange({ attempt, code, ...opts });
    if (!r.ok) return r;
    return credentialResult({ token: r.token, account: r.account, scope: r.scope, via: 'pkce' });
  }
});

/**
 * The consent URL. `callback_url=oob` is spelled out rather than omitted — the mode is asked for,
 * not guessed at — and S256 is unconditional: the code is displayed for a human to carry, and a
 * displayed code must be redeemable only by the process holding the verifier.
 */
export function buildAuthorizeUrl(attempt, { scope = DEFAULT_SCOPE, loginHint = null, base = null } = {}) {
  const u = new URL(AUTHORIZE_PATH, base || authBase());
  u.searchParams.set('callback_url', 'oob');
  u.searchParams.set('code_challenge', attempt.challenge);
  u.searchParams.set('code_challenge_method', PKCE_METHOD);
  u.searchParams.set('state', attempt.state);
  u.searchParams.set('app_name', APP_NAME);
  u.searchParams.set('scope', scope);
  if (loginHint) u.searchParams.set('login_hint', String(loginHint).slice(0, 200));
  return u.toString();
}

/** Where a person manages and revokes the keys this app was issued. */
export const consoleUrl = () => new URL('/console/authorized-apps', authBase()).toString();
export const keyDocsUrl = () => new URL('/console', authBase()).toString();

/* ------------------------------- picking one ------------------------------- */

export const ADAPTERS = Object.freeze({ [apiKeyAdapter.id]: apiKeyAdapter, [pkceAdapter.id]: pkceAdapter });

/**
 * One call site, two adapters. Anything that needs a credential from user input goes through
 * here, which is what keeps a third acquisition method from turning into a third code path
 * through the transport.
 */
export function acquire(via, input) {
  const adapter = ADAPTERS[via];
  if (!adapter) return { ok: false, reason: 'unknown-method', message: `Unknown credential method "${via}".` };
  return adapter.acquire(input);
}

export { authBase, apiBase };
