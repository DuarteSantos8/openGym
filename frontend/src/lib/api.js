// Backend + WebAuthn helpers (ported from the vanilla app).
import { t } from './i18n-core.js'
import { MOBILE } from './mobile.js'
import { appBase } from './app-base.js'

export const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
export const IS_ANDROID = /Android/.test(navigator.userAgent)
export const BIO = IS_APPLE ? 'Face ID / Touch ID' : IS_ANDROID ? 'fingerprint or face unlock' : 'your fingerprint, face or PIN'
export const VAULT = IS_APPLE ? 'iCloud Keychain' : IS_ANDROID ? 'Google Password Manager' : 'your password manager'
// The same phrases in the UI language. They go into translated sentences ("confirm with {0}"),
// so the English constants above left an English phrase in the middle of every other language.
// Functions, not constants: the pack is loaded after this module is.
export const bio = () => (IS_APPLE ? t('Face ID / Touch ID') : IS_ANDROID ? t('fingerprint or face unlock') : t('your fingerprint, face or PIN'))
export const vault = () => (IS_APPLE ? t('iCloud Keychain') : IS_ANDROID ? t('Google Password Manager') : t('your password manager'))
// PublicKeyCredential is the WebAuthn-specific capability signal. Do not also gate the UI on
// navigator.credentials: some browsers expose WebAuthn while that generic Credential Management
// API check produces a false negative (notably Chrome on iOS). The real create/get calls still run
// only after the user chooses a passkey action and surface any genuine browser error there.
//
// False on the mobile build whatever the WebView itself exposes: the app's WebView runs at its
// own bundled origin, which never matches the server's RP ID, so no passkey ceremony against the
// server could ever succeed from here - every caller hides its own passkey option once this says
// so, rather than each needing its own MOBILE check beside it.
export const webauthnOK = () => !MOBILE && typeof window.PublicKeyCredential !== 'undefined'

// The paired mobile app (lib/remote.js) is the only caller of these — everywhere else stays on
// same-origin cookies, so remoteBase/remoteToken stay empty and api() behaves exactly as before.
let remoteBase = ''
let remoteToken = null
export function setRemoteAuth(base, token) { remoteBase = base || ''; remoteToken = token || null }

export { appBase }

// How long one request may take before it counts as no answer at all. A black-holed connection
// (captive portal, half-open socket, a phone between two networks) never settles on its own, and
// the store runs one push and one pull at a time: a single hung request used to hold every later
// sync behind it, silently, for as long as the socket hung. A GET is small; a PUT carries the
// whole profile over what may be a slow uplink. A caller that knows its request is slow on
// purpose (the admin's provider test) passes its own `timeout`; 0 means none.
const TIMEOUT_GET_MS = 20000
const TIMEOUT_MS = 60000

const failure = (message, code, status) => Object.assign(new Error(message), { code, status })

export async function api(path, opts) {
  const { timeout, ...init } = opts || {}
  // A phone with no server to talk to: local mode, or a pairing that is gone. There is no
  // relative URL to fall back on here — the WebView's own origin is Capacitor's local asset
  // server, which answers ANY path, PUT included, with index.html and a 200, so a push "landed"
  // there and the change was marked as synced while the server never saw it. status 0, not
  // undefined: this is not "offline", and the store must not show it as such.
  if (MOBILE && !remoteBase) throw failure(t('This phone is not connected to a server.'), 'not-paired', 0)
  const headers = Object.assign({ 'Content-Type': 'application/json' }, init.headers)
  if (remoteToken) headers.Authorization = 'Bearer ' + remoteToken
  // A paired phone has an absolute base of its own; everyone else is relative to where the app
  // is served, so a subpath deployment reaches its own API instead of the proxy's root.
  const url = remoteBase ? remoteBase + path : appBase().replace(/\/$/, '') + path
  const ms = timeout != null ? timeout : (init.method || 'GET').toUpperCase() === 'GET' ? TIMEOUT_GET_MS : TIMEOUT_MS
  return request(url, Object.assign({}, init, { headers }), ms)
}

// One exchange, bounded by `ms`. No status on the timeout, like a fetch that failed outright: to
// the store both mean the server could not be reached, and the device says it is offline instead
// of waiting forever.
async function request(url, init, ms) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null
  let timer = null
  const expired = new Promise((_, reject) => {
    if (ms > 0) timer = setTimeout(() => { if (ctl) ctl.abort(); reject(failure(t('The server did not answer in time.'), 'timeout')) }, ms)
  })
  const answer = exchange(url, ctl ? Object.assign({}, init, { signal: ctl.signal }) : init)
  answer.catch(() => {})   // it may still settle after the timeout has answered; nobody is listening then
  try { return await Promise.race([answer, expired]) }
  finally { clearTimeout(timer) }
}

