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
import { buildProfileBackup } from './export-profile.js'
import { isLegacyProfile } from '../../../api/migration/profile-version.js'
import { parseState, stringifyState } from './state-codec.js'

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

// The mirror as stored: the engine migration backs up these exact bytes, not a re-serialization.
export async function nativeLoadText(file = FILE) {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    return (await Filesystem.readFile({ path: file, directory: Directory.Data, encoding: Encoding.UTF8 })).data
  } catch (e) {
    if (e?.code === 'ENOENT' || e?.code === 'OS-PLUG-FILE-0008' || /not exist|not found/i.test(e?.message || '')) return null
    throw e
  }
}

export async function nativeLoad() {
  try { return parseState(await nativeLoadText()) } catch (e) { return null }
}

// One immutable copy of a v1 mirror, written before the migration changes anything and read back
// to prove it landed. An existing copy is an earlier attempt's evidence: kept, never replaced, and
// refused outright if it is not v1 at all.
export const NATIVE_BACKUP_FILE = 'gym_state_v1.pre-engine-v1.json'
export async function nativeBackupOnce(text, file = NATIVE_BACKUP_FILE) {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
  const at = { path: file, directory: Directory.Data, encoding: Encoding.UTF8 }
  const read = () => Filesystem.readFile(at).then(r => r.data, e => {
    if (e?.code === 'ENOENT' || e?.code === 'OS-PLUG-FILE-0008' || /not exist|not found/i.test(e?.message || '')) return null
    throw e
  })
  const existing = await read()
  if (existing != null) {
    if (!isLegacyProfile(JSON.parse(existing))) throw new Error('native-backup-not-v1')
    if (existing !== text) throw new Error('native-backup-source-mismatch')
    return
  }
  await Filesystem.writeFile({ ...at, data: text })
  if ((await read()) !== text) throw new Error('native-backup-mismatch')
}

export async function nativeSave(state, strict = false) {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    await Filesystem.writeFile({ path: FILE, directory: Directory.Data, data: stringifyState(state), encoding: Encoding.UTF8 })
  } catch (e) { if (strict) throw e; return false }
  return true
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
export async function writeJsonFile(name, data, strict = false) {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    await Filesystem.writeFile({ path: name, directory: Directory.Data, data: JSON.stringify(data), encoding: Encoding.UTF8 })
    if (strict && JSON.stringify(await readJsonFile(name)) !== JSON.stringify(data)) throw new Error('native-write-mismatch')
  } catch (e) { if (strict) throw e; return false }
  return true
}

// The in-progress session's file mirror. Same reason as the profile's: WebView storage can be
// evicted, and backgrounding is often the last thing before the OS kills the app.
export const ACTIVE_FILE = 'gym_active_v1.json'

export async function nativeActiveSave(A, strict = false) {
  return await writeJsonFile(ACTIVE_FILE, A, strict)
}

export async function nativeActiveLoad() {
  return await readJsonFile(ACTIVE_FILE)
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

// The same for a binary export — the backup with photos and videos (lib/backup-media.js). The
// file crosses the native bridge as base64 in 3 MB pieces, never as one string the size of the
// whole zip, which could be a few hundred MB.
export async function shareExportBlob(blob, filename) {
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')
  const { toBase64 } = await import('./media-store-fs.js')
  const CHUNK = 3 * 1024 * 1024
  for (let o = 0; o < blob.size || o === 0; o += CHUNK) {
    const data = toBase64(new Uint8Array(await blob.slice(o, o + CHUNK).arrayBuffer()))
    if (o === 0) await Filesystem.writeFile({ path: filename, directory: Directory.Cache, data })
    else await Filesystem.appendFile({ path: filename, directory: Directory.Cache, data })
    if (!blob.size) break
  }
  const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache })
  await Share.share({ title: filename, url: uri })
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

// "Auto-backup on changes" (Settings): a dated snapshot dropped into Documents/openGym/ —
// visible in Files (iOS) / a file manager (Android), unlike the private mirror nativeSave keeps
// — so whatever the user points at that folder (a sync app, a manual copy) always has something
// recent. One file per day; later triggers the same day just overwrite it.
//
// The folder is ours alone (#161): until v1.3.9 the files landed in the Documents root, so a
// sync app pointed at them had to carry the whole Documents folder along, and a year of daily
// copies piled up there. Now each write keeps only the newest AUTO_BACKUP_KEEP in the folder.
// The root is never pruned: a manual export saved there carries the same name, and nothing
// tells it apart from an old automatic copy, so those stay for the person to clear (Import
// backup still reads either kind).
export const AUTO_BACKUP_DIR = 'openGym'
export const AUTO_BACKUP_KEEP = 14
// Only the exact names writeAutoBackup gives its files are ever pruned; anything else someone
// keeps in the folder is theirs.
const AUTO_BACKUP_NAME = /^opengym-backup-\d{4}-\d{2}-\d{2}(-2)?\.json$/

// Android's scoped storage lets an install write over, list and delete only the files it wrote
// itself. After a reinstall, or with the test build beside the real one, today's name can belong
// to the other install: writing it fails with EACCES, and that day went without a copy, silently.
// The copy then goes under the day's second name, which this install owns after its first write.
// The other install's files stay where they are; this one cannot see them to prune them.
export async function writeAutoBackup(state) {
  const day = todayISO()
  let fs
  try { fs = await import('@capacitor/filesystem') } catch (e) { return }
  const data = JSON.stringify(buildProfileBackup(state))
  const write = name => fs.Filesystem.writeFile({
    path: `${AUTO_BACKUP_DIR}/${name}`,
    directory: fs.Directory.Documents,
    data,
    encoding: fs.Encoding.UTF8,
    recursive: true,
  })
  let name = `opengym-backup-${day}.json`
  try { await write(name) } catch (e) {
    name = `opengym-backup-${day}-2.json`
    try { await write(name) } catch (e2) { return }   // best effort — the private mirror in Directory.Data still has the data
  }
  // Pruning waits for a successful write: a full disk must never cost the copies already there.
  await pruneAutoBackups(fs, name)
}

async function pruneAutoBackups({ Filesystem, Directory }, written) {
  let files
  try { files = (await Filesystem.readdir({ path: AUTO_BACKUP_DIR, directory: Directory.Documents })).files || [] } catch (e) { return }
  const older = files
    // Capacitor before 4 listed bare names; since then an object that also says what it is.
    .filter(f => typeof f === 'string' || f?.type !== 'directory')
    .map(f => (typeof f === 'string' ? f : f?.name))
    // The copy just written is never a candidate, even if a clock set back makes it sort
    // below the others: it is one of the AUTO_BACKUP_KEEP whatever its date says.
    .filter(n => AUTO_BACKUP_NAME.test(n || '') && n !== written)
    // Newest first by the date in the name, which a sync app or a copy cannot disturb the way
    // it can a modification time.
    .sort().reverse()
  for (const n of older.slice(AUTO_BACKUP_KEEP - 1)) {
    try { await Filesystem.deleteFile({ path: `${AUTO_BACKUP_DIR}/${n}`, directory: Directory.Documents }) } catch (e) { /* one stuck file does not stop the rest */ }
  }
}
