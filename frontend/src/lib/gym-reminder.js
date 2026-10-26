// Gym reminder (#614): a nudge when you walk into your gym, so you never forget to hit Start.
//
// Phone app only. The gyms are places on a map with a radius; the phone itself watches them
// (iOS: CLLocationManager region monitoring, ios/App/App/GymReminderPlugin.swift; Android: the
// platform's proximity alerts, no Google Play Services, android/.../GymReminderPlugin.java) and
// posts the notification on its own, with the app closed. Nothing here ever reaches the server:
// the places live only in the native side's own storage (kept out of device backups too), never
// in the synced state `S`, never in a backup file; the page keeps just an on/off flag.
//
// The no-nag rules are decided by the native side when a gym is entered, since the page is not
// running then. The page hands it what it needs to know (skipReason below spells out the rule the
// native code follows): when you last trained, whether a session is running, a day note that
// excuses today, and the notification text in the app's language.
import { MOBILE } from './mobile.js'
import { t } from './i18n-core.js'
import { isoOf } from './format.js'
import { excusedOn } from './day-notes.js'
import { remoteAuth } from './api.js'

export const GYM_KEY = 'gym_reminder_v1'
export const RADIUS = Object.freeze({ min: 50, max: 500, def: 100, step: 10 })
// iOS watches at most 20 regions per app; Android has no such cap, but one rule for both.
export const MAX_GYMS = 20
export const DEFAULT_WINDOW = Object.freeze({ from: '06:00', to: '22:00' })
export const DEFAULTS = Object.freeze({ on: false, gyms: [], window: null })
// A running session older than this is one that was never finished, not one in progress: it does
// not keep the reminder quiet forever.
export const ACTIVE_FRESH_MS = 12 * 3600 * 1000
// The id the notification carries (iOS: its identifier, so a tap is told apart from the others).
export const NOTIFICATION_ID = 3000

export const clampRadius = r => {
  const n = Math.round(Number(r))
  if (!Number.isFinite(n)) return RADIUS.def
  return Math.min(RADIUS.max, Math.max(RADIUS.min, n))
}

