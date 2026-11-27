// The entitlement note the app keeps (frontend/src/lib/cloud/entitlement.js verifies it): a
// compact JWS, ES256, signed with a private key that lives only in the function's secrets.
// Web Crypto only, so it runs in an Edge Function and under `node --test`.

const enc = new TextEncoder()
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64uJson = obj => b64u(enc.encode(JSON.stringify(obj)))

export const TOKEN_TTL_SEC = 7 * 86400

/** { sub, features, iat, exp } as a signed token. `privateJwk` is a P-256 private key in JWK form. */
export async function signEntitlement({ sub, features, nowSec = Math.floor(Date.now() / 1000), ttlSec = TOKEN_TTL_SEC }, privateJwk, subtle = globalThis.crypto.subtle) {
  if (typeof sub !== 'string' || !sub) throw new Error('sub missing')
  const key = await subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const head = b64uJson({ alg: 'ES256', typ: 'JWT' })
  const body = b64uJson({ sub, features: [...new Set(features || [])].sort(), iat: nowSec, exp: nowSec + ttlSec })
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body))
  return head + '.' + body + '.' + b64u(sig)
}

/** A fresh P-256 key pair as JWKs: { privateJwk, publicJwk }. For `supabase secrets set` and the web build's env. */
export async function generateKeyPair(subtle = globalThis.crypto.subtle) {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  return { privateJwk: await subtle.exportKey('jwk', pair.privateKey), publicJwk: await subtle.exportKey('jwk', pair.publicKey) }
}
