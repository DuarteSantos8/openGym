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
import { isoOf, todayISO } from './format.js'
import { effectiveRoutineIds } from './history.js'

export const MOBILE = import.meta.env.VITE_MOBILE === '1'

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

export async function nativeSave(state) {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    await Filesystem.writeFile({ path: FILE, directory: Directory.Data, data: JSON.stringify(state), encoding: Encoding.UTF8 })
    return true
  } catch (e) {
    // Callers keep the in-memory edit but must be able to surface that the durable native mirror
    // failed; returning false preserves the old best-effort API without swallowing the signal.
    return false
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

// WKWebView can't do blob-URL downloads, so the backup goes out through the OS share sheet
// (Files, AirDrop, mail, …) from a temp file instead.
export async function shareExport(json, filename) {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')
  const w = await Filesystem.writeFile({ path: filename, directory: Directory.Cache, data: json, encoding: Encoding.UTF8 })
  await Share.share({ title: filename, url: w.uri })
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