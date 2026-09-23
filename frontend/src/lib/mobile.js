// Mobile build (VITE_MOBILE=1) — the standalone app-store version (Capacitor native shell).
//
// There is no backend: nothing to sign in to, everything lives on the phone. Unlike guest
// mode in a browser, this is the user's only copy of their training log, so it can't depend
// on WebView localStorage alone (iOS evicts that under storage pressure). Every persist()
// therefore also lands in a JSON file in the app's private data directory, and boot()
// restores from it. The workout reminder uses native local notifications scheduled per future
// calendar date — no server involved, unlike Web Push in the self-hosted version.
//
// Like the demo build, MOBILE is replaced at build time, so all of this folds away in
// web bundles; the Capacitor plugins are only ever imported behind it.
import { t } from './i18n-core.js'
import { isoOf, todayISO, ACCENTS } from './format.js'
import { effectiveRoutineIds } from './history.js'
import { registerPlugin } from '@capacitor/core'

export const MOBILE = import.meta.env.VITE_MOBILE === '1' || (typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.())

export const RestTimerNative = MOBILE ? registerPlugin('RestTimerNative') : null
export const WorkoutWidgetNative = MOBILE ? registerPlugin('WorkoutWidgetNative') : null

export function toTitleCase(str) {
  if (!str) return ''
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// Some features only make sense on Android. The in-app updater downloads an .apk and hands it
// to the system package installer — there is no equivalent on iOS (App Store only) or on the
// web build. On anything but a native Android shell this must stay off.
//
// @capacitor/core is imported dynamically (like every other Capacitor dependency here) so it
// never lands in the web bundle. Capacitor.getPlatform() returns 'android' | 'ios' | 'web'.
export async function isAndroid() {
  if (!MOBILE) return false
  try {
    const { Capacitor } = await import('@capacitor/core')
    return Capacitor.getPlatform() === 'android'
  } catch (e) {
    return false
  }
}

const FILE = 'opengym-state.json'

export async function nativeLoad() {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const r = await Filesystem.readFile({ path: FILE, directory: Directory.Data, encoding: Encoding.UTF8 })
    return JSON.parse(r.data)
  } catch (e) { return null }   // first launch, or unreadable — localStorage copy takes over
}

export async function updateWidgetNative() {
  if (!MOBILE || !WorkoutWidgetNative) return
  try {
    await WorkoutWidgetNative.updateWidget()
  } catch (e) { /* ignore */ }
}

let isSaving = false
let queuedState = null

export async function nativeSave(state) {
  if (!MOBILE) return
  if (isSaving) {
    queuedState = state
    return
  }
  isSaving = true
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    await Filesystem.writeFile({ path: FILE, directory: Directory.Data, data: JSON.stringify(state), encoding: Encoding.UTF8 })
    updateWidgetNative()
  } catch (e) { /* keep the localStorage copy */ }
  finally {
    isSaving = false
    if (queuedState) {
      const next = queuedState
      queuedState = null
      nativeSave(next)
    }
  }
}

// "Connect to my server" mode (lib/remote.js): which of local-only / a paired remote account this
// device chose, kept in its own file — never inside opengym-state.json, since that file's content
// is exactly what pushState() PUTs to a server, and a device's own connection secret must never
// travel as if it were training data.
const REMOTE_FILE = 'opengym-remote.json'

// Small JSON files in the app's private data directory, for device facts that must not ride
// in S (which syncs and exports): the pairing, and how the Coach runs on this phone.
export async function readJsonFile(name) {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const r = await Filesystem.readFile({ path: name, directory: Directory.Data, encoding: Encoding.UTF8 })
    return JSON.parse(r.data)
  } catch (e) { return null }
}
export async function writeJsonFile(name, data) {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    await Filesystem.writeFile({ path: name, directory: Directory.Data, data: JSON.stringify(data), encoding: Encoding.UTF8 })
  } catch (e) { /* not a Capacitor build, or the write failed — the caller's in-memory copy stands */ }
}

export async function loadRemoteFile() {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const r = await Filesystem.readFile({ path: REMOTE_FILE, directory: Directory.Data, encoding: Encoding.UTF8 })
    return JSON.parse(r.data)
  } catch (e) { return null }   // never decided yet
}

export async function saveRemoteFile(data) {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    await Filesystem.writeFile({ path: REMOTE_FILE, directory: Directory.Data, data: JSON.stringify(data), encoding: Encoding.UTF8 })
  } catch (e) { /* worst case: onboarding asks again next launch */ }
}

