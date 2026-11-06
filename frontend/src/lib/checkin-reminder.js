// Check-in reminders (gm-journal): "measure your waist every 14 days, a progress photo every 4
// weeks, in the morning". One reminder per thing you track, all of them bundled into one
// notification on a day where any is due, never one ping per tape measure.
//
//   S.checkinReminder = { on, time: 'HH:MM', tz, items: { '<key>': { every: <days>, since: 'YYYY-MM-DD' } } }
//
// A key is 'weight' (a weigh-in), 'photos' (a progress photo, on a workout or filed under a day),
// a measurement's key ('waist', 'other:<id>') or BP_KEY for blood pressure. An item is due once
// `every` days have gone by since you last logged it (or since the reminder was set, for something
// never logged yet); while it stays undone it comes back every few days rather than every day.
// Logging it resets the count, which is all "done" means here: there is nothing to tick off.
//
// Where it goes off: on the phones as local notifications, queued by lib/mobile.js syncReminder
// for the coming weeks and requeued after every save (so logging drops a queued one); in a browser
// signed in to a server, as a web push from the server's reminder tick, which needs the browser's
// push switch (Settings → Notifications). The server reads the same rule from api/checkin-reminder.js,
// a hand copy of dueKinds below (the api image has no frontend): change both together, the tests
// mirror each other (lib/checkin-reminder.test.js, api/test/checkin-reminder.test.js).
import { measurementValue, MEASUREMENT_FIELDS, BP_KEY } from './measurements.js'
import { workoutMediaOf, normalizeMediaRef } from './media-refs.js'

export const DEFAULT_TIME = '07:30'
export const EVERY_CHOICES = [7, 14, 28]
export const DEFAULT_EVERY = 14
export const EVERY_MAX = 90
// How often an item that stays undone comes back after its day: at most this many days apart.
export const OVERDUE_EVERY = 3
export const CHECKIN_WINDOW_DAYS = 60
export const CHECKIN_ID_BASE = 4000

// The notification's words: the English source strings (translated in the locale packs, and copied
// for the server's web push into api/checkin-copy.js by api/scripts/build-checkin-copy.mjs).
export const CHECKIN_PUSH = {
  title: 'Check-in time',
  measure: 'Your check-in is due. A few numbers, two minutes, then on with your day.',
  photos: 'Progress photo day. Same spot, same light, same proud face.',
  both: 'Check-in and progress photo are due. Five minutes, tops.',
}

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const ISO = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const dayNum = iso => Math.round(new Date(iso + 'T12:00:00Z').getTime() / 86400000)

/** The settings as kept, with defaults: { on, time, tz?, items }. */
export function reminderOf(S) {
  const r = isMap(S?.checkinReminder) ? S.checkinReminder : {}
  const items = {}
  for (const [k, v] of Object.entries(isMap(r.items) ? r.items : {})) {
    const every = Math.round(Number(v?.every))
    if (!k || !(every >= 1)) continue
    items[k] = { every: Math.min(EVERY_MAX, every), ...(ISO.test(String(v.since || '')) ? { since: v.since } : {}) }
  }
  return { on: r.on === true, time: TIME.test(String(r.time || '')) ? r.time : DEFAULT_TIME, ...(typeof r.tz === 'string' && r.tz ? { tz: r.tz } : {}), items }
}

/** The last day `key` was logged on or before `iso`, or null. */
export function lastLogged(S, key, iso = '9999-12-31') {
  let last = null
  const see = d => { if (ISO.test(String(d || '')) && d <= iso && (!last || d > last)) last = d }
  if (key === 'weight') {
    for (const b of Array.isArray(S?.bodyweight) ? S.bodyweight : []) if (b && b.w > 0) see(b.d)
  } else if (key === 'photos') {
    // Read straight from S.dayPhotos (lib/day-photos.js), a cleared entry has no `m`.
    for (const p of Object.values(isMap(S?.dayPhotos) ? S.dayPhotos : {})) if (isMap(p) && normalizeMediaRef(p.m)) see(p.d)
    for (const w of Array.isArray(S?.workouts) ? S.workouts : []) if (workoutMediaOf(w, Infinity).some(m => m.kind === 'image')) see(w?.d)
  } else {
    const k = key === BP_KEY ? 'bpSys' : key
    for (const e of Array.isArray(S?.measurements) ? S.measurements : []) if (measurementValue(e, k) != null) see(e?.d)
  }
  return last
}

