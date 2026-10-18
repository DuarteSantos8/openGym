// Spotify, for the music bar of a workout (components/MusicBar.jsx): what is playing on the
// account, and play / pause / next / previous on whichever device is playing it.
//
// The Web API, signed in with the authorization-code flow with PKCE: no client secret exists
// anywhere, so neither the server nor the app needs one. The Client ID is the user's own Spotify
// app (developer.spotify.com, one per person or per household), kept in S.spotifyClientId so every
// device of the account finds it; the tokens it buys are this device's and never leave it (they
// sit in localStorage, not in S, which syncs and exports).
//
// The redirect comes back to the page itself in a browser (?code=…&state=…, read at start-up by
// finishSpotify) and to opengym://spotify in the phone app (an app URL, @capacitor/app's
// appUrlOpen). Spotify only accepts https redirect addresses, or a loopback one, for a web page.
import { MOBILE } from '../mobile.js'

const ACCOUNTS = 'https://accounts.spotify.com'
const API = 'https://api.spotify.com/v1'
const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing'
const TOKENS = 'og.spotify'
const PENDING = 'og.spotify.pending'
export const APP_REDIRECT = 'opengym://spotify'

const read = k => { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return null } }
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)) } catch { /* private window */ } }

/** The redirect address to register in the Spotify app, for this device. */
export function redirectUri() {
  if (MOBILE) return APP_REDIRECT
  return location.origin + location.pathname
}

export function spotifyConnected() {
  const t = read(TOKENS)
  return !!(t && t.refresh)
}

export function disconnectSpotify() { write(TOKENS, null); write(PENDING, null) }

const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
function randomString(n) {
  const a = new Uint8Array(n)
  crypto.getRandomValues(a)
  return b64url(a).slice(0, n)
}

/** The sign-in address, with the PKCE verifier and state it needs kept until the way back. */
export async function spotifyAuthUrl(clientId) {
  const verifier = randomString(64)
  const state = randomString(16)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  const redirect = redirectUri()
  write(PENDING, { verifier, state, clientId, redirect })
  const q = new URLSearchParams({
    response_type: 'code', client_id: clientId, scope: SCOPES, redirect_uri: redirect,
    code_challenge_method: 'S256', code_challenge: b64url(digest), state,
  })
  return ACCOUNTS + '/authorize?' + q
}

/**
 * Opens Spotify's sign-in. A browser leaves the page for it; the phone app hands the address to
 * the system browser (Capacitor opens a link to another site there), and comes back by its URL.
 */
export async function connectSpotify(clientId) {
  const url = await spotifyAuthUrl(clientId.trim())
  location.href = url
}

async function tokenRequest(body, fetchFn = fetch) {
  const r = await fetchFn(ACCOUNTS + '/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString(),
  })
  if (!r.ok) throw Object.assign(new Error('token ' + r.status), { status: r.status })
  return r.json()
}

const save = (j, clientId, old) => write(TOKENS, {
  clientId, access: j.access_token, refresh: j.refresh_token || old?.refresh, exp: Date.now() + (j.expires_in ?? 3600) * 1000,
})

/**
 * The way back from the sign-in: the redirect's query (?code=…&state=…), checked against the
 * state this device sent. Returns true when it was ours and the tokens are saved, false when the
 * address is not a Spotify answer at all; throws when it was one and it failed or was refused.
 */
export async function finishSpotify(search, fetchFn = fetch) {
  const q = new URLSearchParams(search)
  if (!q.has('state') || !(q.has('code') || q.has('error'))) return false
  const p = read(PENDING)
  if (!p || p.state !== q.get('state')) return false
  write(PENDING, null)
  if (q.has('error')) throw new Error(q.get('error'))
  const j = await tokenRequest({
    grant_type: 'authorization_code', code: q.get('code'), redirect_uri: p.redirect, client_id: p.clientId, code_verifier: p.verifier,
  }, fetchFn)
  save(j, p.clientId)
  return true
}

async function accessToken(fetchFn, force) {
  const t = read(TOKENS)
  if (!t || !t.refresh) throw Object.assign(new Error('not connected'), { code: 'auth' })
  if (!force && t.access && t.exp - 60000 > Date.now()) return t.access
  try {
    const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: t.clientId }, fetchFn)
    save(j, t.clientId, t)
    return j.access_token
  } catch (e) {
    // A refresh token Spotify no longer knows (revoked, app deleted): sign in again.
    if (e.status === 400 || e.status === 401) { write(TOKENS, null); throw Object.assign(new Error('not connected'), { code: 'auth' }) }
    throw e
  }
}

async function call(method, path, fetchFn) {
  let r
  for (const force of [false, true]) {
    const token = await accessToken(fetchFn, force)
    r = await fetchFn(API + path, { method, headers: { Authorization: 'Bearer ' + token } })
    if (r.status !== 401) break
  }
  return r
}

// What MusicBar shows, the same shape as the Apple Music side (apple-music.js).
export function trackOf(j) {
  if (!j || !j.item) return { playing: !!j?.is_playing, title: '', artist: '', art: '' }
  const it = j.item
  const images = it.album?.images || it.images || it.show?.images || []
  const small = images.length ? images.reduce((a, b) => ((b.width || 0) >= 64 && (b.width || 0) < (a.width || 1e9) ? b : a), images[0]) : null
  return {
    id: it.id || it.uri || it.name,
    playing: !!j.is_playing,
    title: it.name || '',
    artist: (it.artists || []).map(a => a.name).join(', ') || it.show?.name || '',
    art: small ? small.url : '',
  }
}

/** What is playing now, or null when nothing is (no device active). */
export async function spotifyNowPlaying(fetchFn = fetch) {
  const r = await call('GET', '/me/player?additional_types=episode', fetchFn)
  if (r.status === 204) return null
  if (!r.ok) throw errorOf(r)
  return trackOf(await r.json())
}

const ACTIONS = { play: ['PUT', '/me/player/play'], pause: ['PUT', '/me/player/pause'], next: ['POST', '/me/player/next'], previous: ['POST', '/me/player/previous'] }

export async function spotifyControl(action, fetchFn = fetch) {
  const [method, path] = ACTIONS[action]
  const r = await call(method, path, fetchFn)
  if (!r.ok) throw errorOf(r)
}

// 403: the account is not Premium (playback control is Premium only); 404: no device to play on.
function errorOf(r) {
  const code = r.status === 403 ? 'premium' : r.status === 404 ? 'device' : r.status === 429 ? 'busy' : 'failed'
  return Object.assign(new Error('spotify ' + r.status), { code, status: r.status })
}
