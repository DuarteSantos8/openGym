// The music bar of a workout (components/MusicBar.jsx) and the Music rows of Settings → Workout:
// which player S.music names, and one shape for both of them.
//
//   nowPlaying(source)        { id, playing, title, artist, art } or null when nothing plays
//   control(source, action)   'play' | 'pause' | 'next' | 'previous'
//
// Errors carry a `code` MusicBar turns into a sentence: 'auth' (Spotify not connected on this
// device), 'premium', 'device' (no Spotify device playing), 'denied' (no access to Apple Music),
// 'busy' and 'failed'.
import { MOBILE } from '../mobile.js'
import { spotifyNowPlaying, spotifyControl, finishSpotify, APP_REDIRECT } from './spotify.js'
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

export function nowPlaying(source) {
  return source === 'apple' ? appleNowPlaying() : spotifyNowPlaying()
}

export function control(source, action) {
  return source === 'apple' ? appleControl(action) : spotifyControl(action)
}

/**
 * The way back from Spotify's sign-in: the page's own address in a browser (the query is taken
 * off at once, like a device link's), the app's opengym://spotify link on the phone. `done` is
 * told whether it worked.
 */
export function initMusicReturn(done) {
  if (typeof window === 'undefined') return
  const search = window.location.search
  if (/[?&]state=/.test(search)) {
    const u = new URL(window.location.href)
    for (const k of ['code', 'state', 'error']) u.searchParams.delete(k)
    const q = u.searchParams.toString()
    history.replaceState(history.state, '', u.pathname + (q ? '?' + q : '') + u.hash)
    finishSpotify(search).then(ours => { if (ours) done(true) }, () => done(false))
  }
  if (!MOBILE) return
  import('@capacitor/app').then(({ App }) => App.addListener('appUrlOpen', ({ url }) => {
    if (!String(url).startsWith(APP_REDIRECT)) return
    const i = url.indexOf('?')
    finishSpotify(i < 0 ? '' : url.slice(i)).then(ours => { if (ours) done(true) }, () => done(false))
  })).catch(() => {})
}
