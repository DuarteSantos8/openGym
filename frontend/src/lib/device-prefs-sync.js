// The settings that used to live on one device only, now in the profile too, so a second phone or
// the web app signed in to the same server picks them up (owner, 2026-11-23: "always save all
// settings to the server so it's used when logged in on a different device").
//
//   S.prefs = { display: { motion, text }, voice }
//
// Each stays cached in localStorage as before (display prefs must apply before the first render,
// main.jsx), and the profile is the one truth across devices: a change here writes both, and a
// profile that arrives with other values (synced from another device) is applied here.
// A voice another platform picked that this one does not have plays the default voice, as before.
// Left on the device on purpose: the Live Activity master switch ("Off on this phone", one
// phone can have it off while the others keep it), what was read from Health Connect or Apple Health (it never
// leaves the phone, privacy page), the server pairing, the animation packs downloaded here.
import { readDisplay, applyDisplay } from './display-prefs.js'
import { pickedVoice, setPickedVoice } from './speech.js'

const DEFAULT = { display: { motion: 'system', text: 'default' }, voice: '' }
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)

export const localPrefs = () => ({ display: readDisplay(), voice: pickedVoice() })

/** The profile's prefs, cleaned, or null when the profile has none yet. */
export function prefsOf(S) {
  const p = S?.prefs
  if (!isMap(p)) return null
  const d = isMap(p.display) ? p.display : {}
  return {
    display: { motion: d.motion === 'less' ? 'less' : 'system', text: typeof d.text === 'string' ? d.text : 'default' },
    voice: typeof p.voice === 'string' ? p.voice : '',
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
  if (!remote) {
    if (same(local, DEFAULT)) return 'same'
    update(s => { s.prefs = local })
    return 'pushed'
  }
  if (same(remote, local)) return 'same'
  if (!same(remote.display, local.display)) applyDisplay(readDisplayLike(remote.display), { save: true })
  if (remote.voice !== local.voice) setPickedVoice(remote.voice)
  return 'applied'
}

// readDisplay's own cleaning, for a value that came from the profile.
function readDisplayLike(d) {
  const now = readDisplay()
  return { motion: d.motion === 'less' ? 'less' : 'system', text: d.text in TEXT_OK ? d.text : now.text }
}
const TEXT_OK = { smallest: 1, small: 1, default: 1, large: 1, larger: 1, largest: 1 }

/** After a change on this device: the profile gets this device's prefs (with `patch` on top). */
export function savePrefs(update, patch = {}) {
  update(s => { s.prefs = { ...localPrefs(), ...patch } })
}
