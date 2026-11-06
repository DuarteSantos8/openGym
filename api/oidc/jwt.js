/* The ID token check for OIDC sign-in, written out with node:crypto rather than a library, so
 * every rule that decides who gets in is right here and has a test beside it
 * (test/oidc-jwt.test.js). A token passes only with a signature from the provider's key set, an
 * algorithm on the allowlist, and the claims OIDC Core 3.1.3.7 asks for: iss, aud (and azp),
 * exp, iat, nonce and sub. Anything else is an OidcError with a short `code`. */
import crypto from 'node:crypto';

export class OidcError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

// What we can verify. HS* is left out on purpose: it would make the client secret a signing key,
// and "none" is never a signature at all.
const ALGS = {
  RS256: { kty: 'RSA', hash: 'sha256' }, RS384: { kty: 'RSA', hash: 'sha384' }, RS512: { kty: 'RSA', hash: 'sha512' },
  PS256: { kty: 'RSA', hash: 'sha256', pss: true }, PS384: { kty: 'RSA', hash: 'sha384', pss: true }, PS512: { kty: 'RSA', hash: 'sha512', pss: true },
  ES256: { kty: 'EC', hash: 'sha256', crv: 'P-256' }, ES384: { kty: 'EC', hash: 'sha384', crv: 'P-384' }, ES512: { kty: 'EC', hash: 'sha512', crv: 'P-521' },
  EdDSA: { kty: 'OKP', hash: null }
};
export const SUPPORTED_ALGS = Object.keys(ALGS);

/** The algorithms we accept from this provider: what it says it signs with, cut down to what we
 *  support. A provider that says nothing signs with RS256 (OIDC Discovery 3). */
export function allowedAlgs(advertised) {
  const list = Array.isArray(advertised) && advertised.length ? advertised : ['RS256'];
  return list.filter(a => Object.hasOwn(ALGS, a));
}

const b64json = (part, what) => {
  try {
    const v = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v;
  } catch { throw new OidcError('malformed', `the ${what} is not JSON`); }
};

/** Header and claims without any checking, for the parts that need to look before verifying. */
export function decodeJwt(token) {
  if (typeof token !== 'string' || token.length > 16384) throw new OidcError('malformed', 'no token');
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]*$/.test(p))) throw new OidcError('malformed', 'not a compact JWS');
  return { header: b64json(parts[0], 'header'), claims: b64json(parts[1], 'payload'), parts };
}

// The JWK the header points at. A kid must match one key; without a kid there has to be exactly
// one key of the right type, so we never try keys until one happens to fit.
export function pickKey(jwks, header) {
  const spec = ALGS[header.alg];
  const keys = (Array.isArray(jwks?.keys) ? jwks.keys : []).filter(k => k && k.kty === spec.kty
    && (!k.use || k.use === 'sig') && (!k.alg || k.alg === header.alg) && (!spec.crv || k.crv === spec.crv));
  if (header.kid !== undefined) return keys.find(k => k.kid === header.kid) || null;
  return keys.length === 1 ? keys[0] : null;
}

export function verifySignature(parts, header, jwk) {
  const spec = ALGS[header.alg];
  let key;
  try { key = crypto.createPublicKey({ key: jwk, format: 'jwk' }); }
  catch { throw new OidcError('no-key', 'the provider key does not load'); }
  if (spec.kty === 'RSA' && (key.asymmetricKeyDetails?.modulusLength || 0) < 2048) throw new OidcError('no-key', 'the provider key is too short');
  const data = Buffer.from(parts[0] + '.' + parts[1]);
  const sig = Buffer.from(parts[2], 'base64url');
  const opts = { key };
  if (spec.pss) { opts.padding = crypto.constants.RSA_PKCS1_PSS_PADDING; opts.saltLength = crypto.constants.RSA_PSS_SALTLEN_DIGEST; }
  if (spec.kty === 'EC') opts.dsaEncoding = 'ieee-p1363';
  let ok = false;
  try { ok = crypto.verify(spec.hash, data, opts, sig); } catch { ok = false; }
  if (!ok) throw new OidcError('signature', 'the signature does not verify');
}

const sameText = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Verifies an ID token and returns its claims.
 * `jwks`: the provider's key set; `refetch`: called once when no key matches (keys rotate).
 * `issuer` is the discovered issuer exactly; `nonce` the one this sign-in sent.
 */
export async function verifyIdToken(token, { jwks, refetch, issuer, clientId, nonce, algs, now = Date.now(), skewSec = 60, maxAgeSec = null }) {
  const { header, claims, parts } = decodeJwt(token);
  if (header.crit !== undefined) throw new OidcError('malformed', 'critical header parameters are not supported');
  if (typeof header.alg !== 'string' || !Object.hasOwn(ALGS, header.alg) || !(algs || ['RS256']).includes(header.alg)) {
    throw new OidcError('alg', 'that signing algorithm is not allowed');
  }
  let jwk = pickKey(jwks, header);
  if (!jwk && refetch) jwk = pickKey(await refetch(), header);
  if (!jwk) throw new OidcError('no-key', 'no provider key matches the token');
  verifySignature(parts, header, jwk);

  const t = Math.floor(now / 1000);
  if (typeof claims.iss !== 'string' || claims.iss !== issuer) throw new OidcError('issuer', 'the token is from another issuer');
  const aud = typeof claims.aud === 'string' ? [claims.aud] : Array.isArray(claims.aud) ? claims.aud : [];
  if (!aud.includes(clientId)) throw new OidcError('audience', 'the token is for another client');
  if ((aud.length > 1 || claims.azp !== undefined) && claims.azp !== clientId) throw new OidcError('audience', 'the token was issued to another party');
  if (typeof claims.exp !== 'number' || t > claims.exp + skewSec) throw new OidcError('expired', 'the token has expired');
  if (typeof claims.iat !== 'number' || claims.iat > t + skewSec) throw new OidcError('expired', 'the token is from the future');
  if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > t + skewSec)) throw new OidcError('expired', 'the token is not valid yet');
  if (typeof claims.nonce !== 'string' || !nonce || !sameText(claims.nonce, nonce)) throw new OidcError('nonce', 'the nonce does not match');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw new OidcError('malformed', 'the token names nobody');
  if (maxAgeSec != null && typeof claims.auth_time === 'number' && t - claims.auth_time > maxAgeSec + skewSec) {
    throw new OidcError('stale', 'the provider did not ask again');
  }
  return claims;
}
