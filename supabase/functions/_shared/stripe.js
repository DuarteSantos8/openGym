// Stripe, without an SDK: one signature check and one request helper, on web-standard APIs only
// (fetch, crypto.subtle), so the same file runs in a Supabase Edge Function and under `node --test`.
//
// The signature scheme is Stripe's documented one: the `Stripe-Signature` header carries a
// timestamp `t` and one or more `v1` HMAC-SHA256 signatures of `${t}.${rawBody}` under the
// endpoint's signing secret. The body must be the raw text exactly as received.

const enc = new TextEncoder()
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')

// Compares in time that does not depend on where the strings differ.
function sameText(a, b) {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

export class StripeSignatureError extends Error {
  constructor(code) { super(code); this.code = code }
}

/**
 * Throws StripeSignatureError('header' | 'timestamp' | 'signature') unless `rawBody` was signed
 * with `secret` within `toleranceSec` of `nowSec`. Returns the parsed event on success.
 */
export async function verifyStripeEvent(rawBody, header, secret, { toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000), subtle = globalThis.crypto.subtle } = {}) {
  if (typeof rawBody !== 'string' || typeof header !== 'string' || !secret) throw new StripeSignatureError('header')
  let t = null
  const v1 = []
  for (const part of header.split(',')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim()
    if (k === 't') t = v
    else if (k === 'v1') v1.push(v)
  }
  if (!t || !/^\d+$/.test(t) || !v1.length) throw new StripeSignatureError('header')
  if (Math.abs(nowSec - Number(t)) > toleranceSec) throw new StripeSignatureError('timestamp')
  const key = await subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const want = hex(await subtle.sign('HMAC', key, enc.encode(t + '.' + rawBody)))
  if (!v1.some(sig => sameText(sig, want))) throw new StripeSignatureError('signature')
  let event
  try { event = JSON.parse(rawBody) } catch { throw new StripeSignatureError('signature') }
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') throw new StripeSignatureError('signature')
  return event
}

/** Stripe's form encoding: { a: { b: [1, 2] } } → a[b][0]=1&a[b][1]=2. null and undefined are left out. */
export function formEncode(params) {
  const out = []
  const walk = (key, v) => {
    if (v === null || v === undefined) return
    if (Array.isArray(v)) v.forEach((x, i) => walk(`${key}[${i}]`, x))
    else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(`${key}[${k}]`, x)
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)))
  }
  for (const [k, v] of Object.entries(params || {})) walk(k, v)
  return out.join('&')
}

export class StripeApiError extends Error {
  constructor(status, body) { super(body?.error?.message || 'Stripe request failed'); this.status = status; this.type = body?.error?.type || null }
}

/**
 * One call to Stripe's REST API. `idempotencyKey` makes a repeated POST safe. The secret key goes
 * in the Authorization header and nowhere else: never into a URL, a log or an error message.
 */
export async function stripeRequest(method, path, { key, params, idempotencyKey, fetchImpl = fetch } = {}) {
  if (!key) throw new Error('Stripe key missing')
  const isGet = method === 'GET'
  const body = params ? formEncode(params) : ''
  const res = await fetchImpl('https://api.stripe.com' + path + (isGet && body ? '?' + body : ''), {
    method,
    headers: {
      Authorization: 'Bearer ' + key,
      ...(isGet ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    ...(isGet ? {} : { body }),
  })
  let json = null
  try { json = await res.json() } catch { /* an empty or non-JSON answer is an error below */ }
  if (!res.ok || !json) throw new StripeApiError(res.status, json)
  return json
}
