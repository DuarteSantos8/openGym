// Mobile build only: "connect to my server" mode (see mobile.js's header comment for why the
// mobile flavor has no backend at all by default). This is the alternative — pairing the app to
// an already self-hosted openGym server instead of keeping data device-local.
//
// Passkeys can't be used from inside the app's own WebView (its origin never matches the
// server's RP_ID), so auth here is a short one-time code redeemed from an already signed-in
// browser tab (Settings → "Pair the mobile app") for a bearer token — see api/server.js's
// /api/pair/create + /api/pair/redeem.
import { pairRedeem, setRemoteAuth } from './api.js'
import { loadRemoteFile, saveRemoteFile } from './mobile.js'

// Accepts what someone actually types: bare host, no scheme, trailing slash, stray whitespace.
// Defaults to https:// (self-hosting docs already push for HTTPS; the one exception, localhost,
// still parses fine without a scheme). Returns null for anything that isn't a usable URL at all.
export function normalizeServerUrl(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s
  try {
    const u = new URL(withScheme)
    if (!u.hostname) return null
    return u.origin
  } catch (e) { return null }
}

export async function loadRemote() {
  return loadRemoteFile()
}

export async function chooseLocal() {
  await saveRemoteFile({ mode: 'local' })
}

export async function forgetRemote() {
  await saveRemoteFile({ mode: 'local' })
  setRemoteAuth('', null)
}

// The server renewed the token (GET /api/me hands one out once the old is past half its life):
// every request from now on carries it, and the pairing file keeps it for the next start. The
// old one stays valid until its own expiry, so a write that fails here costs nothing but a
// renewal on a later start.
export async function renewToken(remote, token) {
  setRemoteAuth(remote.base, token)
  await saveRemoteFile({ ...remote, token })
}

// Redeems the pairing code, wires api.js at the resolved base, and persists the connection so
// boot() can restore it on the next launch.
export async function connect(rawUrl, code) {
  const base = normalizeServerUrl(rawUrl)
  if (!base) throw new Error('Enter a valid server address')
  const { token, user } = await pairRedeem(base, String(code || '').trim())
  setRemoteAuth(base, token)
  await saveRemoteFile({ mode: 'remote', base, token, user })
  return user
}