export const validLatLng = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0)

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/
export const minuteOf = hhmm => {
  const m = TIME.exec(String(hhmm || ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const round6 = n => Math.round(n * 1e6) / 1e6

/** One gym as kept: a name, a place, a radius in metres and an optional text. Null if unusable. */
export function normGym(g) {
  if (!g || typeof g !== 'object') return null
  const lat = Number(g.lat), lng = Number(g.lng)
  if (!validLatLng(lat, lng)) return null
  const id = str(g.id, 40) || 'g' + Math.random().toString(36).slice(2, 10)
  return { id, name: str(g.name, 60), lat: round6(lat), lng: round6(lng), radius: clampRadius(g.radius ?? RADIUS.def), text: str(g.text, 120) }
}

/** The time window, or null for "any time". Both ends must be valid; equal ends mean any time. */
export function normWindow(w) {
  if (!w || typeof w !== 'object') return null
  const from = minuteOf(w.from), to = minuteOf(w.to)
  if (from == null || to == null || from === to) return null
  return { from: w.from, to: w.to }
}

export function normConfig(c) {
  const o = c && typeof c === 'object' ? c : {}
  const seen = new Set()
  const gyms = (Array.isArray(o.gyms) ? o.gyms : []).map(normGym).filter(g => g && !seen.has(g.id) && seen.add(g.id)).slice(0, MAX_GYMS)
  return { on: o.on === true, gyms, window: normWindow(o.window) }
}

/** Whether `date` (local time) falls in the window; an overnight window (22:00 to 02:00) wraps. */
export function inWindow(win, date) {
  const w = normWindow(win)
  if (!w) return true
  const from = minuteOf(w.from), to = minuteOf(w.to)
  const m = date.getHours() * 60 + date.getMinutes()
  return from < to ? m >= from && m < to : m >= from || m < to
}

/**
 * What the native side is told about the profile, re-sent whenever it changes: the last day
 * trained, a day note that excuses today, when the running session started (0: none), and the
 * notification's words in the app's language.
 */
export function statusOf(S, now = new Date()) {
  let trainedOn = ''
  for (const w of S?.workouts || []) if (typeof w?.d === 'string' && w.d > trainedOn) trainedOn = w.d
  const today = isoOf(now)
  const a = S?.active
  const activeSince = a && !a.editingWorkoutId && !a.backfill && Number(a.start) > 0 ? Number(a.start) : 0
  return {
    trainedOn,
    quietOn: S && excusedOn(S, today) ? today : '',
    activeSince,
    title: t('Gym spotted'),
    body: t('Ready for your workout? 💪'),
    // Android's name for the notification channel, in the app's language.
    channel: t('Gym reminder'),
    // Android: the quiet notification while it checks with live location near a gym.
    scan: t('Checking if you made it to the gym'),
  }
}

/**
 * Why a gym entered at `now` would NOT notify, or null when it should. The native plugins apply
 * exactly this (GymReminderRules.swift, GymReminderRules.java), in this order:
 *   off       the reminder is switched off (or no gym)
 *   fired     it already went off today (max once a day, whichever gym)
 *   trained   a workout is logged for today
 *   quiet     today has a day note that excuses it (sick, away)
 *   active    a session is running (started less than 12 hours ago)
 *   window    outside the optional time window
 */
export function skipReason({ config, status, lastFired = '', now = new Date() }) {
  const c = normConfig(config)
  if (!c.on || !c.gyms.length) return 'off'
  const today = isoOf(now)
  if (lastFired === today) return 'fired'
  if (status?.trainedOn === today) return 'trained'
  if (status?.quietOn === today) return 'quiet'
  const since = Number(status?.activeSince) || 0
  if (since > 0 && now.getTime() - since < ACTIVE_FRESH_MS) return 'active'
  if (!inWindow(c.window, now)) return 'window'
  return null
}

/** The notification for a gym: its own text when it has one, the default otherwise. */
export function copyFor(gym, status = statusOf(null)) {
  return { title: status.title, body: str(gym?.text, 120) || status.body }
}

/** Distance in metres between two points (haversine), for "you are here" checks in the editor. */
export function distanceM(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/* ---------------- this device's copy ---------------- */

/** This device's switch (the places are only on the native side, see writeLocal). */
export function readGymConfig(storage = globalThis.localStorage) {
  try { return normConfig(JSON.parse(storage?.getItem(GYM_KEY) || 'null')) } catch { return normConfig(null) }
}
// Only whether it is on, never the places: WebView storage goes into the phone's own backups
// (iCloud, Google), and the gyms are not to leave the phone. The native side holds the rest.
function writeLocal(config, storage = globalThis.localStorage) {
  try { storage?.setItem(GYM_KEY, JSON.stringify({ on: !!config.on })) } catch { /* private mode: the native copy still holds */ }
}

/* ---------------- the native side ---------------- */

// Registered once and handed out inside an object: a Capacitor plugin proxy answers `then` with a
// native call that never settles, so a promise resolved with the bare proxy hangs (#42).
let pluginP = null
const gymPlugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE) return null
  const { registerPlugin, Capacitor } = await import('@capacitor/core')
  const p = Capacitor.getPlatform()
  if (p !== 'ios' && p !== 'android') return null
  return { GymReminder: registerPlugin('GymReminder'), platform: p }
})().catch(() => null))

/**
 * The config as the native side holds it (it outlives an evicted WebView storage), falling back
 * to this page's mirror. Returns { config, permission }.
 */
export async function loadGymConfig() {
  const p = await gymPlugin()
  let config = memory || readGymConfig()
  let permission = null
  if (!p) return { config, permission }
  try {
    const r = await p.GymReminder.get()
    if (r?.config) { config = normConfig(r.config); writeLocal(config); memory = config }
    permission = r?.permission || null
  } catch { /* an older native shell without the plugin: the mirror */ }
  return { config, permission }
}

/**
 * Saves the config on this device and has the phone watch its gyms (or stop). Returns what the
 * native side reports: { watching: number of regions it watches, permission }.
 */
let memory = null
export async function saveGymConfig(next, S = null) {
  const config = normConfig(next)
  writeLocal(config)
  memory = config
  const p = await gymPlugin()
  if (!p) return { watching: 0, permission: null }
  try {
    if (S) await pushGymStatus(S, true)
    return await p.GymReminder.configure({ config }) || { watching: 0, permission: null }
  } catch (e) {
    return { watching: 0, permission: null, error: String(e?.message || e) }
  }
}

