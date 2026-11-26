// What's new after an update, and the nudge that one is out (v1.4.6, the owner's idea).
//
// The notes travel inside the app, per version, through t(): an update brings its own words in
// every language and needs nothing from a server. Which version this device last saw is kept on
// the device (localStorage), not in the synced profile: a phone and a browser update apart, and
// each should say it once.
//
// Who sees the sheet: a device that ran an older version (it says so), or one from before this
// existed that already has workouts (an upgrade from 1.4.5). A fresh install has nothing to
// compare with and just notes the version.
import { t } from './i18n.js'
import { compareSemver } from './update.js'

const SEEN_KEY = 'gym_seen_version'
const NUDGE_KEY = 'gym_update_nudged'
const DAY_MS = 24 * 3600 * 1000

/** The top changes of a version, as { icon, text } rows. Functions, so t() reads the language
 *  at the moment the sheet opens. */
export const NOTES = {
  '1.4.6': () => [
    { icon: 'snowflake', text: t('Shake your phone in December and the snow goes wild, like a snow globe.') },
    { icon: 'dumbbell', text: t('Workouts open on the dumbbells you own. No more 30 kg when your rack stops at 28.') },
    { icon: 'pencil', text: t('Log a past workout by typing it out, the way it sits in your notes.') },
    { icon: 'flame', text: t('Your own warm-up ramp: set it once in Settings, every warm-up follows it.') },
    { icon: 'watch', text: t('Your watch asks a quick check-in before you start and hands you a medal at the end.') },
  ],
}

const base = v => String(v || '').replace(/^v/, '').split('+')[0].split('-')[0]
/** The notes for a version, or null when it has none. */
export const notesFor = version => (NOTES[base(version)] ? NOTES[base(version)]() : null)
/** The version whose notes Settings → About shows: this one, or the newest one before it that
 *  has notes (a patch without its own), or the newest of all on a build that names no version. */
export function latestNoted(version) {
  const all = Object.keys(NOTES).sort((a, b) => compareSemver(b, a))
  const v = base(version)
  if (NOTES[v]) return v
  return all.find(k => /^\d/.test(v) && compareSemver(k, v) <= 0) || all[0]
}

const read = (store, k) => { try { return store?.getItem(k) ?? null } catch { return null } }
const write = (store, k, v) => { try { store?.setItem(k, v) } catch { /* shown again next time, at worst */ } }
const storage = () => (typeof localStorage !== 'undefined' ? localStorage : null)

/**
 * Whether this start should show What's new for `version`, and it notes the version either way.
 * `S` is the profile: with no version seen before, workouts in it mean an upgrade.
 */
export function takeWhatsNew(S, version, store = storage()) {
  const v = base(version)
  if (!v || v === 'test') return false
  const seen = read(store, SEEN_KEY)
  if (seen && compareSemver(v, seen) <= 0) return false
  write(store, SEEN_KEY, v)
  if (!NOTES[v]) return false
  if (seen) return true
  return (S?.workouts?.length || 0) > 0
}

/**
 * Whether to say that `latest` is out: only a newer version, at most once a day, and a version
 * that was already mentioned is not mentioned again. Notes it when it says yes.
 */
export function takeUpdateNudge(latest, current, now = Date.now(), store = storage()) {
  const v = base(latest)
  if (!v || compareSemver(v, base(current)) <= 0) return false
  let last = null
  try { last = JSON.parse(read(store, NUDGE_KEY) || 'null') } catch { last = null }
  if (last?.v === v) return false
  if (Number.isFinite(last?.at) && now - last.at < DAY_MS) return false
  write(store, NUDGE_KEY, JSON.stringify({ v, at: now }))
  return true
}
