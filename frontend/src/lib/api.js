// Backend + WebAuthn helpers (ported from the vanilla app).
export const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
export const IS_ANDROID = /Android/.test(navigator.userAgent)
export const BIO = IS_APPLE ? 'Face ID / Touch ID' : IS_ANDROID ? 'fingerprint or face unlock' : 'your fingerprint, face or PIN'
export const VAULT = IS_APPLE ? 'iCloud Keychain' : IS_ANDROID ? 'Google Password Manager' : 'your password manager'
// PublicKeyCredential is the WebAuthn-specific capability signal. Do not also gate the UI on
// navigator.credentials: some browsers expose WebAuthn while that generic Credential Management
// API check produces a false negative (notably Chrome on iOS). The real create/get calls still run
// only after the user chooses a passkey action and surface any genuine browser error there.
export const webauthnOK = () => typeof window.PublicKeyCredential !== 'undefined'

// The paired mobile app (lib/remote.js) is the only caller of these — everywhere else stays on
// same-origin cookies, so remoteBase/remoteToken stay empty and api() behaves exactly as before.
let remoteBase = ''
let remoteToken = null
const assetUrls = new Map()
function clearAssetUrls() {
  for (const url of assetUrls.values()) { try { URL.revokeObjectURL(url) } catch {} }
  assetUrls.clear()
}
export function setRemoteAuth(base, token) {
  const nextBase = String(base || '').replace(/\/+$/, '')
  const nextToken = token || null
  if (nextBase !== remoteBase || nextToken !== remoteToken) clearAssetUrls()
  remoteBase = nextBase
  remoteToken = nextToken
  // Exercise renderers are deliberately kept Node-safe and cannot import this module (it reads
  // browser globals). A tiny global bridge lets a paired mobile WebView resolve private image
  // paths against the same remote API while the desktop app continues to use same-origin URLs.
  globalThis.__opengymRemoteBase = remoteBase
  globalThis.__opengymRemoteAssetVersion = (globalThis.__opengymRemoteAssetVersion || 0) + 1
}

// Custom images are private API resources. Desktop same-origin renders can use the relative path
// directly; a paired mobile WebView has to fetch the bytes with its scoped bearer and render a
// short-lived object URL instead. Tokens never appear in a URL or an <img> attribute.
export async function assetObjectUrl(id) {
  const path = '/api/assets/' + encodeURIComponent(String(id || ''))
  if (!remoteToken) return path
  const cacheKey = remoteBase + '|' + id
  if (assetUrls.has(cacheKey)) return assetUrls.get(cacheKey)
  const response = await fetch(remoteBase + path, { headers: { Authorization: 'Bearer ' + remoteToken, Accept: 'image/*' } })
  if (!response.ok) throw new Error('private image unavailable')
  const url = URL.createObjectURL(await response.blob())
  assetUrls.set(cacheKey, url)
  return url
}

export async function api(path, opts) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts && opts.headers)
  if (remoteToken) headers.Authorization = 'Bearer ' + remoteToken
  const r = await fetch(remoteBase + path, Object.assign({}, opts, { headers }))
  const data = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(data.error || ('HTTP ' + r.status)); e.status = r.status; throw e }
  return data
}

// Bootstraps the connection itself: the base isn't configured yet (that's what this call decides),
// so it talks straight to the server the user typed in, no Authorization header.
export async function pairRedeem(serverBase, code) {
  const r = await fetch(serverBase + '/api/pair/redeem', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code })
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(data.error || ('HTTP ' + r.status)); e.status = r.status; throw e }
  return data
}

// Custom-exercise images are sent as bounded base64 JSON so the same authenticated API works in
// the browser and the Capacitor WebView. The API validates the MIME signature and size before it
// writes an immutable asset; the exercise reference is attached only after this call succeeds.
export async function uploadAsset(file) {
  if (!file) throw new Error('image required')
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return api('/api/assets', {
    method: 'POST',
    body: JSON.stringify({ mime: file.type, data: btoa(binary) })
  })
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
export async function passkeyLogin() {
  const { cid, options } = await api('/api/login/options', { method: 'POST', body: '{}' })
  const cred = await navigator.credentials.get({ publicKey: toRequestOptions(options) })
  const res = await api('/api/login/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
  return res.user
}
