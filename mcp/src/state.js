/* opengym-mcp state — reads ./data/state-<uid>.json + db.json (read-only). Cached by mtime so
   a session the api server just wrote is visible on the next tool call without a restart.

   Whose state: over stdio, the one profile init() resolves. Over HTTP (http.js), the profile the
   request's OAuth token belongs to, set for the duration of that request with asUser() — tools.js
   reads getState()/getUser() the same way in both. */
import fs from 'node:fs'
import path from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'

const DATA_DIR = process.env.OPENGYM_DATA || path.join(process.cwd(), 'data')

let _db = undefined
let _dbMtime = 0
let _uid = null
let _watcher = null
// uid -> { state, mtime }. state null = no state file (brand-new account).
const cache = new Map()
const scope = new AsyncLocalStorage()

// Runs fn with getState()/getUser() answering for uid, across everything fn awaits.
export const asUser = (uid, fn) => scope.run(uid, fn)
const currentUid = () => scope.getStore() ?? (init(), _uid)

// null means one thing only: the file is not there (an account that never synced from a device).
// Every other failure — no permission on the mount, a truncated or corrupt file — is a real fault,
// and reporting it as "no synced state yet, sign in from a device" sends the operator to fix the
// wrong thing while the data sits there unreadable.
function readJsonOrNull(file) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return null
    // Node's own message repeats the path it was given, and that is the server's absolute path:
    // the basename identifies the file just as well.
    const base = path.basename(file)
    const err = new Error(`cannot read ${base}: ${e.code || e.name} — ${String(e.message).replaceAll(file, base)}`)
    err.code = 'EIO'
    throw err
  }
  try {
    return JSON.parse(raw)
  } catch (e) {
    const err = new Error(`${path.basename(file)} is not valid JSON: ${e.message}`)
    err.code = 'EIO'
    throw err
  }
}

function reloadDb() {
  const file = path.join(DATA_DIR, 'db.json')
  try { _dbMtime = fs.statSync(file).mtimeMs } catch { _dbMtime = 0 }
  _db = readJsonOrNull(file) || { users: [], creds: [], subs: [], invites: [] }
}

// db.json as it is now: the api rewrites it on every sign-in, token and grant.
export function getDb() {
  let mtime
  try { mtime = fs.statSync(path.join(DATA_DIR, 'db.json')).mtimeMs } catch { return _db || { users: [] } }
  if (_db === undefined || mtime !== _dbMtime) reloadDb()
  return _db
}

function stateFile(uid) {
  return path.join(DATA_DIR, 'state-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json')
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
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => /^state-[a-zA-Z0-9_-]+\.json$/.test(f))
    .map(f => f.replace(/^state-/, '').replace(/\.json$/, ''))
  if (files.length === 1) return files[0]
  if (files.length === 0) {
    reloadDb()
    if (_db.users.length === 1) return _db.users[0].id
    if (_db.users.length === 0) throw new Error(`no openGym users found in ${path.join(DATA_DIR, 'db.json')} — sign in at least once on a device`)
    // Multiple users in db.json but no state file yet — hit when accounts exist but none has
    // signed in on a device.
    throw ambiguousUid(_db.users.map(u => u.id))
  }
  throw ambiguousUid(files)
}

// "Which profile?" is a config question for the operator, and this message travels as a tool
// result: into the model's context and into whatever transcript it lands in. Every account id on
// the box, plus the server's absolute paths, has no business there. The count and the setting to
// change are what the model can act on; the ids and the path go to the server log on stderr,
// where the operator is already reading the startup line.
function ambiguousUid(ids) {
  console.error(`[opengym-mcp] ${ids.length} openGym profiles in ${DATA_DIR}: ${ids.join(', ')} — set OPENGYM_UID to one of them`)
  const err = new Error(`this openGym data directory holds ${ids.length} profiles — set OPENGYM_UID to the one this server should read (the ids are on the server's stderr, and in db.json under "users"[].id)`)
  err.code = 'EINVAL'
  return err
}

// Idempotent. Picks the uid, loads db.json, attaches the watcher, primes state.
export function init() {
  if (_uid !== null) return
  if (!fs.existsSync(DATA_DIR)) throw new Error(`OPENGYM_DATA dir does not exist: ${DATA_DIR}`)
  _uid = resolveUid()
  reloadDb()
  const file = stateFile(_uid)
  if (_watcher) _watcher.close()
  // fs.watch is best-effort: the api server's atomic write at PUT /api/data is the source of
  // truth, and a stale read just gets corrected on the next change or the next tool call.
  try {
    _watcher = fs.watch(file, () => {
      // On change, simply clear the cache — the next getState() will re-read. Avoids reading
      // twice if the watcher fires multiple events for one atomic-write (rename + create).
      cache.delete(_uid)
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
  const uid = currentUid()
  const file = stateFile(uid)
  const hit = cache.get(uid)
  // Re-read if the file's mtime changed since our last load — covers watcher omissions and
  // platforms with no fs.watch.
  let mtime
  try { mtime = fs.statSync(file).mtimeMs } catch {
    return hit ? hit.state : null
  }
  if (!hit || mtime !== hit.mtime) {
    const fresh = readJsonOrNull(file)
    // Same shape the frontend builds on pullState — defaults merged with stored state so any
    // field the app added since the snapshot was last saved shows up undefined-safe. null: no
    // state file at all — never signed in on a device.
    cache.set(uid, { state: fresh ? Object.assign({}, defaultsShape(), fresh) : (hit ? hit.state : null), mtime })
  }
  return cache.get(uid).state
}

// Returns the user record (id + name). No passkey material, no VAPID keys, no push subs.
export function getUser() {
  const uid = currentUid()
  const u = getDb().users.find(x => x.id === uid) || { id: uid, name: 'Profile', created: null }
  return { id: u.id, name: u.name, created: u.created || null }
}

export const dataDir = () => DATA_DIR

// Test-only: work against a passed-in state, not the disk.
export function _seedStateForTests(state) {
  _uid = 'test-uid'
  _db = { users: [{ id: _uid, name: 'Test', created: '2026-07-26T00:00:00.000Z' }], creds: [], subs: [], invites: [] }
  cache.set(_uid, { state, mtime: Number.MAX_SAFE_INTEGER })   // never re-read from disk in a test
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
