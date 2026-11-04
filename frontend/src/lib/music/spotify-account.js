// Spotify on the openGym account (api/music/spotify.js): the instance has a Spotify app of its own
// (SPOTIFY_CLIENT_ID), each profile connects its Spotify account once, and every device signed in
// to it, the phone paired to the server included, steers the music through the server. Nothing to
// set up per device; the tokens never reach the device.
//
// When the instance offers none (or there is no server: a guest, the phone in local mode), the
// device's own Spotify app is the way (spotify.js).
import { api } from '../api.js'
import { MOBILE } from '../mobile.js'
import { spotifyConnected } from './spotify.js'

const MODE = 'og.spotify.mode'
const remember = m => { try { localStorage.setItem(MODE, m) } catch { /* private window */ } }
const recall = () => { try { return localStorage.getItem(MODE) } catch { return null } }

// The server's answer, kept a minute so the bar's every-few-seconds poll does not ask it each time.
let status = null
let statusAt = 0
const FRESH = 60000

export async function accountStatus(force = false) {
  if (!force && status && Date.now() - statusAt < FRESH) return status
  try {
    status = await api('/api/music/spotify')
    statusAt = Date.now()
    remember(status.available ? 'account' : 'device')
  } catch (e) {
    // No account here (signed out, a guest, a phone without a server, a host with no API): for the
    // minute. A server that did not answer is asked again on the next poll, and meanwhile the way
    // this device used last time stands (a device signed in to Spotify on its own still is).
    const none = e && (e.status === 401 || e.status === 404 || e.code === 'not-paired' || e.code === 'bad-response')
    const last = recall()
    if (none) { status = { available: false, connected: false }; remember('device') }
    else if (last === 'device' || (!last && spotifyConnected())) status = { available: false, connected: false }
    else status = { available: false, connected: false, unknown: true }
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