/** Whether one item is due on `iso`, given when it was last logged. */
export function itemDue(item, last, iso) {
  const anchor = last && (!item.since || last > item.since) ? last : (item.since || last)
  if (!anchor) return true
  const days = dayNum(iso) - dayNum(anchor)
  if (days < item.every) return false
  return (days - item.every) % Math.min(item.every, OVERDUE_EVERY) === 0
}

/** The keys due on `iso` (none with the reminder off). */
export function dueKeys(S, iso) {
  const r = reminderOf(S)
  if (!r.on) return []
  return Object.entries(r.items).filter(([k, item]) => itemDue(item, lastLogged(S, k, iso), iso)).map(([k]) => k)
}

/** What the day's one notification is about: 'measure', 'photos', 'both' or null. */
export function dueKind(keys) {
  const photos = keys.includes('photos'), measure = keys.some(k => k !== 'photos')
  return photos && measure ? 'both' : photos ? 'photos' : measure ? 'measure' : null
}

/**
 * The local notifications for the coming CHECKIN_WINDOW_DAYS: one per day that has something due,
 * at the reminder's time, none for a time already gone today. `names(keys)` gives the line that
 * says what (the phone has the labels in the app's language). `t` translates.
 */
export function buildCheckinNotifications(S, { now = new Date(), t = s => s, names = null } = {}) {
  const r = reminderOf(S)
  if (!r.on || !Object.keys(r.items).length) return []
  const [hour, minute] = r.time.split(':').map(Number)
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
  const out = []
  for (let offset = 0; offset < CHECKIN_WINDOW_DAYS; offset++) {
    const day = new Date(base)
    day.setDate(base.getDate() + offset)
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    const keys = dueKeys(S, iso)
    const kind = dueKind(keys)
    if (!kind) continue
    const at = new Date(day)
    at.setHours(hour, minute, 0, 0)
    if (at <= now) continue
    const what = names ? names(keys) : ''
    out.push({
      id: CHECKIN_ID_BASE + offset,
      title: t(CHECKIN_PUSH.title),
      body: what ? t(CHECKIN_PUSH[kind]) + ' ' + what : t(CHECKIN_PUSH[kind]),
      schedule: { at, allowWhileIdle: true },
    })
  }
  return out
}

/** S.checkinReminder with `patch` merged in (items replaced whole when given). */
export function withReminder(S, patch) {
  const cur = reminderOf(S)
  return { ...cur, ...patch, items: patch.items ? patch.items : cur.items }
}

/** What a key reads as, in the app's language: 'Waist', 'Blood pressure', 'Progress photo'. */
export function checkinLabel(S, key, t = s => s) {
  if (key === 'weight') return t('Body weight')
  if (key === 'photos') return t('Progress photo')
  if (key === BP_KEY) return t('Blood pressure')
  if (key.startsWith('other:')) return (Array.isArray(S?.customMeasurements) ? S.customMeasurements : []).find(c => c?.id === key.slice(6))?.name || null
  const f = MEASUREMENT_FIELDS.find(x => x.key === key)
  return f ? t(f.label) : null
}

/** The line that says what is due: "Waist, Body weight, Progress photo." */
export function checkinNames(S, keys, t = s => s) {
  const names = keys.map(k => checkinLabel(S, k, t)).filter(Boolean)
  return names.length ? names.join(', ') + '.' : ''
}