// Every route of the API answers JSON (api/server.js json()). A 2xx whose body is not JSON is
// therefore someone else's answer: Capacitor's local server on a phone that lost its pairing, an
// auth proxy's login page, a proxy that sends /api/* to the app's index.html. Reading it as {}
// made a push look accepted by a server "from before revisions" — the change was marked synced
// and dropped from the queue. It is an error, with the status it came with.
async function exchange(url, init) {
  const r = await fetch(url, init)
  let data
  let parsed = true
  try { data = await r.json() } catch { parsed = false }
  const body = parsed && data && typeof data === 'object' ? data : null
  // The body rides along on the error: a 409 from /api/data carries the server's document.
  if (!r.ok) { const e = new Error((body && body.error) || ('HTTP ' + r.status)); e.status = r.status; e.data = body || {}; throw e }
  if (!body) throw failure(t('The server answered with something other than openGym data.'), 'bad-response', r.status)
  return body
}

// A "left" signal sent as the page goes: sendBeacon outlives a closing tab, where fetch may not.
// Only the web app sends one, to its own origin with its session cookie. A beacon carries no
// Authorization header, so a paired phone's server could not tell whose it is, and the phone's own
// origin is Capacitor's asset server, which answers every path with index.html: the phones sent
// every "left" to https://localhost/api/activity. The api() call beside it reaches the server.
export function beacon(path, body) {
  if (MOBILE) return false
  try {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false
    return !!navigator.sendBeacon(appBase().replace(/\/$/, '') + path, new Blob([JSON.stringify(body)], { type: 'application/json' }))
  } catch { return false }
}

/* ------------------------------------------------ photos and videos of custom exercises ------
   Two transports beside api(), for the one kind of body that is not JSON. Both go to the same
   base api() uses and carry the paired phone's Bearer token the same way (the server's CORS
   answer allows it for GET and PUT); both refuse to run on a phone without a server, like api(). */

const mediaUrl = path => (remoteBase ? remoteBase + path : appBase().replace(/\/$/, '') + path)
const mediaHeaders = () => (remoteToken ? { Authorization: 'Bearer ' + remoteToken } : {})
const notPaired = () => failure(t('This phone is not connected to a server.'), 'not-paired', 0)
const timedOut = () => failure(t('The server did not answer in time.'), 'timeout')

/**
 * GET a file as a Blob (lib/media-sync.js fetchToStore, which checks its hash before keeping it).
 * An answer that announces more than `expectSize` (+1 KB) is refused before a byte is read, and
 * one that turns out longer is cut off: a login page or a proxy's error is never read into
 * memory. There is no total time limit — a video on a slow line takes what it takes — only an
 * idle one: no bytes for `idleMs` and the download counts as offline (code 'timeout').
 * Errors carry { status, code } like api()'s: the server's code on a refusal (media-missing).
 */
export async function apiBlob(path, { expectSize, idleMs = 30000, fetchImpl = globalThis.fetch } = {}) {
  if (MOBILE && !remoteBase) throw notPaired()
  const max = typeof expectSize === 'number' && expectSize >= 0 ? expectSize + 1024 : Infinity
  const ctl = typeof AbortController === 'function' ? new AbortController() : null
  let timer = null
  let idle = false
  // The stall is raced against every await, not left to the abort alone: a WebView whose reader
  // does not settle on abort would otherwise hang the download for good.
  let stalled = null
  const stall = new Promise((_, reject) => { stalled = reject })
  stall.catch(() => {})
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { idle = true; ctl?.abort(); stalled(timedOut()) }, idleMs) }
  const tooBig = status => failure('HTTP ' + status, 'too-large', status)
  // What loses the race may still reject afterwards, with nobody left listening.
  const orStall = p => { p.catch(() => {}); return Promise.race([p, stall]) }
  arm()
  try {
    const r = await orStall(fetchImpl(mediaUrl(path), { headers: mediaHeaders(), cache: 'no-store', ...(ctl ? { signal: ctl.signal } : {}) }))
    if (!r.ok) {
      let body = null
      try { body = await r.json() } catch { /* not JSON: a proxy's page */ }
      throw Object.assign(new Error((body && body.error) || 'HTTP ' + r.status), { status: r.status, code: (body && body.code) || 'http', data: body || {} })
    }
    const announced = Number(r.headers?.get?.('content-length'))
    if (Number.isFinite(announced) && announced > max) { ctl?.abort(); throw tooBig(r.status) }
    const reader = r.body && typeof r.body.getReader === 'function' ? r.body.getReader() : null
    if (!reader) {
      const b = await orStall(r.blob())
      if (b.size > max) throw tooBig(r.status)
      return b
    }
    const parts = []
    let n = 0
    for (;;) {
      arm()
      const { done, value } = await orStall(reader.read())
      if (done) break
      n += value.length
      if (n > max) { ctl?.abort(); throw tooBig(r.status) }
      parts.push(value)
    }
    return new Blob(parts)
  } catch (e) {
    if (idle) throw timedOut()
    throw e
  } finally { clearTimeout(timer) }
}

