// Apple Music, for the music bar of a workout: the Music app's player on the iPhone, through the
// app's own MusicPlayer plugin (ios/App/App/MusicPlayerPlugin.swift, MPMusicPlayerController's
// system player). Only the iPhone app has it: a web page cannot see or steer the Music app.
import { MOBILE } from '../mobile.js'

let plugin = null
async function MP() {
  if (!MOBILE) return null
  if (plugin) return plugin
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core')
    if (Capacitor.getPlatform() !== 'ios') return null
    plugin = registerPlugin('MusicPlayer')
    return plugin
  } catch { return null }
}

/** Whether this device can steer Apple Music: the iPhone app. */
export async function appleMusicAvailable() { return !!(await MP()) }

/** Asks for access to the media library, which the title of what plays needs. */
export async function authorizeAppleMusic() {
  const p = await MP()
  if (!p) return false
  const r = await p.authorize()
  return !!r.granted
}

// The artwork comes along only when the song changed (`known`), so a poll every few seconds does
// not carry the same picture across the bridge each time.
let last = { id: '', art: '' }
export async function appleNowPlaying() {
  const p = await MP()
  if (!p) throw Object.assign(new Error('unavailable'), { code: 'failed' })
  const r = await p.nowPlaying({ known: last.id })
  if (r.authorized === false) throw Object.assign(new Error('not allowed'), { code: 'denied' })
  if (!r.id) return r.playing ? { playing: true, title: '', artist: '', art: '' } : null
  if (r.id !== last.id) last = { id: r.id, art: r.artwork || '' }
  return { id: r.id, playing: !!r.playing, title: r.title || '', artist: r.artist || '', art: last.art }
}

export async function appleControl(action) {
  const p = await MP()
  if (!p) throw Object.assign(new Error('unavailable'), { code: 'failed' })
  await p[action]()
}