// Keep enough dates queued to cover normal app use between foregrounds without creating an
// unbounded notification list. The next sync cancels and replaces this whole window.
export const REMINDER_WINDOW_DAYS = 60
const REMINDER_ID_BASE = 1000
const LEGACY_REMINDER_IDS = Array.from({ length: 7 }, (_, d) => ({ id: 100 + d }))

// Pure date expansion for the native reminder. `now` is injectable so the calendar boundary,
// completed-day suppression, and today's past-time rule stay deterministic in tests.
export function buildReminderNotifications(S, now = new Date()) {
  const r = S?.reminder
  if (!r?.on) return []
  const routines = Array.isArray(S.routines) ? S.routines : []
  const completed = new Set((S.workouts || []).map(w => w.d))
  const state = { ...S, routines, week: S.week || {}, dayPlan: S.dayPlan || {} }
  const [hour, minute] = (r.time || '08:00').split(':').map(Number)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return []
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
  const notifications = []
  for (let offset = 0; offset < REMINDER_WINDOW_DAYS; offset++) {
    const day = new Date(date)
    day.setDate(date.getDate() + offset)
    const iso = isoOf(day)
    if (completed.has(iso)) continue
    // A weekday can hold several routines; name them all, or fall back to a count.
    const dayRoutines = effectiveRoutineIds(state, iso).map(id => routines.find(x => x.id === id)).filter(Boolean)
    if (!dayRoutines.length) continue
    const label = dayRoutines.length <= 2 ? dayRoutines.map(r => r.name).join(' + ') : t('{0} routines', dayRoutines.length)
    const at = new Date(day)
    at.setHours(hour, minute, 0, 0)
    if (at <= now) continue
    notifications.push({
      id: REMINDER_ID_BASE + offset,
      title: t('Workout day'),
      body: t('{0} is on the plan today — let’s go!', label),
      schedule: { at, allowWhileIdle: true },
    })
  }
  return notifications
}

// (Re)schedule the workout-day reminder: one one-off notification per future calendar date in
// the bounded window. Cheap enough to run after any state change — the plan or the reminder time
// may just have been edited. `interactive` gates the OS permission prompt to the Settings toggle;
// a background resync never pops a dialog.
export async function syncReminder(S, interactive = false) {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({ notifications: [
      ...LEGACY_REMINDER_IDS,
      ...Array.from({ length: REMINDER_WINDOW_DAYS }, (_, d) => ({ id: REMINDER_ID_BASE + d })),
    ] }).catch(() => {})
    const r = S.reminder
    if (!r?.on) return true
    let perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted' && interactive) perm = await LocalNotifications.requestPermissions()
    if (perm.display !== 'granted') return false
    const notifications = buildReminderNotifications(S)
    if (notifications.length) await LocalNotifications.schedule({ notifications })
    return true
  } catch (e) { return false }
}

// Capacitor emits appStateChange when the native shell returns to the foreground. The visibility
// listener also covers WebView/browser transitions, and both are harmless on a non-mobile build.
let reminderSyncStarted = false
export function initReminderSync(getState) {
  if (!MOBILE || reminderSyncStarted) return
  reminderSyncStarted = true
  const resync = () => {
    if (document.visibilityState === 'hidden') return
    syncReminder(getState()).catch(() => {})
  }
  document.addEventListener('visibilitychange', resync)
  import('@capacitor/app').then(({ App }) => {
    App.addListener('appStateChange', ({ isActive }) => { if (isActive) resync() })
  }).catch(() => {})
}

// Runs cb whenever the native shell returns to the foreground — the store pulls the account's
// state then, so a phone that sat in a pocket all afternoon shows what the desktop did. No-op
// off mobile; the store's own visibility/focus listeners cover the browser.
export function onAppActive(cb) {
  if (!MOBILE) return
  import('@capacitor/app').then(({ App }) => {
    App.addListener('appStateChange', ({ isActive }) => { if (isActive) cb() })
  }).catch(() => {})
}

// WKWebView can't do blob-URL downloads, so the backup goes out through the OS share sheet
// (Files, AirDrop, mail, …) from a temp file instead.
export async function shareExport(json, filename) {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')
  const w = await Filesystem.writeFile({ path: filename, directory: Directory.Cache, data: json, encoding: Encoding.UTF8 })
  await Share.share({ title: filename, url: w.uri })
}

