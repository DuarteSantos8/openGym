// Rest-over alert for the Capacitor app.
//
// The in-page countdown is a setInterval in the WebView. Android freezes that as soon as the
// screen locks, so the beep never runs and nothing is posted. Scheduling a real alarm at
// startRest() is what still fires with the screen off: the receiver posts the notification
// and plays the end tone. The card in the notification shade is the in-app shape: clock plus
// a shrinking bar. The lock screen shows it only when notifications are allowed and the
// system is set to show them there.
//
// The web build keeps Web Push (useUI). This file no-ops there; MOBILE is a build-time flag.
import { t } from './i18n-core.js'
import { ACCENTS, ACCENT_INK, argb } from './format.js'
import { MOBILE, isAndroid } from './mobile.js'

export const REST_ALERT_ID = 42
export const REST_CHANNEL_ID = 'rest-over'

// One object the native side schedules. Public + high is what the notification shade can show.
// The lock screen follows the user's notification settings.
export function accentColors(key) {
  const k = ACCENTS[key] ? key : 'lime'
  return { accent: argb(ACCENTS[k]), ink: argb(ACCENT_INK[k]) }
}

export function buildRestAlert({ at, title, countdownTitle, totalSec, accent, sound = true, now = Date.now() } = {}) {
  if (typeof at !== 'number' || !(at > now)) return null
  const totalMs = Math.max(1000, Math.round((totalSec > 0 ? totalSec : (at - now) / 1000) * 1000))
  const colors = accentColors(accent)
  return {
    id: REST_ALERT_ID,
    channelId: REST_CHANNEL_ID,
    title: title || t('Rest over'),
    countdownTitle: countdownTitle || t('Rest'),
    pause: t('Pause'),
    resume: t('Resume'),
    minus: '− 15s',
    plus: '+ 15s',
    skip: t('Skip'),
    accent: colors.accent,
    ink: colors.ink,
    totalMs,
    at,
    allowWhileIdle: true,
    sound: !!sound,
    localOnly: false,
    visibility: 'public',
    importance: 'high',
  }
}

// Serialises schedule/cancel. startRest() disarms the previous alarm and arms the next in
// the same turn; if those two bridge calls raced, a cancel finishing last would swallow the
// new alarm. `token` stops a slow schedule from adopting the beep after a later disarm.
let chain = Promise.resolve()
let token = 0

const enqueue = fn => {
  const run = chain.then(fn, fn)
  chain = run.then(() => {}, () => {})
  return run
}

// Resolves true only when an Android alarm was scheduled. Callers use false as
// "fall back to the server push" — web, iOS, and a failed schedule.
export function armRestAlert(at, opts = {}) {
  if (!MOBILE) return Promise.resolve(false)
  const mine = ++token
  const alert = buildRestAlert({ at, title: opts.title, countdownTitle: opts.countdownTitle, totalSec: opts.totalSec, accent: opts.accent, sound: opts.sound })
  if (!alert) return Promise.resolve(false)
  return enqueue(async () => {
    let kind = 'failed'
    try { kind = await deliver(alert) } catch { kind = 'failed' }
    if (mine !== token) return false
    return kind === 'android'
  })
}

export function disarmRestAlert() {
  token++
  if (!MOBILE) return
  enqueue(async () => {
    try { await cancelDelivered() } catch { /* the next arm replaces this alarm */ }
  })
}

// The page is visible and about to play the in-app beep. Skip the native tone so
// the two don't both sound. The notification itself still posts.
let onNativeRest = null
export function bindNativeRest(cb) { onNativeRest = cb }

if (MOBILE) {
  import('@capacitor/core').then(({ registerPlugin }) => {
    const RestAlert = registerPlugin('RestAlert')
    RestAlert.addListener('rest', ev => { if (onNativeRest) onNativeRest(ev) })
  }).catch(() => {})
}

// The running countdown repaints with this swatch. No-op when no rest is on screen.
export function setRestAccent(key) {
  if (!MOBILE) return
  const { accent, ink } = accentColors(key)
  enqueue(async () => {
    if (!(await isAndroid())) return
    const { registerPlugin } = await import('@capacitor/core')
    const RestAlert = registerPlugin('RestAlert')
    await RestAlert.setAccent({ accent, ink })
  })
}

export function hushRestTone() {
  if (!MOBILE) return
  enqueue(async () => {
    if (!(await isAndroid())) return
    const { registerPlugin } = await import('@capacitor/core')
    const RestAlert = registerPlugin('RestAlert')
    await RestAlert.suppressTone()
  })
}

async function ensureNotifPermission() {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    let perm = await LocalNotifications.checkPermissions()
    if (perm.display === 'granted') return true
    if (perm.display === 'denied') return false
    perm = await LocalNotifications.requestPermissions()
    return perm.display === 'granted'
  } catch {
    return false
  }
}

async function deliver(alert) {
  if (!(await isAndroid())) return 'skipped'
  await ensureNotifPermission()
  const { registerPlugin } = await import('@capacitor/core')
  const RestAlert = registerPlugin('RestAlert')
  // Sound still schedules when notification permission is missing: the alarm tone does
  // not need it. The notification does, which is why we ask above.
  await RestAlert.schedule({
    id: alert.id,
    at: alert.at,
    title: alert.title,
    sound: alert.sound,
    channelId: alert.channelId,
    visibility: alert.visibility,
    importance: alert.importance,
    localOnly: alert.localOnly,
    countdownTitle: alert.countdownTitle,
    totalMs: alert.totalMs,
    pause: alert.pause,
    resume: alert.resume,
    minus: alert.minus,
    plus: alert.plus,
    skip: alert.skip,
    accent: alert.accent,
    ink: alert.ink,
  })
  return 'android'
}

async function cancelDelivered() {
  if (!(await isAndroid())) return
  const { registerPlugin } = await import('@capacitor/core')
  const RestAlert = registerPlugin('RestAlert')
  await RestAlert.cancel({ id: REST_ALERT_ID })
}
