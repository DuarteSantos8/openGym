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
import { t, tn } from './i18n-core.js'
import { isoOf, todayISO } from './format.js'
import { effectiveRoutineIds } from './history.js'
import { NUDGE_COPY, lineIndex, nudgeFor, nudgeMinute, toneOf } from './nudge.js'
import { excusedOn } from './day-notes.js'

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

// Which native shell this is: 'android', 'ios', or null on the web build (and if Capacitor
// cannot say). For what both apps have, each in its own way (the rest alert, the health store).
export async function nativePlatform() {
  if (!MOBILE) return null
  try {
    const { Capacitor } = await import('@capacitor/core')
    const p = Capacitor.getPlatform()
    return p === 'android' || p === 'ios' ? p : null
  } catch (e) {
    return null
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
  } catch (e) { /* keep the localStorage copy */ }
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
    // A day you noted as sick or away (lib/day-notes.js) is off the hook, reminder included.
    if (completed.has(iso) || excusedOn(S, iso)) continue
    // A weekday can hold several routines; name them all, or fall back to a count. Each day is
    // asked as if it were today: a coach week's next session is due every day until it is done,
    // so it is reminded every day (the app re-syncs these after every workout and on open).
    const dayRoutines = effectiveRoutineIds(state, iso, iso).map(id => routines.find(x => x.id === id)).filter(Boolean)
    if (!dayRoutines.length) continue
    const label = dayRoutines.length <= 2 ? dayRoutines.map(r => r.name).join(' + ') : tn('{0} routine', '{0} routines', dayRoutines.length)
    const at = new Date(day)
    at.setHours(hour, minute, 0, 0)
    if (at <= now) continue
    notifications.push({
      id: REMINDER_ID_BASE + offset,
      title: t('Workout day'),
      body: t('{0} is on the plan today. Let’s go!', label),
      schedule: { at, allowWhileIdle: true },
    })
  }
  return notifications
}

// The missed-workout nudge (lib/nudge.js) as native notifications: one per future date that would
// be a missed day if nothing gets logged before its evening. nudgeFor() reads only workouts up to
// that date, so asking about tomorrow and the day after already applies the back-off of a break
// that goes on — at most 3 of these are ever queued past the last workout. Logging a workout
// resyncs (every persist does), which drops the day and resets the count.
export const NUDGE_WINDOW_DAYS = 7
const NUDGE_ID_BASE = 2000
export function buildNudgeNotifications(S, now = new Date()) {
  const r = S?.reminder
  if (!r?.on || !r.nudge) return []
  const at = nudgeMinute(r.time || '08:00')
  if (at == null) return []
  const routines = Array.isArray(S.routines) ? S.routines : []
  const copy = NUDGE_COPY[toneOf(r)]
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
  const notifications = []
  for (let offset = 0; offset < NUDGE_WINDOW_DAYS; offset++) {
    const day = new Date(date)
    day.setDate(date.getDate() + offset)
    const iso = isoOf(day)
    // a session on screen right now is today's workout in the making, not a miss
    if (offset === 0 && S.active) continue
    const ids = nudgeFor(S, iso)
    if (!ids) continue
    const names = ids.map(id => routines.find(x => x.id === id)?.name).filter(Boolean)
    const label = names.length && names.length <= 2 ? names.join(' + ') : tn('{0} routine', '{0} routines', ids.length)
    const when = new Date(day)
    when.setHours(Math.floor(at / 60), at % 60, 0, 0)
    if (when <= now) continue
    notifications.push({
      id: NUDGE_ID_BASE + offset,
      title: t(copy.title),
      body: t(copy.lines[lineIndex(iso, copy.lines.length)], label),
      schedule: { at: when, allowWhileIdle: true },
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
      ...Array.from({ length: NUDGE_WINDOW_DAYS }, (_, d) => ({ id: NUDGE_ID_BASE + d })),
    ] }).catch(() => {})
    const r = S.reminder
    if (!r?.on) return true
    let perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted' && interactive) perm = await LocalNotifications.requestPermissions()
    if (perm.display !== 'granted') return false
    const notifications = [...buildReminderNotifications(S), ...buildNudgeNotifications(S)]
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
  // addListener is a promise of its own — it rejects when the App plugin is not behind the bridge
  // (a native project cap sync never updated, a custom platform) — so it is returned into the
  // catch below. Dropped inside a block, as it was before, that rejection went unhandled.
  import('@capacitor/app').then(({ App }) =>
    App.addListener('appStateChange', ({ isActive }) => { if (isActive) resync() })
  ).catch(() => {})
}

