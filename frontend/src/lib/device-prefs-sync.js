// The settings that used to live on one device only, now in the profile too, so a second phone or
// the web app signed in to the same server picks them up (owner, 2026-11-23: "always save all
// settings to the server so it's used when logged in on a different device").
//
//   S.prefs = { display: { motion, text }, voice: { android?, ios?, web? } }
//
// Each stays cached in localStorage as before (display prefs must apply before the first render,
// main.jsx), and the profile is the one truth across devices: a change here writes both, and a
// profile that arrives with other values (synced from another device) is applied here.
// The voice is kept per platform: an iPhone's voices are not Android's or a browser's, so a pick on
// one never changes (or blanks) the others (review 1.4.6).
// Left on the device on purpose: the Live Activity master switch ("Off on this phone", one
// phone can have it off while the others keep it), what was read from Health Connect or Apple Health (it never
// leaves the phone, privacy page), the server pairing, the animation packs downloaded here.
import { readDisplay, applyDisplay } from './display-prefs.js'
import { pickedVoice, setPickedVoice } from './speech.js'

const DEFAULT_DISPLAY = { motion: 'system', text: 'default' }
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)

/** 'android', 'ios' or 'web': whose voices this device has. */
export function platform() {
  try {
    const p = globalThis.Capacitor?.getPlatform?.()
    return p === 'android' || p === 'ios' ? p : 'web'
  } catch { return 'web' }
}
const VOICE_KEYS = ['android', 'ios', 'web']
const voicesOf = v => (isMap(v) ? Object.fromEntries(VOICE_KEYS.filter(k => typeof v[k] === 'string' && v[k]).map(k => [k, v[k]])) : {})

export const localPrefs = () => ({ display: readDisplay(), voice: pickedVoice() })

/** The profile's prefs, cleaned, or null when the profile has none yet. */
export function prefsOf(S) {
  const p = S?.prefs
  if (!isMap(p)) return null
  const d = isMap(p.display) ? p.display : {}
  return {
    display: { motion: d.motion === 'less' ? 'less' : 'system', text: typeof d.text === 'string' ? d.text : 'default' },
    voice: voicesOf(p.voice),
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Called whenever the profile's prefs may have changed (App.jsx). A profile without prefs takes
 * this device's, if they are not the defaults; a profile with prefs is applied here.
 * Returns what happened, for the tests: 'pushed', 'applied' or 'same'.
 */
export function syncPrefs(S, update) {
  const remote = prefsOf(S)
  const local = localPrefs()
  const me = platform()
  if (!remote) {
    if (same(local.display, DEFAULT_DISPLAY) && !local.voice) return 'same'
    update(s => { s.prefs = { display: local.display, voice: local.voice ? { [me]: local.voice } : {} } })
    return 'pushed'
  }
  let did = 'same'
  if (!same(remote.display, local.display)) { applyDisplay(readDisplayLike(remote.display), { save: true }); did = 'applied' }
  const theirs = remote.voice[me]
  if (theirs != null && theirs !== local.voice) { setPickedVoice(theirs); did = 'applied' }
  // A voice picked here before the profile had one for this platform goes up.
  if (theirs == null && local.voice) { update(s => { s.prefs = { ...remote, voice: { ...remote.voice, [me]: local.voice } } }); did = did === 'same' ? 'pushed' : did }
  return did
}

// readDisplay's own cleaning, for a value that came from the profile.
function readDisplayLike(d) {
  const now = readDisplay()
  return { motion: d.motion === 'less' ? 'less' : 'system', text: d.text in TEXT_OK ? d.text : now.text }
}
const TEXT_OK = { smallest: 1, small: 1, default: 1, large: 1, larger: 1, largest: 1 }

/** After a change on this device: the profile gets this device's display and its platform's voice. */
export function savePrefs(update) {
  const local = localPrefs(), me = platform()
  update(s => {
    const was = prefsOf(s)
    const voice = { ...(was?.voice || {}) }
    if (local.voice) voice[me] = local.voice; else delete voice[me]
    s.prefs = { display: local.display, voice }
  })
}
