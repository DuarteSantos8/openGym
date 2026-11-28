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
import { secureRead, secureSet, secureRemove, AFTER_FIRST_UNLOCK } from './coach-secrets.js'
import { setAccessHeaders, accessHeadersActive } from './api.js'

const KEY = 'cfAccess'
// Not the token: only that one was saved, and the Keychain level it was saved with. Lets a start
// whose read failed know there is something to read again (#1529), and moves a token saved before
// AFTER_FIRST_UNLOCK onto it once.
const MARK = 'og_cfaccess_saved'
const KEYCHAIN_V = 2
const mark = () => { try { return JSON.parse(localStorage.getItem(MARK) || 'null') } catch { return null } }
const setMark = v => { try { v ? localStorage.setItem(MARK, JSON.stringify(v)) : localStorage.removeItem(MARK) } catch { /* only the hint is lost */ } }
const store = creds => secureSet(KEY, JSON.stringify(creds), { access: AFTER_FIRST_UNLOCK })

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
//
// A read that fails is not "no token" (#1529): the iOS Keychain refuses a whenUnlocked item while
// a locked phone starts the app in the background, and a native call can time out. Treated as
// empty, every request then left without the headers until the token was saved again. Now the
// headers already in use stay, the read is tried again a few times, and on the next return to the
// app or tap on Try again (reloadCfAccess). The answer is then { unreadable: true }.
let lastPaired = ''
let unreadable = false
let retryTimer = null
const RETRY_MS = [3000, 10000, 30000]
export async function loadCfAccess({ pairedBase = '', attempt = 0 } = {}) {
  if (pairedBase) lastPaired = pairedBase
  let creds = null
  try {
    const raw = await secureRead(KEY)
    let v = null
    try { v = raw ? JSON.parse(raw) : null } catch { /* garbled: as if never set */ }
    if (v && typeof v === 'object') creds = { clientId: clean(v.clientId), clientSecret: clean(v.clientSecret), origin: originOf(v.origin) }
  } catch {
    unreadable = true
    clearTimeout(retryTimer)
    if (attempt < RETRY_MS.length) retryTimer = setTimeout(() => { loadCfAccess({ pairedBase: lastPaired, attempt: attempt + 1 }).catch(() => {}) }, RETRY_MS[attempt])
    return { unreadable: true }
  }
  unreadable = false
  clearTimeout(retryTimer)
  if (!creds || !creds.clientId || !creds.clientSecret) { setAccessHeaders({}, ''); setMark(null); return null }
  let rewrite = (mark() || {}).kc !== KEYCHAIN_V
  if (!creds.origin && originOf(pairedBase)) { creds.origin = originOf(pairedBase); rewrite = true }
  setAccessHeaders(accessHeaders(creds), creds.origin)
  if (rewrite) {
    try { await store(creds); setMark({ kc: KEYCHAIN_V }) } catch { /* bound again on the next start */ }
  }
  return creds
}

// Read the token again when the last read failed, or when none is in use though one was saved on
// this phone: on a return to the app and before "Try again" (store/useStore.js). Cheap otherwise.
export function needsCfAccessReload() { return unreadable || (!accessHeadersActive() && !!mark()) }
export async function reloadCfAccess() {
  if (!needsCfAccessReload()) return false
  const c = await loadCfAccess({ pairedBase: lastPaired })
  return !!(c && !c.unreadable)
}

// Empty values clear the token; anything half-filled, or without the server it is for, is
// refused by the caller (CfAccessSheet), and here as well.
export async function saveCfAccess({ clientId, clientSecret, server } = {}) {
  const creds = { clientId: clean(clientId), clientSecret: clean(clientSecret), origin: originOf(server) }
  if (!creds.clientId || !creds.clientSecret) {
    await secureRemove(KEY)
    setAccessHeaders({}, '')
    setMark(null)
    unreadable = false
    lastPaired = ''
    return null
  }
  if (!creds.origin) throw new Error('A Cloudflare Access token needs the server it is for')
  await store(creds)
  setMark({ kc: KEYCHAIN_V })
  unreadable = false
  setAccessHeaders(accessHeaders(creds), creds.origin)
  return creds
}

// Disconnecting from the server takes its token along: the next server is a fresh start.
export const clearCfAccess = () => saveCfAccess({})