/**
 * PUT a file (XMLHttpRequest, because only it reports upload progress). `mime` is the type the
 * MediaRef records, sent explicitly — a Blob read back from a phone's file carries whatever the
 * local server guessed. Resolves with the server's JSON answer. Rejects with { status, code }:
 * the server's own code on a refusal, plus `retryAfter` on a 429; 'proxy-too-large' for a 413
 * that is not the API's JSON (nginx's client_max_body_size, Cloudflare's 100 MB); 'timeout' after
 * `idleMs` without progress; no status at all when the network failed.
 */
export function apiUpload(path, blob, mime, { onProgress, idleMs = 60000, XHR = globalThis.XMLHttpRequest } = {}) {
  if (MOBILE && !remoteBase) return Promise.reject(notPaired())
  return new Promise((resolve, reject) => {
    const xhr = new XHR()
    let timer = null
    let idle = false
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { idle = true; xhr.abort() }, idleMs) }
    xhr.open('PUT', mediaUrl(path))
    xhr.setRequestHeader('Content-Type', mime)
    for (const [k, v] of Object.entries(mediaHeaders())) xhr.setRequestHeader(k, v)
    if (xhr.upload) xhr.upload.onprogress = e => { arm(); if (onProgress && e.lengthComputable) onProgress(e.loaded, e.total) }
    xhr.onprogress = arm
    xhr.onload = () => {
      clearTimeout(timer)
      let body = null
      try { body = JSON.parse(xhr.responseText) } catch { /* not JSON */ }
      if (body && typeof body !== 'object') body = null
      if (xhr.status >= 200 && xhr.status < 300) {
        if (body) resolve(body)
        else reject(failure(t('The server answered with something other than openGym data.'), 'bad-response', xhr.status))
        return
      }
      if (xhr.status === 413 && !body) { reject(failure('HTTP 413', 'proxy-too-large', 413)); return }
      const e = Object.assign(new Error((body && body.error) || 'HTTP ' + xhr.status), { status: xhr.status, code: (body && body.code) || 'http', data: body || {} })
      if (xhr.status === 429) {
        const header = Number(xhr.getResponseHeader && xhr.getResponseHeader('Retry-After'))
        e.retryAfter = Number(body && body.retryAfter) || (Number.isFinite(header) && header > 0 ? header : 60)
      }
      reject(e)
    }
    xhr.onerror = () => { clearTimeout(timer); reject(Object.assign(new Error('network'), { code: 'network' })) }
    xhr.onabort = () => { clearTimeout(timer); reject(idle ? timedOut() : Object.assign(new Error('aborted'), { code: 'network' })) }
    arm()
    xhr.send(blob)
  })
}

// Bootstraps the connection itself: the base isn't configured yet (that's what this call decides),
// so it talks straight to the server the user typed in, no Authorization header.
export async function pairRedeem(serverBase, code) {
  const data = await request(serverBase + '/api/pair/redeem', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code })
  }, TIMEOUT_GET_MS)
  // Anything that is not a pairing would be saved as one — and the phone would then send every
  // change to a server that never gave it a token.
  if (!data.token || !data.user) throw failure(t('The server answered with something other than openGym data.'), 'bad-response', 200)
  return data
}

// The phone app's own redeem, once its return address hands it the one-shot code: same bootstrap
// shape as pairRedeem - the base isn't wired into remoteBase yet either, so this talks straight to
// the server the connect screen is pointed at. `session: true` is only for a re-auth redeem, where
// the phone already has a (now-refused) remote token to send alongside the new attempt's own
// credential; a first-time connect sends no Authorization header at all.
export async function appRedeem(serverBase, body, { session = false } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (session && remoteToken) headers.Authorization = 'Bearer ' + remoteToken
  return request(serverBase + '/api/oidc/app/redeem', { method: 'POST', headers, body: JSON.stringify(body) }, TIMEOUT_GET_MS)
}

