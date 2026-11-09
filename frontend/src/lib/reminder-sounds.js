// A sound for each kind of reminder (v1.4.5, Settings → Reminders → Sounds): the workout day and
// its missed-day nudge, the check-in (weigh-in, measurements, progress photo) and the gym
// reminder, each with the phone's default, one of the phone's own sounds, one of the timer's
// built-in tones, a sound of one's own (lib/user-sounds.js) or none at all.
//
//   S.reminderSounds = { workout?, checkin?, gym? }, each one of
//     { tone: 'none' }                    silent (the notification still shows)
//     { tone: 'chime' | 'bell' | ... }    a built-in tone (lib/rest-sounds.js REST_SOUNDS)
//     { tone: 'u:<id>' }                  a sound of one's own, by its id in S.sounds
//     { tone: 'sys', uri, name }          one of the phone's sounds (Android's sound picker)
//   A kind not in the map rings with the phone's default notification sound, as before 1.4.5.
//
// The phone plays a reminder while the app sleeps, so the sound has to be the notification's.
// Android 8 and up ties the sound to a notification channel, which cannot change once made: each
// choice is a channel of its own (ReminderSoundPlugin.java, ReminderSounds.java), asked for here
// and named on every notification of the kind (lib/mobile.js syncReminder, lib/gym-reminder.js).
// It syncs as one settings field; a phone sound picked on one phone means nothing on another, so
// the other phone falls back to its default (the address does not resolve there).
// The iPhone keeps its default sound for now: iOS only plays sounds shipped inside the app.
import { soundsOf } from './user-sounds.js'
import { REST_SOUNDS } from './rest-sounds.js'
import { t } from './i18n-core.js'

export const REMINDER_KINDS = ['workout', 'checkin', 'gym']
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)

/** What `kind` is set to, cleaned: one of the shapes above, or null for the phone's default. */
export function reminderSoundOf(S, kind) {
  if (!REMINDER_KINDS.includes(kind)) return null
  const v = isMap(S?.reminderSounds) ? S.reminderSounds[kind] : null
  if (!isMap(v) || typeof v.tone !== 'string') return null
  if (v.tone === 'none') return { tone: 'none' }
  if (v.tone === 'sys') return typeof v.uri === 'string' && /^(content|android\.resource|file):\/\//.test(v.uri) ? { tone: 'sys', uri: v.uri, name: String(v.name || '').slice(0, 80) } : null
  if (v.tone.startsWith('u:')) return soundsOf(S).some(e => 'u:' + e.id === v.tone) ? { tone: v.tone } : null
  return Object.hasOwn(REST_SOUNDS, v.tone) ? { tone: v.tone } : null
}

/** Sets `kind` on a store draft; null goes back to the phone's default. */
export function setReminderSound(s, kind, choice) {
  if (!REMINDER_KINDS.includes(kind)) return
  const map = { ...(isMap(s.reminderSounds) ? s.reminderSounds : {}) }
  if (!choice) delete map[kind]
  else map[kind] = choice.tone === 'sys' ? { tone: 'sys', uri: choice.uri, name: choice.name || '' } : { tone: choice.tone }
  if (Object.keys(map).length) s.reminderSounds = map; else delete s.reminderSounds
}

// The channel's name and description in the system's notification settings, in the app's language.
const CHANNEL_COPY = {
  workout: () => [t('Workout reminders'), t('Workout days and the nudge when one slips by.')],
  checkin: () => [t('Check-in reminders'), t('Weigh-ins, measurements and progress photos.')],
  gym: () => [t('Gym reminder'), t('When you walk into your gym.')],
}

/**
 * What the native side needs for `kind`'s channel, or null for the phone's default (no channel of
 * our own). A sound of one's own goes by its file's hash, which is how the phone finds the file.
 */
export function channelSpec(S, kind) {
  const c = reminderSoundOf(S, kind)
  if (!c) return null
  const [name, description] = CHANNEL_COPY[kind]()
  if (c.tone.startsWith('u:')) {
    const own = soundsOf(S).find(e => 'u:' + e.id === c.tone)
    if (!own?.m?.hash) return null
    return { kind, tone: 'u:' + own.m.hash, name, description }
  }
  return { kind, tone: c.tone, ...(c.tone === 'sys' ? { uri: c.uri } : {}), name, description }
}

// The plugin, inside an object (a Capacitor plugin proxy answers `then`, #42). Android only.
let pluginP = null
const plugin = () => pluginP || (pluginP = (async () => {
  const { Capacitor, registerPlugin } = await import('@capacitor/core')
  if (Capacitor.getPlatform() !== 'android') return null
  return { ReminderSound: registerPlugin('ReminderSound') }
})().catch(() => null))

/** Whether this phone can give reminders their own sounds (the Android app). */
export async function reminderSoundsBuilt() {
  return !!(await plugin())
}

// One channel per choice, asked once per run: the plugin answers from the system the second time
// anyway, but syncReminder runs after every save.
const made = new Map()
let lastByKind = {}

/**
 * The channel id `kind`'s notifications go on, or null for the default one. Makes the channel the
 * first time; when the choice went back to default, takes our channels of that kind away again.
 */
export async function reminderChannel(S, kind) {
  const p = await plugin()
  if (!p) return null
  const spec = channelSpec(S, kind)
  const key = spec ? JSON.stringify(spec) : null
  try {
    if (!spec) {
      if (lastByKind[kind] !== null) { lastByKind[kind] = null; await p.ReminderSound.reset({ kind }) }
      return null
    }
    lastByKind[kind] = key
    if (made.has(key)) return made.get(key)
    const r = await p.ReminderSound.channel(spec)
    const id = typeof r?.channelId === 'string' && r.channelId ? r.channelId : null
    made.set(key, id)
    return id
  } catch {
    return null   // a sound that cannot be read: the default channel still rings
  }
}

/** Android's sound picker: { uri, name } or null when nothing was picked. */
export async function pickPhoneSound(current = null) {
  const p = await plugin()
  if (!p) return null
  try {
    const r = await p.ReminderSound.pick(current ? { uri: current } : {})
    return r?.uri ? { uri: r.uri, name: r.title || '' } : null
  } catch { return null }
}

/** Plays one of the phone's sounds once (null: the default notification sound). */
export async function previewPhoneSound(uri = null) {
  const p = await plugin()
  if (!p) return
  try { await p.ReminderSound.preview(uri ? { uri } : {}) } catch { /* the sound is gone */ }
}

export function _resetReminderSounds() { pluginP = null; made.clear(); lastByKind = {} }