// Hand a self-contained HTML document (lib/plan-share.js planPrintHTML) to the OS print flow.
// Android routes it through the system PrintManager — "Save as PDF", "Save to Drive", a real
// printer; iOS through the print sheet — "Save to Files" (as PDF), share, print. Either way the
// platform renders the PDF, so no PDF library rides in the bundle. The local `Print` plugin is
// registered natively (android MainActivity, ios PrintPlugin.m); on the web build this file's
// callers gate on MOBILE and never reach here.
export async function printHtml(html, name) {
  const { registerPlugin } = await import('@capacitor/core')
  const Print = registerPlugin('Print')
  await Print.printHtml({ html, name })
}

// "Auto-backup on changes" (Settings): a dated snapshot dropped into the Documents folder —
// visible in Files (iOS) / a file manager (Android), unlike the private mirror nativeSave keeps
// — so whatever the user points at that folder (a sync app, a manual copy) always has something
// recent. One file per day; later triggers the same day just overwrite it.
export async function writeAutoBackup(state) {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    await Filesystem.writeFile({
      path: `opengym-backup-${todayISO()}.json`,
      directory: Directory.Documents,
      data: JSON.stringify(state),
      encoding: Encoding.UTF8,
      recursive: true,
    })
  } catch (e) { /* best effort — the private mirror in Directory.Data still has the data */ }
}

// Register notification action buttons (-15s, +15s, Skip) and event listener for the rest timer
export async function initMobileNotifications(store) {
  if (!MOBILE) return
  try {
    if (RestTimerNative) {
      RestTimerNative.addListener('onRestAction', ({ action }) => {
        if (action === 'skip' || action === 'completed') {
          store.getState().stopRest()
        } else if (action === 'plus15') {
          store.getState().addRest(15)
        } else if (action === 'minus15') {
          store.getState().addRest(-15)
        }
      })
    }
    if (WorkoutWidgetNative) {
      WorkoutWidgetNative.addListener('onWidgetStateChanged', async () => {
        const st = await nativeLoad()
        if (st) {
          const { useStore } = await import('../store/useStore.js')
          useStore.getState().replaceState(st, false)
        }
      })

      const triggerAutoStart = async () => {
        const { useStore } = await import('../store/useStore.js')
        const { startFlow } = await import('../sheets.jsx')
        const { nav } = await import('./nav.js')
        const st = useStore.getState().S
        if (st.active) {
          nav('/workout')
          return
        }
        const dayOfWeek = new Date().getDay()
        const scheduledId = st.week ? st.week[dayOfWeek] : null
        const routine = scheduledId ? (st.routines || []).find(r => r.id === scheduledId) : null
        startFlow(routine ? routine.id : null)
      }

      WorkoutWidgetNative.addListener('onAutoStartWorkout', () => {
        triggerAutoStart()
      })

      try {
        const res = await WorkoutWidgetNative.checkPendingAutoStart()
        if (res && res.autoStart) {
          triggerAutoStart()
        }
      } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
}

// Scheduled ongoing rest timer notification widget
export async function scheduleRestNotification(seconds, meta = {}) {
  if (!MOBILE || !RestTimerNative) return
  try {
    const rawName = meta.exercise || ''
    const exName = toTitleCase(rawName)
    const setInfo = meta.set ? (meta.totalSets ? `${t('Set')} ${meta.set}/${meta.totalSets}` : `${t('Set')} ${meta.set}`) : ''
    const accentColor = (meta.accent && ACCENTS[meta.accent]) ? ACCENTS[meta.accent] : '#30d158'
    await RestTimerNative.startRest({
      seconds: Math.max(1, seconds),
      exercise: exName,
      set: setInfo,
      accentColor: accentColor
    })
  } catch (e) { /* ignore */ }
}

export async function addRestNotification(seconds) {
  if (!MOBILE || !RestTimerNative) return
  try {
    await RestTimerNative.addRest({ seconds })
  } catch (e) { /* ignore */ }
}

export async function cancelRestNotification() {
  if (!MOBILE || !RestTimerNative) return
  try {
    await RestTimerNative.stopRest()
  } catch (e) { /* ignore */ }
}

export async function sendTestLocalNotification() {
  if (!MOBILE || !RestTimerNative) return false
  try {
    await RestTimerNative.startRest({
      seconds: 90,
      exercise: 'Barbell Bench Press',
      set: 'Set 2/4',
      accentColor: '#30d158'
    })
    return true
  } catch (e) { return false }
}