// Finishes an identity nobody has linked yet into a profile, with the one-shot handle
// POST /api/oidc/app/redeem's confirmation answer carried. Same bootstrap shape as appRedeem - no
// Authorization header, since this phone has no remote token until this call answers one.
export async function appConfirm(serverBase, body) {
  const data = await request(serverBase + '/api/oidc/app/confirm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }, TIMEOUT_GET_MS)
  if (!data.token || !data.user) throw failure(t('The server answered with something other than openGym data.'), 'bad-response', 200)
  return data
}

// Peeks a server's public configuration before this phone is connected to it at all - the same
// GET /api/config the web boot reads, unauthenticated, so the connect screen can learn whether a
// provider is offered before anything is paired.
export async function serverConfig(serverBase) {
  return request(serverBase + '/api/config', { method: 'GET' }, TIMEOUT_GET_MS)
}

const bufToB64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64uToBuf = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).buffer

function toCreationOptions(o) {
  o.challenge = b64uToBuf(o.challenge)
  o.user.id = b64uToBuf(o.user.id)
  ;(o.excludeCredentials || []).forEach(c => { c.id = b64uToBuf(c.id) })
  return o
}
function toRequestOptions(o) {
  o.challenge = b64uToBuf(o.challenge)
  ;(o.allowCredentials || []).forEach(c => { c.id = b64uToBuf(c.id) })
  return o
}
function credToJSON(cred) {
  const r = cred.response
  const out = {
    id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    authenticatorAttachment: cred.authenticatorAttachment || null,
    response: { clientDataJSON: bufToB64u(r.clientDataJSON) }
  }
  if (r.attestationObject) {
    out.response.attestationObject = bufToB64u(r.attestationObject)
    out.response.transports = r.getTransports ? r.getTransports() : ['internal']
  }
  if (r.authenticatorData) {
    out.response.authenticatorData = bufToB64u(r.authenticatorData)
    out.response.signature = bufToB64u(r.signature)
    out.response.userHandle = r.userHandle ? bufToB64u(r.userHandle) : null
  }
  return out
}
export async function passkeyRegister(name, code) {
  const { cid, options } = await api('/api/register/options', { method: 'POST', body: JSON.stringify({ name, code: code || '' }) })
  const cred = await navigator.credentials.create({ publicKey: toCreationOptions(options) })
  const res = await api('/api/register/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
  return res.user
}
// One passkey ceremony, not yet sent anywhere: /api/login/verify turns it into a sign-in, and
// the account routes take it as proof that the owner is here (#118, #95). `signal` calls the
// prompt off — a sheet that asked for it and was closed meanwhile (components/PasswordAuth.jsx,
// ProveOwner) — which then rejects with an AbortError.
export async function passkeyAssertion({ signal } = {}) {
  const { cid, options } = await api('/api/login/options', { method: 'POST', body: '{}' })
  const cred = await navigator.credentials.get({ publicKey: toRequestOptions(options), ...(signal ? { signal } : {}) })
  return { cid, credential: credToJSON(cred) }
}
export async function passkeyLogin() {
  const res = await api('/api/login/verify', { method: 'POST', body: JSON.stringify(await passkeyAssertion()) })
  return res.user
}
// A creation ceremony on options the server has already handed out: another passkey for a
// signed-in profile, or one made with a code from another device (#95, components/Passkeys.jsx).
// The options come in an earlier step so the prompt opens straight from the tap that asks for it.
// They are copied first — the conversion writes buffers into them, and a prompt dismissed by
// mistake is tried again with the same ones.
export async function createPasskey(options) {
  const cred = await navigator.credentials.create({ publicKey: toCreationOptions(JSON.parse(JSON.stringify(options))) })
  return credToJSON(cred)
}

// Name-and-password sign-in, on an instance that offers it (config.password_login). Each of
// these answers with the same session cookie a passkey sign-in sets, so callers treat the user
// they return exactly alike.
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })
// `name` is whatever was typed in "Name or e-mail": it goes in the original `name` field, which
// the server matches against the profile's sign-in e-mail when it holds an "@" and against the
// name otherwise — so the app and a server a version apart still understand each other.
export async function passwordLogin(name, password) {
  return (await post('/api/login/password', { name, password })).user
}
// `email` is optional, and sent only when there is one: a server from before the field would
// otherwise ignore it without a word, which is the same thing.
export async function passwordRegister(name, password, code, email) {
  return (await post('/api/register/password', { name, password, code: code || '', ...(email ? { email } : {}) })).user
}
export async function passwordResetRedeem(name, code, next) {
  return (await post('/api/login/password-reset', { name, code, next })).user
}