// Runs cb whenever the native shell returns to the foreground — the store pulls the account's
// state then, so a phone that sat in a pocket all afternoon shows what the desktop did. No-op
// off mobile; the store's own visibility/focus listeners cover the browser.
export function onAppActive(cb) {
  if (!MOBILE) return
  // Returned, not dropped, for the same reason as in initReminderSync.
  import('@capacitor/app').then(({ App }) =>
    App.addListener('appStateChange', ({ isActive }) => { if (isActive) cb() })
  ).catch(() => {})
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
const AUTO_BACKUP_NAME = /^opengym-backup-\d{4}-\d{2}-\d{2}(-[2-9])?\.json$/

// Android's scoped storage lets an install write over, list and delete only the files it wrote
// itself. After a reinstall, or with the test build beside the real one, today's name can belong
// to the other install: writing it fails with EACCES, and that day went without a copy, silently.
// The copy then goes under the day's next name (-2 up to -9), which this install owns after its first write.
// The other install's files stay where they are; this one cannot see them to prune them.
export async function writeAutoBackup(state) {
  const day = todayISO()
  // A folder the person chose (Android, #161) comes first. When it can no longer be written —
  // the permission revoked, the folder deleted, the sync app gone — the copy goes to the default
  // folder after all, and Settings says so: a backup that silently stops is the one thing this
  // feature must not do.
  if (await writeToChosenFolder(state, day)) return
  let fs
  try { fs = await import('@capacitor/filesystem') } catch (e) { return }
  const write = name => fs.Filesystem.writeFile({
    path: `${AUTO_BACKUP_DIR}/${name}`,
    directory: fs.Directory.Documents,
    data: JSON.stringify(state),
    encoding: fs.Encoding.UTF8,
    recursive: true,
  })
  // The day's names in turn: a second earlier install (or a third) can own the first two, and that
  // day then went without a copy, silently, while the newest file there was another install's.
  let name = null
  for (const suffix of ['', '-2', '-3', '-4', '-5', '-6', '-7', '-8', '-9']) {
    const n = `opengym-backup-${day}${suffix}.json`
    try { await write(n); name = n; break } catch (e) { /* owned by another install, or the disk said no: the next name */ }
  }
  if (!name) return   // best effort — the private mirror in Directory.Data still has the data
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
/* ------------------------------------------------- the backup folder (#161) --
   Android only: the system folder picker (Storage Access Framework) through the local
   BackupFolder plugin (android/.../BackupFolderPlugin.java), since @capacitor/filesystem cannot
   write into a picked folder. The choice is a fact of this phone, kept in its own private file
   and never in S: S syncs and exports, and a content:// address means nothing anywhere else.

   { uri, label }       the chosen folder, and its name as the picker showed it
   { lost, lostLabel }  the folder stopped accepting copies; they go to Documents/openGym again
   {}                   the default, Documents/openGym */
export const BACKUP_FOLDER_FILE = 'opengym-backup-folder.json'

// The plugin proxy lives here and is never handed through a promise: a Capacitor plugin proxy
// answers every property, `then` included, so a promise resolving to it never settles (#42/#58).
let folderPlugin = null
async function loadFolderPlugin() {
  if (folderPlugin) return
  const { registerPlugin } = await import('@capacitor/core')
  folderPlugin = registerPlugin('BackupFolder')
}

let folderState = null   // the file's content once read; {} for the default
const folderListeners = new Set()
const setFolderState = async next => {
  folderState = next
  await writeJsonFile(BACKUP_FOLDER_FILE, next)
  folderListeners.forEach(fn => { try { fn(next) } catch (e) { /* a listener's problem */ } })
}

/** Where auto-backup writes on this phone: { uri, label } | { lost, lostLabel } | {}. */
export async function backupFolder() {
  if (!folderState) {
    const saved = await readJsonFile(BACKUP_FOLDER_FILE)
    folderState = saved && typeof saved === 'object' ? saved : {}
  }
  return folderState
}

/** Settings listens, so a fallback in the middle of a backup shows without a reload. */
export function onBackupFolderChange(fn) {
  folderListeners.add(fn)
  return () => folderListeners.delete(fn)
}

/** Opens the system folder picker. Resolves to the new state, or null when cancelled. */
export async function chooseBackupFolder() {
  await loadFolderPlugin()
  const picked = await folderPlugin.pick()
  if (!picked?.uri) return null
  const before = await backupFolder()
  if (before.uri && before.uri !== picked.uri) await releaseFolder(before.uri)
  const next = { uri: picked.uri, label: picked.label || null }
  await setFolderState(next)
  return next
}

/** Back to Documents/openGym; also how the warning about a lost folder is put away. */
export async function resetBackupFolder() {
  const before = await backupFolder()
  if (before.uri) await releaseFolder(before.uri)
  await setFolderState({})
  return folderState
}

async function releaseFolder(uri) {
  try { await loadFolderPlugin(); await folderPlugin.release({ uri }) } catch (e) { /* already gone */ }
}

// True when today's copy is in the chosen folder. False with no folder chosen, and after a
// failure, which is recorded so Settings can say the copies went to the default folder.
async function writeToChosenFolder(state, day) {
  const folder = await backupFolder()
  if (!folder.uri) return false
  const name = `opengym-backup-${day}.json`
  try {
    await loadFolderPlugin()
    const { ok } = await folderPlugin.check({ uri: folder.uri })
    if (!ok) throw new Error('permission lost')
    await folderPlugin.write({ uri: folder.uri, name, data: JSON.stringify(state) })
  } catch (e) {
    await setFolderState({ lost: true, lostLabel: folder.label || null })
    await releaseFolder(folder.uri)
    return false
  }
  // Pruning waits for a successful write, and only ever touches the app's own dated names.
  try { await folderPlugin.prune({ uri: folder.uri, keep: AUTO_BACKUP_KEEP, pattern: AUTO_BACKUP_NAME.source, written: name }) } catch (e) { /* housekeeping */ }
  return true
}

// Tests only: forget the cached choice, as a fresh start of the app would.
export function _resetBackupFolder() { folderState = null; folderPlugin = null; folderListeners.clear() }
