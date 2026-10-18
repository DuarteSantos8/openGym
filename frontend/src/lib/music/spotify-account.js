// Spotify on the openGym account (api/music/spotify.js): the instance has a Spotify app of its own
// (SPOTIFY_CLIENT_ID), each profile connects its Spotify account once, and every device signed in
// to it, the phone paired to the server included, steers the music through the server. Nothing to
// set up per device; the tokens never reach the device.
//
// When the instance offers none (or there is no server: a guest, the phone in local mode), the
// device's own Spotify app is the way (spotify.js).
import { api } from '../api.js'
import { MOBILE } from '../mobile.js'

// The server's answer, kept a minute so the bar's every-few-seconds poll does not ask it each time.
let status = null
let statusAt = 0
const FRESH = 60000

export async function accountStatus(force = false) {
  if (!force && status && Date.now() - statusAt < FRESH) return status
  try {
    status = await api('/api/music/spotify')
    statusAt = Date.now()
  } catch (e) {
    // No account here (signed out, a guest, a phone without a server): for the minute. A server
    // that did not answer is asked again on the next poll, not taken as "no Spotify here".
    const none = e && (e.status === 401 || e.status === 404 || e.code === 'not-paired')
    status = none ? { available: false, connected: false } : { available: false, connected: false, unknown: true }
    statusAt = none ? Date.now() : 0
  }
  return status
}

export function forgetAccountStatus() { status = null; statusAt = 0 }

/** Spotify's sign-in, for this profile: back to this page in a browser, to the app on the phone. */
export async function connectAccount() {
  const back = MOBILE ? undefined : location.origin + location.pathname
  const { url } = await api('/api/music/spotify/connect', { method: 'POST', body: JSON.stringify(MOBILE ? { app: true } : { back }) })
  forgetAccountStatus()
  location.href = url
}

export async function disconnectAccount() {
  await api('/api/music/spotify', { method: 'DELETE' })
  forgetAccountStatus()
}

const codeOf = e => Object.assign(new Error(e.message), { code: e.data?.code || (e.status === 409 ? 'auth' : 'failed'), status: e.status })

export async function accountNowPlaying() {
  try {
    return (await api('/api/music/spotify/player')).track
  } catch (e) {
    const err = codeOf(e)
    if (err.code === 'auth') forgetAccountStatus()
    throw err
  }
}

export async function accountControl(action) {
  try {
    await api('/api/music/spotify/player', { method: 'POST', body: JSON.stringify({ action }) })
  } catch (e) { throw codeOf(e) }
}
