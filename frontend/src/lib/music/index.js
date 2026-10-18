// The music bar of a workout (components/MusicBar.jsx) and the Music rows of Settings → Workout:
// which player S.music names, and one shape for all of them.
//
//   nowPlaying(source)        { id, playing, title, artist, art } or null when nothing plays
//   control(source, action)   'play' | 'pause' | 'next' | 'previous'
//
// Spotify goes through the openGym account when the instance offers it (spotify-account.js: the
// server holds the connection, every signed-in device steers it), and otherwise through a Spotify
// app of the person's own on this device (spotify.js).
//
// Errors carry a `code` MusicBar turns into a sentence: 'auth' (Spotify not connected), 'premium',
// 'device' (no Spotify device playing), 'denied' (no access to Apple Music), 'busy' and 'failed'.
import { MOBILE } from '../mobile.js'
import { spotifyNowPlaying, spotifyControl, finishSpotify, APP_REDIRECT } from './spotify.js'
import { accountStatus, accountNowPlaying, accountControl, forgetAccountStatus } from './spotify-account.js'
import { appleNowPlaying, appleControl } from './apple-music.js'

export const SOURCES = ['spotify', 'apple']

/** Whether the Music app can be steered from here: the iPhone app only. */
export function appleMusicDevice() {
  return MOBILE && typeof window !== 'undefined' && window.Capacitor?.getPlatform?.() === 'ios'
}

/** The player this device shows, or '' for none: a choice this device cannot use reads as off. */
export function musicSource(S) {
  if (S.music === 'spotify') return 'spotify'
  if (S.music === 'apple' && appleMusicDevice()) return 'apple'
  return ''
}

const notConnected = () => Object.assign(new Error('not connected'), { code: 'auth' })
const noAnswer = () => Object.assign(new Error('no answer'), { code: 'failed' })

export async function nowPlaying(source) {
  if (source === 'apple') return appleNowPlaying()
  const acct = await accountStatus()
  if (acct.unknown) throw noAnswer()
  if (acct.available) {
    if (!acct.connected) throw notConnected()
    return accountNowPlaying()
  }
  return spotifyNowPlaying()
}

export async function control(source, action) {
  if (source === 'apple') return appleControl(action)
  const acct = await accountStatus()
  if (acct.unknown) throw noAnswer()
  if (acct.available) {
    if (!acct.connected) throw notConnected()
    return accountControl(action)
  }
  return spotifyControl(action)
}

/**
 * The way back from Spotify's sign-in, either kind: the page's own address in a browser (the query
 * is taken off at once, like a device link's), the app's opengym://spotify link on the phone.
 * `done` is told whether it worked.
 */
export function initMusicReturn(done) {
  if (typeof window === 'undefined') return
  const search = window.location.search
  const q = new URLSearchParams(search)
  const strip = keys => {
    const u = new URL(window.location.href)
    for (const k of keys) u.searchParams.delete(k)
    const rest = u.searchParams.toString()
    history.replaceState(history.state, '', u.pathname + (rest ? '?' + rest : '') + u.hash)
  }
  // Back from the account's sign-in (the server's callback sent the browser here).
  if (q.has('spotify')) {
    strip(['spotify'])
    forgetAccountStatus()
    done(q.get('spotify') === 'connected')
  } else if (q.has('state') && (q.has('code') || q.has('error'))) {
    // Back from this device's own Spotify app.
    strip(['code', 'state', 'error'])
    finishSpotify(search).then(ours => { if (ours) done(true) }, () => done(false))
  }
  if (!MOBILE) return
  import('@capacitor/app').then(({ App }) => App.addListener('appUrlOpen', ({ url }) => {
    if (!String(url).startsWith(APP_REDIRECT)) return
    const i = url.indexOf('?')
    const back = new URLSearchParams(i < 0 ? '' : url.slice(i))
    if (back.has('connected') || back.has('failed')) { forgetAccountStatus(); done(back.has('connected')); return }
    finishSpotify(i < 0 ? '' : url.slice(i)).then(ours => { if (ours) done(true) }, () => done(false))
  })).catch(() => {})
}