let lastStatus = ''
let lastServer = null
/**
 * Tells the native side which server this phone is paired with (and the headers a request to it
 * carries), so that on arrival it can ask whether today was trained on another device that has
 * not synced here yet (GET /api/nudge-check, bounded to 3 s, see GymReminder.java and
 * GymReminderPlugin.swift). A phone without a server sends '' and the phone decides alone. The
 * native side keeps it encrypted (Android Keystore, iOS Keychain), never in the page's storage.
 */
async function pushGymServer(p) {
  const auth = remoteAuth()
  const arg = auth ? { server: auth.base, headers: auth.headers } : { server: '' }
  const key = JSON.stringify(arg)
  if (key === lastServer) return
  try { await p.GymReminder.server(arg); lastServer = key } catch { /* an older native shell: no server check */ }
}

/**
 * Tells the native side how today stands (statusOf). Cheap and deduplicated: run after every
 * save of the profile; does nothing with the reminder off on this device.
 */
export async function pushGymStatus(S, force = false) {
  if (!MOBILE) return false
  if (!force && !readGymConfig().on) return false
  const p = await gymPlugin()
  if (!p) return false
  await pushGymServer(p)
  const status = statusOf(S)
  const key = JSON.stringify(status)
  if (!force && key === lastStatus) return false
  try { await p.GymReminder.status(status); lastStatus = key; return true } catch { return false }
}

/** { location: 'granted'|'denied'|'prompt', background: 'granted'|'denied'|'prompt', notifications } */
export async function gymPermissions() {
  const p = await gymPlugin()
  if (!p) return null
  try { return await p.GymReminder.permission() } catch { return null }
}
/** While-using location: for "I'm at the gym right now". */
export async function askForegroundLocation() {
  const p = await gymPlugin()
  if (!p) return null
  try { return await p.GymReminder.requestForeground() } catch { return null }
}
/** "Always" (iOS) / "Allow all the time" (Android 10+): asked only after the in-app explainer. */
export async function askBackgroundLocation() {
  const p = await gymPlugin()
  if (!p) return null
  try { return await p.GymReminder.requestBackground() } catch { return null }
}
/** One fix of where the phone is: { lat, lng, accuracy } or null. */
export async function currentPosition() {
  const p = await gymPlugin()
  if (!p) return null
  try {
    const r = await p.GymReminder.currentPosition()
    return r && validLatLng(Number(r.lat), Number(r.lng)) ? { lat: Number(r.lat), lng: Number(r.lng), accuracy: Number(r.accuracy) || null } : null
  } catch { return null }
}
/** The system's settings page for this app, where a denied permission can still be allowed. */
export async function openAppSettings() {
  const p = await gymPlugin()
  if (!p) return false
  try { await p.GymReminder.openSettings(); return true } catch { return false }
}

/**
 * Calls `cb` when the gym notification was tapped. Android: the plugin's own `open` event (kept
 * until a listener is there, so a tap that launched the app still arrives). iOS: the notification
 * goes through Capacitor's local-notifications handler, which reports the tap with our id.
 * Returns a function that stops listening.
 */
export function onGymReminderOpen(cb) {
  if (!MOBILE) return () => {}
  const handles = []
  let gone = false
  const keep = h => { if (gone) h?.remove?.(); else handles.push(h) }
  gymPlugin().then(p => {
    if (!p) return
    if (p.platform === 'android') {
      return Promise.resolve(p.GymReminder.addListener('open', () => cb())).then(keep)
    }
    return import('@capacitor/local-notifications').then(({ LocalNotifications }) =>
      Promise.resolve(LocalNotifications.addListener('localNotificationActionPerformed', e => {
        const n = e?.notification
        if (e?.actionId !== 'dismiss' && (n?.id === NOTIFICATION_ID || n?.extra?.gymReminder)) cb()
      })).then(keep))
  }).catch(() => {})
  return () => { gone = true; handles.splice(0).forEach(h => { try { h?.remove?.() } catch { /* gone already */ } }) }
}

export function _resetGymReminder() { pluginP = null; lastStatus = ''; lastServer = null; memory = null }
