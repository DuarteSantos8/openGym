/* The OAuth 2.0 + PKCE client half: attempts, the exchange, and the pending-attempt registry.
 *
 * Everything a caller needs to know about an attempt lives in `createAttempt()`'s return value,
 * and the one field that must never leave this process is the verifier. It is created here, kept
 * in the registry (or in memory for a pure test), handed to exactly one function — `exchange` —
 * and never written into the authorize URL, a log line, an error body or the admin card. The
 * browser and the person see the challenge and the state; that is the entire point of PKCE, and
 * it only holds if the verifier genuinely stays put.
 *
 * No client secret, and no pre-registered redirect URI: the flow here is out-of-band, so the code
 * is displayed for the admin to carry back rather than delivered to a listener. S256 is
 * unconditional — a displayed code is handled by a person, read off a screen or pasted into the
 * wrong window, so it must be redeemable only by the process that holds the verifier.
 *
 * Nothing in this file knows what an API key looks like once it has one. It returns a token and
 * a scope and stops; interpreting it is credentials.js's job. */

import crypto from 'node:crypto';
import { authBase } from './origins.js';
import { EXCHANGE_PATH, PKCE_METHOD } from './credentials.js';

/* The code is single-use with a 10 minute TTL at the endpoint. Our own window is slightly
 * shorter, so an attempt is abandoned locally before it can be redeemed into a half-finished
 * login. */
export const ATTEMPT_TTL_MS = 10 * 60 * 1000;
// Bounds. The exchange response is small; anything larger is not one.
export const EXCHANGE_TIMEOUT_MS = 30000;
export const MAX_RESPONSE_BYTES = 8192;

const b64url = buf => buf.toString('base64url');
const now = () => Date.now();

/** `base64url(sha256(verifier))`, no padding — the exact string the authorize URL carries. */
export function challengeFor(verifier) {
  return b64url(crypto.createHash('sha256').update(String(verifier), 'utf8').digest());
}

/**
 * A fresh attempt. Both values come from the crypto RNG on every call — never a timestamp, a
 * username, a counter or a fixed salt — because a verifier anyone can predict is a verifier
 * anyone can present.
 */
export function createAttempt() {
  const verifier = b64url(crypto.randomBytes(32));
  const state = b64url(crypto.randomBytes(16));
  return {
    verifier,
    state,
    challenge: challengeFor(verifier),
    method: PKCE_METHOD,
    createdAt: now(),
    expiresAt: now() + ATTEMPT_TTL_MS
  };
}

/**
 * Constant-time comparison for a value the world can hand back to us. Length is compared first
 * and separately (timingSafeEqual throws on a length mismatch, and the length of a state is not
 * a secret); the bytes are then compared without an early exit.
 */
