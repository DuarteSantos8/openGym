/* Hub tokens: how a separate sync service (the hub) acts for one profile without a session.
 *
 * The hub signs a short-lived ES256 JWS per call; openGym holds only the public half of its key,
 * from the environment, and never fetches a key over the network. The contract is shared with the
 * hub's other verifier, so it is followed to the letter:
 *
 *   - the header's `alg` must be ES256 and is never used to choose how to verify (no HS256 with
 *     the public key as the secret, no `none`); its `kid` must name a configured key;
 *   - `iss` is HUB_ISSUER, `aud` the one audience asked for, as a string, never an array;
 *   - `exp` in the future, `iat` at most 30 s ahead of this clock, and no token lives over 60 s;
 *   - `sub` is a profile id, `scope` one the route allows.
 *
 * A token that fails any of it is refused, and nothing here falls back to another way in. The
 * token itself is never logged; a refusal carries only a reason code.
 *
 * HUB_JWKS unset means none of this exists (hubKeysFromEnv returns null), so an instance that
 * never asked for a hub answers every /api/sync/* route with the plain 404 it always did. */
import crypto from 'node:crypto';

export const HUB_AUDIENCE = 'opengym-sync';
const MAX_LIFETIME_S = 60;
const SKEW_S = 30;
// A real token is a few hundred bytes; this only stops a megabyte header being decoded.
const MAX_TOKEN = 4096;
const SEGMENT = /^[A-Za-z0-9_-]+$/;
const label = v => String(v).slice(0, 40);

// → { issuer, keys: Map<kid, KeyObject> }, or null when HUB_JWKS is unset. Throws when it is set
// but cannot be used: a typo in the key set must stop the boot, not quietly switch sync off.
export function hubKeysFromEnv(env) {
  const raw = String(env.HUB_JWKS || '').trim();
  if (!raw) return null;
  const issuer = String(env.HUB_ISSUER || '').trim();
  if (!issuer) throw new Error('HUB_JWKS is set but HUB_ISSUER is not');
  let set;
  try { set = JSON.parse(raw); } catch { throw new Error('HUB_JWKS is not valid JSON'); }
  if (!set || !Array.isArray(set.keys) || !set.keys.length) throw new Error('HUB_JWKS has no keys');
  const keys = new Map();
  for (const jwk of set.keys) {
    if (!jwk || typeof jwk !== 'object' || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.kid !== 'string' || !jwk.kid) {
      throw new Error('HUB_JWKS: every key must be an EC P-256 key with a kid');
    }
    const kid = label(jwk.kid);
    // The hub's signing key has no business on this host; a set that carries it is a mistake.
    if ('d' in jwk) throw new Error(`HUB_JWKS: key ${kid} is a private key, give openGym the public half only`);
    if (jwk.alg !== undefined && jwk.alg !== 'ES256') throw new Error(`HUB_JWKS: key ${kid} is not for ES256`);
    if (jwk.use !== undefined && jwk.use !== 'sig') throw new Error(`HUB_JWKS: key ${kid} is not a signing key`);
    if (keys.has(jwk.kid)) throw new Error(`HUB_JWKS: kid ${kid} appears twice`);
    try {
      keys.set(jwk.kid, crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' }));
    } catch {
      throw new Error(`HUB_JWKS: key ${kid} is not a valid P-256 public key`);
    }
  }
  return { issuer, keys };
}

const fail = reason => ({ ok: false, reason });
function segment(s) {
  try {
    const v = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

// → { ok: true, claims } or { ok: false, reason }, the reason a code safe to write to a log.
// `hub` is what hubKeysFromEnv returned; `scopes` the scopes the route accepts.
export function verifyHubToken(hub, token, { audience, scopes, now = Date.now() }) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN) return fail('malformed');
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every(p => SEGMENT.test(p))) return fail('malformed');
  const header = segment(parts[0]);
  if (!header) return fail('malformed');
  if (header.alg !== 'ES256') return fail('alg');
  // An extension the token says must be understood is one this verifier does not know.
  if (header.crit !== undefined) return fail('crit');
  const key = typeof header.kid === 'string' ? hub.keys.get(header.kid) : undefined;
  if (!key) return fail('kid');
  // JWS carries ES256 as r || s, 64 bytes, not the DER node defaults to.
  const sig = Buffer.from(parts[2], 'base64url');
  if (sig.length !== 64) return fail('signature');
  let good = false;
  try { good = crypto.verify('sha256', Buffer.from(parts[0] + '.' + parts[1]), { key, dsaEncoding: 'ieee-p1363' }, sig); }
  catch { good = false; }
  if (!good) return fail('signature');
  const c = segment(parts[1]);
  if (!c) return fail('malformed');
  if (c.iss !== hub.issuer) return fail('iss');
  if (c.aud !== audience) return fail('aud');
  if (!Number.isFinite(c.exp) || !Number.isFinite(c.iat)) return fail('time');
  const t = now / 1000;
  if (c.exp <= t) return fail('expired');
  if (c.iat > t + SKEW_S) return fail('iat');
  if (c.exp <= c.iat || c.exp - c.iat > MAX_LIFETIME_S) return fail('lifetime');
  if (typeof c.sub !== 'string' || !c.sub) return fail('sub');
  if (!scopes.includes(c.scope)) return fail('scope');
  return { ok: true, claims: c };
}
