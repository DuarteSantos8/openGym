/* opengym-mcp state — reads ./data/state-<uid>.json + db.json (read-only). Cached with an
   fs.watch + mtime fallback so a session the api server just wrote is visible on the next
   tool call without a restart. */
import fs from 'node:fs'
import path from 'node:path'

// DATA_DIR can be overridden per-request in HTTP mode (setActiveUser).
// In stdio mode it comes from the env var or cwd — set once at startup.
function resolveDataDir() {
  return _dataDir || process.env.OPENGYM_DATA || path.join(process.cwd(), 'data')
}

// null = no state file (brand-new account); undefined = not yet loaded.
let _state = undefined
let _db = undefined
let _uid = null
let _watcher = null
let _loadedMtime = 0    // mtimeMs we last read at — used to catch watcher omissions
let _dataDir = null     // current DATA_DIR (may differ from env default in HTTP mode)

function readJsonOrNull(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function reloadDb() {
  _db = readJsonOrNull(path.join(resolveDataDir(), 'db.json')) || { users: [], creds: [], subs: [], invites: [] }
}

function stateFile(uid) {
  return path.join(resolveDataDir(), 'state-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json')
}

// Pick the uid: OPENGYM_UID env, else the only state-* file, else the only user in db.json.
// Throws listing the options if ambiguous. The sanitiser on stateFile() keeps a sneaky
// '..' in OPENGYM_UID harmless.
function resolveUid() {
  const envUid = (process.env.OPENGYM_UID || '').trim()
  if (envUid) {
    if (!/^[a-zA-Z0-9_-]+$/.test(envUid)) throw new Error(`OPENGYM_UID contains characters that aren't safe in a filename: ${JSON.stringify(envUid)}`)
    return envUid
  }
  const files = fs.readdirSync(resolveDataDir())
    .filter(f => /^state-[a-zA-Z0-9_-]+\.json$/.test(f))
    .map(f => f.replace(/^state-/, '').replace(/\.json$/, ''))
  if (files.length === 1) return files[0]
  if (files.length === 0) {
    reloadDb()
    if (_db.users.length === 1) return _db.users[0].id
    if (_db.users.length === 0) throw new Error(`no openGym users found in ${path.join(resolveDataDir(), 'db.json')} — sign in at least once on a device`)
    // Multiple users in db.json but no state files yet — list their ids, not the (empty)
    // files list. Hit when accounts exist but none has signed in on a device.
    throw new Error(
      `multiple openGym users found — set OPENGYM_UID to one of: ${_db.users.map(u => u.id).join(', ')}\n` +
      `  (look them up in ${path.join(resolveDataDir(), 'db.json')} under "users"[].id)`
    )
  }
  throw new Error(
    `multiple openGym users found — set OPENGYM_UID to one of: ${files.join(', ')}\n` +
    `  (look them up in ${path.join(resolveDataDir(), 'db.json')} under "users"[].id)`
  )
}

// Idempotent in stdio mode (returns early if already initialized).
// Picks the uid, loads db.json, attaches the watcher, primes state.
export function init() {
  if (_uid !== null) return
  const dir = resolveDataDir()
  _dataDir = dir
  if (!fs.existsSync(dir)) throw new Error(`OPENGYM_DATA dir does not exist: ${dir}`)
  _uid = resolveUid()
  reloadDb()
  const file = stateFile(_uid)
  if (fs.existsSync(file)) {
    _state = readJsonOrNull(file)
    if (_state) _state = Object.assign({}, defaultsShape(), _state)
    try { _loadedMtime = fs.statSync(file).mtimeMs } catch {}
  }
  if (_watcher) _watcher.close()
  // fs.watch is best-effort: the api server's atomic write at PUT /api/data is the source of
  // truth, and a stale read just gets corrected on the next change or the next tool call.
  try {
    _watcher = fs.watch(file, () => {
      // On change, simply clear the cache — the next getState() will re-read. Avoids reading
      // twice if the watcher fires multiple events for one atomic-write (rename + create).
      _state = undefined
      _loadedMtime = 0
    })
    // Unref'd, or the watcher alone holds the event loop open and the process outlives the
    // client that spawned it — "exits when the LLM client disconnects" stops being true the
    // moment there is a state file to watch. Most clients kill the child anyway, but one that
    // merely closes the pipe would leak a process per session. Watching is unaffected: the
    // stdio transport is what keeps the loop alive while a client is actually attached.
    _watcher.unref()
  } catch { /* fs.watch unsupported on this platform; tools will re-read on mtime change */ }
}

// Returns the state object, or null for a fresh account that never signed in on a device.
export function getState() {
  init()
  const file = stateFile(_uid)
  // Re-read if the file's mtime changed since our last load — covers watcher omissions and
  // platforms with no fs.watch.
  let mtime
  try { mtime = fs.statSync(file).mtimeMs } catch {
    return _state === undefined ? null : _state
  }
  if (_state === undefined || mtime !== _loadedMtime) {
    const fresh = readJsonOrNull(file)
    if (fresh) {
      // Same shape the frontend builds on pullState — defaults merged with stored state so any
      // field the app added since the snapshot was last saved shows up undefined-safe.
      _state = Object.assign({}, defaultsShape(), fresh)
      _loadedMtime = mtime
    } else if (_state === undefined) {
      _state = null  // no state file at all — never signed in on a device
    }
  }
  return _state
}

// Returns the user record (id + name). No passkey material, no VAPID keys, no push subs.
export function getUser() {
  init()
  const u = _db.users.find(x => x.id === _uid) || { id: _uid, name: 'Profile', created: null }
  return { id: u.id, name: u.name, created: u.created || null }
}

export const dataDir = () => resolveDataDir()

// Switch the active user mid-process (HTTP mode). Resets watcher, state, and db so the next
// getState() call reads the new user's files. In stdio mode this is never called — the process
// serves one user for its entire lifetime.
export function setActiveUser(uid, dataDirPath) {
  if (_watcher) { _watcher.close(); _watcher = null }
  _state = undefined
  _db = undefined
  _uid = null
  _loadedMtime = 0
  _dataDir = dataDirPath || null
  process.env.OPENGYM_UID = uid
  init()
}

// Test-only: work against a passed-in state, not the disk.
export function _seedStateForTests(state) {
  _uid = 'test-uid'
  _db = { users: [{ id: _uid, name: 'Test', created: '2026-07-26T00:00:00.000Z' }], creds: [], subs: [], invites: [] }
  _state = state
  _loadedMtime = Number.MAX_SAFE_INTEGER   // never re-read from disk in a test
  if (_watcher) { _watcher.close(); _watcher = null }
}

function defaultsShape() {
  return {
    unit: 'kg', restSec: 90, sound: true, lang: 'en',
    theme: 'dark', accent: 'lime', body: 'male', targetW: null,
    bodyweight: [], routines: [], week: {}, dayPlan: {},
    exWeights: {}, workouts: [], customEx: [], gifSize: 'full',
    reminder: { on: false, time: '08:00', tz: null }
  }
}