export function stateMatches(expected, received) {
  const a = Buffer.from(String(expected == null ? '' : expected), 'utf8');
  const b = Buffer.from(String(received == null ? '' : received), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* ------------------------------- error shapes -------------------------------
 * A stable machine `reason` for the caller, and a `message` a person can act on. Everything that
 * is not one of the classifications below ends up as `network`, which is deliberately not a
 * terminal credential verdict — it says "we could not ask", not "your account is bad". */
const FAILURES = {
  denied: 'The request was denied. Nothing was saved.',
  'state-mismatch': 'This authorization did not come from the request this server started. Nothing was saved.',
  expired: 'That code has expired. Start the connection again.',
  'already-used': 'That code has already been used. Start the connection again.',
  'bad-verifier': 'The code did not match this server\'s request. Start the connection again.',
  'method-mismatch': 'The authorization used a weaker challenge method than this server asked for. Nothing was saved.',
  'scope-insufficient': 'The authorization was granted without the access this app needs.',
  'rate-limited': 'OrcaRouter is limiting how many keys can be issued right now. Wait a few minutes and try again.',
  timeout: 'OrcaRouter did not answer in time. Try again.',
  network: 'Could not reach OrcaRouter. Check this server\'s network and try again.',
  cancelled: 'The connection was cancelled.',
  'bad-response': 'OrcaRouter answered with something this app could not read. Nothing was saved.'
};

const fail = (reason, extra = {}) => ({ ok: false, reason, message: FAILURES[reason] || FAILURES.network, ...extra });

/**
 * Map an exchange response onto a reason. The status codes are the endpoint's, documented:
 *   400 — an unrecognised `code_challenge_method`, or one that differs from authorize time
 *         (a downgrade defence, hence its own reason rather than a generic 400)
 *   403 — code unknown, expired or already used, or the verifier does not match
 *   429 — the per-user issuance cap
 * The body is read for a hint but never surfaced verbatim: it is third-party text and could
 * quote the request back.
 */
export function classifyExchange(status, body) {
  if (status === 429) return fail('rate-limited');
  if (status === 400) {
    const t = JSON.stringify(body || {}).toLowerCase();
    if (t.includes('code_challenge_method') || t.includes('downgrade')) return fail('method-mismatch');
    return fail('method-mismatch');
  }
  if (status === 403) {
    const t = JSON.stringify(body || {}).toLowerCase();
    if (t.includes('expired')) return fail('expired');
    if (t.includes('used') || t.includes('redeemed')) return fail('already-used');
    if (t.includes('verifier')) return fail('bad-verifier');
    // Unknown, expired and already-used are indistinguishable in the general case, and saying so
    // is more useful than picking one.
    return fail('already-used');
  }
  return fail('bad-response', { status });
}

/** Read a response body with a hard byte cap, so a hostile answer cannot be buffered whole. */
async function readBounded(res, max = MAX_RESPONSE_BYTES) {
  const text = await res.text();
  if (text.length > max) return { data: null, text: text.slice(0, max), truncated: true };
  try { return { data: JSON.parse(text), text, truncated: false }; } catch { return { data: null, text, truncated: false }; }
}

/**
 * POST the code and verifier to the auth origin and turn the answer into a credential.
 *
 * `fetch` and `base` are injectable so the whole path can be driven against a local fake auth
 * server in a test, and so the phone could hand in its native fetch later.
 */
export async function exchange({
  attempt, code, state = null, scope = 'api',
  fetch: fetchImpl = globalThis.fetch, base = null, timeoutMs = EXCHANGE_TIMEOUT_MS, signal
} = {}) {
  if (!attempt || !attempt.verifier) return fail('bad-response');
  if (attempt.expiresAt && attempt.expiresAt < now()) return fail('expired');

  const cleaned = String(code == null ? '' : code).trim();
  if (!cleaned) return fail('bad-response');

  // If a state came back with the code — a redirect-shaped delivery — it is the CSRF check, and
  // it runs before the code is spent. Out-of-band delivery carries no state back, so this is
  // skipped rather than faked.
  if (state != null && !stateMatches(attempt.state, state)) return fail('state-mismatch');

  const url = new URL(EXCHANGE_PATH, base || authBase()).toString();
  const ctl = new AbortController();
  const onOuter = () => ctl.abort();
  if (signal) {
    if (signal.aborted) return fail('cancelled');
    signal.addEventListener('abort', onOuter, { once: true });
  }
  const timer = setTimeout(() => ctl.abort(), timeoutMs);

  let res, body;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      // The verifier travels in the request body, to the auth origin, and nowhere else.
      body: JSON.stringify({ code: cleaned, code_verifier: attempt.verifier, code_challenge_method: PKCE_METHOD }),
      signal: ctl.signal
    });
    body = await readBounded(res);
  } catch (e) {
    if (signal && signal.aborted) return fail('cancelled');
    if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) return fail('timeout');
    return fail('network');
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onOuter);
  }

  if (!res.ok) return classifyExchange(res.status, body.data);

  const data = body.data;
  if (!data || typeof data !== 'object' || typeof data.key !== 'string' || !data.key) return fail('bad-response');

  /* Read the scope back. It is what was *granted*, not what was asked for: a workspace role can
   * approve less than the request named, and a client that assumes it holds what it asked for
   * will fail later with a confusing error instead of here with a clear one. */
  const granted = typeof data.scope === 'string' ? data.scope : null;
  if (granted && granted !== scope) return fail('scope-insufficient', { granted, requested: scope });

  return {
    ok: true,
    token: data.key,
    // A user id, not an email — it is what the admin card shows to say whose account is spent.
    account: typeof data.user_id === 'string' || typeof data.user_id === 'number' ? String(data.user_id).slice(0, 120) : null,
    scope: granted || scope
  };
}

/* ------------------------------ pending attempts ------------------------------
 * One in-flight login per instance, held server-side.
 *
 * The generation counter is the guard the GUI rules ask for: every async completion, poll and
 * cancellation names the generation it belongs to, and a late answer from an abandoned attempt
 * is dropped instead of writing over the login that replaced it. An admin who cancels and
 * immediately starts again must not be handed the first attempt's key. */

export function createRegistry({ ttlMs = ATTEMPT_TTL_MS } = {}) {
  let current = null;
  let generation = 0;

  const live = () => {
    if (!current) return null;
    if (current.expiresAt < now()) { current = null; return null; }
    return current;
  };

  return {
    /** Begin an attempt. Replaces any pending one — the newest login is the one that counts. */
    start() {
      const attempt = createAttempt();
      generation += 1;
      current = { ...attempt, generation, startedAt: now(), expiresAt: now() + ttlMs };
      return current;
    },
    /** The pending attempt, or null. Expiry is evaluated on read, so a stale one is never used. */
    peek() {
      const a = live();
      if (!a) return null;
      // The verifier never leaves this object's owner — the registry hands back a view without it.
      return { generation: a.generation, state: a.state, challenge: a.challenge, startedAt: a.startedAt, expiresAt: a.expiresAt };
    },
    /** The verifier for one generation only. A mismatched generation gets nothing, by design. */
    verifierFor(gen) {
      const a = live();
      if (!a || a.generation !== Number(gen)) return null;
      return a.verifier;
    },
    /** The full attempt for a generation, for the exchange call. */
    attemptFor(gen) {
      const a = live();
      if (!a || a.generation !== Number(gen)) return null;
      return a;
    },
    /** Release the lock. Idempotent, and safe to call from a cancellation that raced a success. */
    clear(gen = null) {
      if (gen != null && current && current.generation !== Number(gen)) return false;
      const had = !!current;
      current = null;
      return had;
    },
    generation: () => generation,
    isPending: () => !!live()
  };
}

export const registry = createRegistry();
