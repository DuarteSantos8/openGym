// The Pro entitlement on the device (cloud edition only; docs/next/adr/0011-payments-iap.md).
//
// The server hands the app a small signed note: "this account has these features until then"
// (supabase/functions/entitlement-token). The app keeps it and checks the signature itself, so
// Pro keeps working in airplane mode and nobody has to be asked on every screen.
//
//   - The note is a compact JWS signed ES256. Only that algorithm is accepted: a token that
//     names another one, or none, is refused before any key is touched.
//   - It is good until `exp`, and then for GRACE more, so a week without signal does not take
//     Pro away mid-holiday. After that the account reads as Free.
//   - Lapsing never deletes anything. Free is a smaller set of features over the same data.
//   - This is a convenience check, not a lock. The code is AGPL and anyone can build it without
//     the check; what Pro sells runs on the server, which checks for itself on every call.
//
// Loaded only through import() behind isCloud() (lib/edition.js): never in the default build.

export const GRACE_SEC = 7 * 86400
const KEY = 'gym_entitlement_v1'

const b64uToBytes = s => {
  const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='))
  return Uint8Array.from(b, c => c.charCodeAt(0))
}
const b64uToJson = s => JSON.parse(new TextDecoder().decode(b64uToBytes(s)))

export class EntitlementError extends Error {
  constructor(code) { super(code); this.code = code }
}

/**
 * Checks a token's shape and signature against the public key (a JWK), and returns its claims:
 * { sub, features: [...], iat, exp }. Throws EntitlementError('malformed' | 'alg' | 'signature' |
 * 'claims'). Says nothing about time: stateOf does.
 */
export async function verifyEntitlement(token, publicJwk, subtle = globalThis.crypto.subtle) {
  const parts = typeof token === 'string' ? token.split('.') : []
  if (parts.length !== 3 || parts.some(p => !p)) throw new EntitlementError('malformed')
  let header, claims
  try { header = b64uToJson(parts[0]); claims = b64uToJson(parts[1]) } catch { throw new EntitlementError('malformed') }
  if (header?.alg !== 'ES256') throw new EntitlementError('alg')
  let ok = false
  try {
    const key = await subtle.importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64uToBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]))
  } catch { ok = false }
  if (!ok) throw new EntitlementError('signature')
  if (!claims || typeof claims.sub !== 'string' || !claims.sub || !Array.isArray(claims.features)
    || !Number.isFinite(claims.exp) || !claims.features.every(f => typeof f === 'string')) throw new EntitlementError('claims')
  return claims
}

/**
 * Where verified claims stand at `nowSec`:
 *   'active'   before exp
 *   'grace'    past exp, within GRACE_SEC: still Pro, time to refresh
 *   'expired'  after that: Free
 */
export function stateOf(claims, nowSec = Math.floor(Date.now() / 1000)) {
  if (!claims || !Number.isFinite(claims.exp)) return 'expired'
  if (nowSec < claims.exp) return 'active'
  return nowSec < claims.exp + GRACE_SEC ? 'grace' : 'expired'
}

/** Whether verified claims grant `feature` at `nowSec`. For `userId`, when given, only its own token counts. */
export function hasFeature(claims, feature, { nowSec, userId } = {}) {
  if (!claims || stateOf(claims, nowSec) === 'expired') return false
  if (userId != null && claims.sub !== userId) return false
  return claims.features.includes(feature)
}

/* The token as text, kept between launches. Storage that throws or is full reads as no token. */
export function saveToken(token, storage = globalThis.localStorage) {
  try { if (token) storage.setItem(KEY, token); else storage.removeItem(KEY); return true } catch { return false }
}
export function loadToken(storage = globalThis.localStorage) {
  try { return storage.getItem(KEY) || null } catch { return null }
}

/**
 * The stored token, verified: { claims, state } or null when there is none or it does not verify
 * (a token that fails is thrown away, so a tampered one is not tried on every launch).
 */
export async function loadEntitlement(publicJwk, { storage = globalThis.localStorage, nowSec, subtle } = {}) {
  const token = loadToken(storage)
  if (!token) return null
  try {
    const claims = await verifyEntitlement(token, publicJwk, subtle)
    return { claims, state: stateOf(claims, nowSec) }
  } catch {
    saveToken(null, storage)
    return null
  }
}
