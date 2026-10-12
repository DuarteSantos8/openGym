// Mobile build only: a self-hosted server behind Cloudflare Access (Zero Trust). Access stops
// every request at Cloudflare's edge until it proves who it is, and a phone cannot do the
// browser's interactive sign-in from inside the app's WebView. A service token can: two headers,
// CF-Access-Client-Id and CF-Access-Client-Secret, on every request to the server — the pairing
// itself included, which is why they are entered before it (MobileOnboarding.jsx).
//
// Both live in the platform's secure storage (lib/coach-secrets.js), never in S or the pairing
// file, together with the origin of the server they were entered for, and are handed to
// lib/api.js, which adds them to requests to that origin and to nothing else: a token typed for
// one server never travels to another one, not even to a pairing typed in by mistake.
import { secureGet, secureSet, secureRemove } from './coach-secrets.js'
import { setAccessHeaders } from './api.js'

const KEY = 'cfAccess'

const clean = v => String(v || '').trim()
// Scheme, host and port only, or '' for anything that is not an http(s) URL.
export function originOf(base) {
  try {
    const u = new URL(clean(base))
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : ''
  } catch { return '' }
}

// The headers for a pair of values, or {} when either is missing: Access refuses a token with
// only half of it, and an empty header would be sent as one.
export function accessHeaders(creds) {
  const id = clean(creds && creds.clientId)
  const secret = clean(creds && creds.clientSecret)
  if (!id || !secret) return {}
  return { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret }
}

// `pairedBase`: the server this phone is paired with. A token saved before tokens knew their
// server has no origin; it is bound to that server on the first start that has one. Without a
// pairing it is kept but sent nowhere until it is entered again with its address.
export async function loadCfAccess({ pairedBase = '' } = {}) {
  let creds = null
  try {
    const raw = await secureGet(KEY)
    const v = raw ? JSON.parse(raw) : null
    if (v && typeof v === 'object') creds = { clientId: clean(v.clientId), clientSecret: clean(v.clientSecret), origin: originOf(v.origin) }
  } catch { /* unreadable: as if never set */ }
  if (!creds || !creds.clientId || !creds.clientSecret) { setAccessHeaders({}, ''); return null }
  if (!creds.origin && originOf(pairedBase)) {
    creds.origin = originOf(pairedBase)
    try { await secureSet(KEY, JSON.stringify(creds)) } catch { /* bound again on the next start */ }
  }
  setAccessHeaders(accessHeaders(creds), creds.origin)
  return creds
}

// Empty values clear the token; anything half-filled, or without the server it is for, is
// refused by the caller (CfAccessSheet), and here as well.
export async function saveCfAccess({ clientId, clientSecret, server } = {}) {
  const creds = { clientId: clean(clientId), clientSecret: clean(clientSecret), origin: originOf(server) }
  if (!creds.clientId || !creds.clientSecret) {
    await secureRemove(KEY)
    setAccessHeaders({}, '')
    return null
  }
  if (!creds.origin) throw new Error('A Cloudflare Access token needs the server it is for')
  await secureSet(KEY, JSON.stringify(creds))
  setAccessHeaders(accessHeaders(creds), creds.origin)
  return creds
}

// Disconnecting from the server takes its token along: the next server is a fresh start.
export const clearCfAccess = () => saveCfAccess({})
