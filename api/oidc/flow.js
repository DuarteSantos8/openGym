/* The in-memory, one-shot, TTL-bound entries a sign-in attempt lives in between the browser
 * leaving for the provider and the browser coming back, plus the two pieces of RFC 7636 the
 * departure needs. Nothing here writes to disk; the whole point of holding an attempt in memory
 * is that a server restart or an unfinished attempt leaves nothing behind to clean up.
 *
 * This module performs no I/O of its own beyond node:crypto, and it owns no clock and no timer:
 * every expiry decision is driven by the `now` a caller injects, and the periodic sweep is
 * something the caller schedules, not something this module starts on its own. That mirrors the
 * discipline the discovery-document reader already established - inject the clock, let the
 * server own the interval - rather than reading the wall clock directly the way a couple of
 * in-file maps in server.js still do.
 */
import crypto from 'node:crypto';

/* Five minutes, matching the two existing one-shot maps this module generalises. Long enough for
   someone to authenticate at the provider, short enough that an abandoned attempt is not held
   forever. */
export const FLOW_TTL_MS = 300000;

/* An upper bound on how many attempts may be held at once. A departure is an unauthenticated GET,
   so anything that can make a browser issue one - an <img> on an unrelated page - can add entries,
   and without a ceiling the only thing bounding memory is the arrival rate times the TTL. At the
   cap the oldest entry is dropped to make room, which degrades an abandoned or very slow sign-in
   to "start again", exactly as expiry already does, rather than refusing new ones and letting a
   flood lock everybody out. Sized far above any real instance's concurrent sign-ins. */
export const MAX_FLOWS = 5000;

/**
 * RFC 7636 PKCE, S256 only - the `plain` method has no code path anywhere in this codebase.
 * verifier: 32 random bytes rendered base64url, giving 43 characters - inside the 43-128 bound
 * the RFC sets, and base64url's alphabet ([A-Za-z0-9_-]) is already a subset of the unreserved
 * character set the RFC requires, so no further encoding step is needed.
 * challenge: the base64url SHA-256 digest of the verifier's exact characters. The verifier itself
 * is sent only at the token endpoint, in a later, separate request; this challenge is what
 * travels in the browser-visible authorization request instead.
 */
export function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/* Same 32-byte, base64url shape as the verifier above - this is what mints `state`, `nonce` and
   the id a post-callback entry is addressed by. Guessing one is not a reachable attack surface. */
export function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * A private Map behind four operations, generalising the `challenges`/`putChallenge`/
 * `takeChallenge` shape server.js already carries twice (once for WebAuthn challenges, once for
 * device pairing codes) into something every leg of the provider flow can share.
 *
 * `take` and `peek` both answer `{ value, reason }` rather than a bare value or a thrown error,
 * and that is the one deliberate departure from `takeChallenge`'s own `null`-on-either-miss
 * shape: a caller here has to tell two misses apart on the screen - an entry that never existed
 * (a forged or cross-browser callback) reads differently to the person hitting it than one that
 * existed and ran out (a slow trip through the provider) - and a store that folded both into one
 * `null` would force every caller to re-derive which one it was.
 *
 * `take` deletes before it decides, exactly like `takeChallenge` does: a replayed callback for a
 * key already consumed finds nothing, never a stale but still-present entry, because the entry is
 * gone the instant the first read happens regardless of what that read concludes.
 */
export function createFlowStore({ now = Date.now, maxEntries = MAX_FLOWS } = {}) {
  const pending = new Map();

  function read(key, { consume }) {
    const entry = pending.get(key);
    if (consume) pending.delete(key);
    if (!entry) return { value: null, reason: 'state-unknown' };
    if (entry.exp < now()) return { value: null, reason: 'state-expired' };
    return { value: entry.value, reason: null };
  }

  return {
    put(key, data, ttlMs = FLOW_TTL_MS) {
      /* Expired entries first: at a steady arrival rate the cap is never what makes room, so a
         flood is the only thing that reaches the eviction below. A Map iterates in insertion
         order, which for entries sharing one TTL is also age order. */
      if (pending.size >= maxEntries && !pending.has(key)) {
        for (const [k, entry] of pending) if (entry.exp < now()) pending.delete(k);
        while (pending.size >= maxEntries) {
          const oldest = pending.keys().next();
          if (oldest.done) break;
          pending.delete(oldest.value);
        }
      }
      pending.set(key, { value: data, exp: now() + ttlMs });
    },
    take(key) {
      return read(key, { consume: true });
    },
    peek(key) {
      return read(key, { consume: false });
    },
    sweep() {
      for (const [key, entry] of pending) if (entry.exp < now()) pending.delete(key);
    },
    size() {
      return pending.size;
    }
  };
}
