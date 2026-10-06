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
// Settings → Vibrate off. A notification channel's vibration is the system's to keep once the
// channel exists, so the app cannot switch it off on 'rest-over': an end that must not buzz is
// posted on a second channel that never vibrates (RestAlert.java).
export const REST_QUIET_CHANNEL_ID = 'rest-over-quiet'

// One object the native side schedules. Public + high is what the notification shade can show.
// The lock screen follows the user's notification settings.
export function accentColors(key) {
  const k = ACCENTS[key] ? key : 'lime'
  return { accent: argb(ACCENTS[k]), ink: argb(ACCENT_INK[k]) }
}

export function buildRestAlert({ at, title, countdownTitle, totalSec, accent, sound = true, vibrate = true, vibrateOnSilent = false, now = Date.now() } = {}) {
  if (typeof at !== 'number' || !(at > now)) return null
  const totalMs = Math.max(1000, Math.round((totalSec > 0 ? totalSec : (at - now) / 1000) * 1000))
  const colors = accentColors(accent)
  const mayBuzz = !!vibrate
  // Alarm-usage buzz is a direct Vibrator call, so the notification itself stays on the quiet
  // channel. Otherwise the channel and that call would both buzz whenever the phone is not silent.
  const alarmBuzz = mayBuzz && !!vibrateOnSilent
  return {
    id: REST_ALERT_ID,
    channelId: mayBuzz && !alarmBuzz ? REST_CHANNEL_ID : REST_QUIET_CHANNEL_ID,
    title: title || t('Rest over — next set!'),
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
    vibrate: mayBuzz,
    vibrateOnSilent: alarmBuzz,
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

// The native plugin, registered once: registerPlugin() warns on every call after the first. It
// travels inside an object because a Capacitor plugin proxy answers `then` with a native call that
// never settles, so a promise resolved with the bare proxy hangs for good (the Coach hang, #42).
// Anything but the Android app gets null and registers nothing: iOS has no RestAlert, and every
// call to it there, addListener included, rejects.
let pluginP = null
const restPlugin = () => pluginP || (pluginP = (async () => {
  if (!(await isAndroid())) return null
  const { registerPlugin } = await import('@capacitor/core')
  return { RestAlert: registerPlugin('RestAlert') }
})().catch(() => null))

// Resolves true only when an Android alarm was scheduled. Callers use false as
// "fall back to the server push" — web, iOS, and a failed schedule.
export function armRestAlert(at, opts = {}) {
  if (!MOBILE) return Promise.resolve(false)
  const mine = ++token
  const alert = buildRestAlert({ at, title: opts.title, countdownTitle: opts.countdownTitle, totalSec: opts.totalSec, accent: opts.accent, sound: opts.sound, vibrate: opts.vibrate !== false, vibrateOnSilent: opts.vibrate !== false && !!opts.vibrateOnSilent })
  if (!alert) return Promise.resolve(false)
  return enqueue(async () => {
    let kind = 'failed'
    try { kind = await deliver(alert) } catch { kind = 'failed' }
    if (mine !== token) return false
    return kind === 'android'
  })
}

// The end buzz while the app is on screen. navigator.vibrate is muted in silent mode; this
// plugin call is the alarm-usage buzz, the same one the locked-screen alert uses (issue #375).
export function buzzRestEnd() {
  if (!MOBILE) return
  enqueue(async () => {
    try {
      const p = await restPlugin()
      if (p) await p.RestAlert.buzz()
    } catch { /* best effort: the in-app pattern is the fallback when this cannot run */ }
  })
}

export function disarmRestAlert() {
  token++
  if (!MOBILE) return
  enqueue(async () => {
    try { await cancelDelivered() } catch { /* the next arm replaces this alarm */ }
  })
}

// The rest was paused in the app (#193): the notification stops its clock at the time held and
// offers Resume, and the alarm for the old end is called off. Resuming arms it again for the new
// end like any other rest; time added or taken while paused holds it again at the new figure.
export function holdRestAlert(leftSec, totalSec) {
  token++
  if (!MOBILE) return
  enqueue(async () => {
    const p = await restPlugin()
    if (p) await p.RestAlert.hold({ id: REST_ALERT_ID, leftMs: Math.max(1, leftSec) * 1000, totalMs: Math.max(1, totalSec) * 1000 })
  })
}

// What the notification's own buttons did (pause, ±15s, skip), for useUI to mirror in the bar.
let onNativeRest = null
export function bindNativeRest(cb) { onNativeRest = cb }

// Caught, and only on Android: in the iOS app this listener used to reject at startup with
// nobody to catch it.
if (MOBILE) {
  restPlugin()
    .then(p => p && p.RestAlert.addListener('rest', ev => { if (onNativeRest) onNativeRest(ev) }))
    .catch(() => {})
}

// The running countdown repaints with this swatch. No-op when no rest is on screen.
export function setRestAccent(key) {
  if (!MOBILE) return
  const { accent, ink } = accentColors(key)
  enqueue(async () => {
    const p = await restPlugin()
    if (p) await p.RestAlert.setAccent({ accent, ink })
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
  const p = await restPlugin()
  if (!p) return 'skipped'
  const { RestAlert } = p
  await ensureNotifPermission()
  // Sound still schedules when notification permission is missing: the alarm tone does
  // not need it. The notification does, which is why we ask above.
  await RestAlert.schedule({
    id: alert.id,
    at: alert.at,
    title: alert.title,
    sound: alert.sound,
    // The end of a rest the app is not in front for: the notification, or the buzz standing in
    // for it where notifications are off. With the app in front the page buzzes (lib/sound.js).
    vibrate: alert.vibrate,
    vibrateOnSilent: alert.vibrateOnSilent,
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
  const p = await restPlugin()
  if (p) await p.RestAlert.cancel({ id: REST_ALERT_ID })
}
