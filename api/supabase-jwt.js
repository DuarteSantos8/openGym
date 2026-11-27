// Cloud edition only (docs/next/adr/0010-backend-hybrid.md): checks an access token issued by the
// project's Supabase Auth, so the API can accept a cloud sign-in as a way to identify someone.
//
// Nothing here runs unless SUPABASE_URL is set. A self-hosted server never loads a key, never
// makes a request and behaves exactly as before.
//
// What is checked, in this order, and refused on the first miss:
//   1. shape: three base64url parts, a JSON header and payload
//   2. algorithm: ES256 or RS256 only. HS256 and "none" are refused before any key is looked at
//      (a server that verifies with a public key must never accept a shared-secret algorithm)
//   3. key: the header's `kid` must be one of the project's published keys (its JWKS). An unknown
//      kid refetches the keys once, at most every REFETCH_MS, so a rotated key is picked up and
//      a flood of made-up kids cannot be turned into a flood of requests
//   4. signature
//   5. claims: `iss` is this project's auth URL, `aud` is "authenticated", `exp` has not passed
//      (with a small allowance for clocks), `nbf` if present has, and there is a `sub`
//
// The result is who the token is for, nothing more. Mapping that to one of this server's own
// users is the caller's job (the account link, EP19-T05).
import crypto from 'node:crypto'

export const ALGS = { ES256: { hash: 'sha256', dsaEncoding: 'ieee-p1363', kty: 'EC' }, RS256: { hash: 'sha256', kty: 'RSA' } }
const CACHE_MS = 10 * 60 * 1000
const REFETCH_MS = 60 * 1000
const LEEWAY_SEC = 30

export class SupabaseJwtError extends Error {
  constructor(code) { super('supabase token: ' + code); this.code = code }
}

const fromB64u = s => Buffer.from(String(s), 'base64url')
const json = part => { try { return JSON.parse(fromB64u(part).toString('utf8')) } catch { return null } }

/** The project's auth issuer for a project URL, or null when the URL is not an https one (http only for localhost). */
export function issuerOf(url) {
  let u
  try { u = new URL(String(url)) } catch { return null }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null
  return u.origin + u.pathname.replace(/\/+$/, '') + '/auth/v1'
}

/**
 * A verifier for one project: `verify(token)` resolves to { sub, email, anonymous, exp } or
 * rejects with a SupabaseJwtError. `fetchImpl` and `now` are handed in so tests need no network
 * and no clock. Returns null when `url` is unset or not usable: the feature is simply off.
 */
export function createSupabaseVerifier({ url, fetchImpl = globalThis.fetch, now = Date.now, audience = 'authenticated' } = {}) {
  const issuer = url ? issuerOf(url) : null
  if (!issuer) return null
  const jwksUrl = issuer + '/.well-known/jwks.json'
  let keys = new Map(), fetchedAt = -Infinity, inFlight = null

  async function load() {
    if (inFlight) return inFlight
    inFlight = (async () => {
      try {
        const res = await fetchImpl(jwksUrl, { headers: { accept: 'application/json' } })
        if (!res.ok) throw new SupabaseJwtError('keys')
        const body = await res.json()
        const next = new Map()
        for (const jwk of Array.isArray(body?.keys) ? body.keys : []) {
          if (!jwk || typeof jwk.kid !== 'string') continue
          // Public keys only: a JWKS that carried a private part would be a misconfiguration.
          if (jwk.d !== undefined) continue
          try { next.set(jwk.kid, { jwk, key: crypto.createPublicKey({ key: jwk, format: 'jwk' }) }) } catch { /* a key this server cannot read is skipped */ }
        }
        keys = next
        fetchedAt = now()
      } catch (e) {
        // Keys already held stay in use through a failed refresh.
        fetchedAt = now()
        if (!keys.size) throw e instanceof SupabaseJwtError ? e : new SupabaseJwtError('keys')
      } finally { inFlight = null }
    })()
    return inFlight
  }

  async function keyFor(kid) {
    if (now() - fetchedAt > CACHE_MS) await load()
    if (!keys.has(kid) && now() - fetchedAt > REFETCH_MS) await load()
    return keys.get(kid) || null
  }

  async function verify(token) {
    const parts = typeof token === 'string' ? token.split('.') : []
    if (parts.length !== 3 || parts.some(p => !p || !/^[A-Za-z0-9_-]+$/.test(p))) throw new SupabaseJwtError('malformed')
    const header = json(parts[0]), claims = json(parts[1])
    if (!header || !claims || typeof header !== 'object' || typeof claims !== 'object') throw new SupabaseJwtError('malformed')
    const alg = Object.hasOwn(ALGS, header.alg) ? ALGS[header.alg] : null
    if (!alg) throw new SupabaseJwtError('alg')
    if (typeof header.kid !== 'string' || !header.kid) throw new SupabaseJwtError('kid')
    const entry = await keyFor(header.kid)
    if (!entry) throw new SupabaseJwtError('kid')
    // The key's own type has to fit the algorithm the token names.
    if (entry.jwk.kty !== alg.kty) throw new SupabaseJwtError('alg')
    let ok = false
    try {
      ok = crypto.verify(alg.hash, Buffer.from(parts[0] + '.' + parts[1]), { key: entry.key, ...(alg.dsaEncoding ? { dsaEncoding: alg.dsaEncoding } : {}) }, fromB64u(parts[2]))
    } catch { ok = false }
    if (!ok) throw new SupabaseJwtError('signature')

    const nowSec = Math.floor(now() / 1000)
    if (claims.iss !== issuer) throw new SupabaseJwtError('issuer')
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (!aud.includes(audience)) throw new SupabaseJwtError('audience')
    if (!Number.isFinite(claims.exp) || claims.exp + LEEWAY_SEC <= nowSec) throw new SupabaseJwtError('expired')
    if (claims.nbf !== undefined && !(Number.isFinite(claims.nbf) && claims.nbf - LEEWAY_SEC <= nowSec)) throw new SupabaseJwtError('not-yet')
    if (typeof claims.sub !== 'string' || !/^[0-9a-f-]{36}$/i.test(claims.sub)) throw new SupabaseJwtError('subject')
    return { sub: claims.sub.toLowerCase(), email: typeof claims.email === 'string' && claims.email ? claims.email : null, anonymous: claims.is_anonymous === true, exp: claims.exp }
  }

  return { verify, issuer, jwksUrl }
}
