/* opengym-mcp state — reads ./data/state-<uid>.json + db.json (read-only). Cached with an
   fs.watch + mtime fallback so a session the api server just wrote is visible on the next
   tool call without a restart.

   Or, with OPENGYM_URL and OPENGYM_TOKEN set and no OPENGYM_DATA, reads through the api the way a
   device does: GET /api/me for whose profile it is, GET /api/data for the document, and the cheap
   GET /api/data/rev before each tool call to skip the download when nothing moved. Then nothing
   here touches the disk, and the MCP needs no access to the folder that holds every profile. */
import fs from 'node:fs'
import path from 'node:path'
import { apiConfig, apiFetch } from './api-client.js'

const DATA_DIR = process.env.OPENGYM_DATA || path.join(process.cwd(), 'data')
// Whether a data directory was asked for, as opposed to the ./data guess.
const DATA_SET = !!process.env.OPENGYM_DATA

// null = no state file (brand-new account); undefined = not yet loaded.
let _state = undefined
let _db = undefined
let _uid = null
let _watcher = null
let _loadedMtime = 0    // mtimeMs we last read at — used to catch watcher omissions
let _seeded = false     // a test's in-memory state, never compared with the disk
let _apiUser = null     // { id, name, created } from GET /api/me, in api mode
let _apiRev = null      // the { rev, wid } the cached document was downloaded at, in api mode

/** Whether reads go through the api: a URL and token given, and no data directory asked for. */
export function apiMode(env = process.env) {
  return !(env.OPENGYM_DATA || '').trim() && !!(env.OPENGYM_URL || '').trim() && !!(env.OPENGYM_TOKEN || '').trim()
}

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

function reloadDb() { _db = readJsonOrNull(path.join(DATA_DIR, 'db.json')) || { users: [], creds: [], subs: [], invites: [] } }

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
  if (_uid !== null || apiMode()) return
  if (!fs.existsSync(DATA_DIR)) throw new Error(`OPENGYM_DATA dir does not exist: ${DATA_DIR}`)
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
  if (apiMode() && !_seeded) {
    if (_state === undefined) throw notRefreshed()
    return _state
  }
  init()
  const file = stateFile(_uid)
  // Re-read if the file's mtime changed since our last load — covers watcher omissions and
  // platforms with no fs.watch.
  let mtime
  try { mtime = fs.statSync(file).mtimeMs } catch (e) {
    if (_seeded) return _state
    // Gone (the account was deleted, say): without a watcher the cached profile used to be
    // served on and on. Anything else gets the read below, which reports it as the fault it is.
    if (e.code === 'ENOENT') { _state = null; _loadedMtime = 0; return null }
    mtime = NaN
  }
  if (_state === undefined || mtime !== _loadedMtime) {
    const fresh = readJsonOrNull(file)
    if (fresh) {
      // Same shape the frontend builds on pullState — defaults merged with stored state so any
      // field the app added since the snapshot was last saved shows up undefined-safe.
      _state = Object.assign({}, defaultsShape(), fresh)
      _loadedMtime = mtime
    } else {
      // No state file at all (never signed in on a device), or it went between stat and read.
      _state = null
      _loadedMtime = 0
    }
  }
  return _state
}

// Returns the user record (id + name). No passkey material, no VAPID keys, no push subs.
export function getUser() {
  if (apiMode() && !_seeded) {
    if (!_apiUser) throw notRefreshed()
    return { ..._apiUser }
  }
  init()
  const u = _db.users.find(x => x.id === _uid) || { id: _uid, name: 'Profile', created: null }
  return { id: u.id, name: u.name, created: u.created || null }
}

export const dataDir = () => DATA_DIR

// The profile this server is set up for, which log_workout holds a token against: OPENGYM_UID
// when it is given, whether or not its data is readable here, else the one the data directory
// names. null only when nothing names one: no OPENGYM_UID, no OPENGYM_DATA and no ./data, the
// remote-server setup. A data directory that was asked for and cannot be read, or that holds
// several profiles, throws: a broken mount is no licence to write to whichever profile the token is.
export function localUid() {
  if (_uid !== null) return _uid
  // Reading through the api, the profile read is the token's own: nothing to compare it with.
  if (apiMode()) return null
  const envUid = (process.env.OPENGYM_UID || '').trim()
  if (envUid) return envUid
  if (!DATA_SET && !fs.existsSync(DATA_DIR)) return null
  init()
  return _uid
}

// Drop the cached state, so the next read sees a write log_workout just made without waiting for
// the watcher. Only meaningful when this data directory is the one the server writes.
export function invalidate() {
  _state = undefined
  _loadedMtime = 0
  _apiRev = null
}

function notRefreshed() {
  const err = new Error('the profile was not loaded from the openGym server (refresh() first)')
  err.code = 'EIO'
  return err
}

/**
 * In api mode, bring the cached profile up to date before a tool reads it: GET /api/data/rev, and
 * the whole document only when the revision moved (or was never read). A no-op otherwise, so
 * index.js can await it before every read tool. `fetchImpl` and `env` are for tests.
 */
export async function refresh({ env = process.env, fetchImpl } = {}) {
  if (_seeded || !apiMode(env)) return
  const cfg = apiConfig(env)
  const opts = fetchImpl ? { fetchImpl } : {}
  if (!_apiUser) {
    const me = await apiFetch(cfg, '/api/me', opts)
    const u = me.body?.user
    if (!u || typeof u.id !== 'string' || !u.id) {
      const err = new Error('the openGym server did not say which profile OPENGYM_TOKEN belongs to (GET /api/me)')
      err.code = 'EAPI'
      throw err
    }
    _apiUser = { id: u.id, name: typeof u.name === 'string' ? u.name : 'Profile', created: u.created || null }
  }
  if (_state !== undefined && _apiRev) {
    const now = await apiFetch(cfg, '/api/data/rev', opts)
    // The write id too: a restored backup can come back at a revision already seen.
    if (now.body?.rev === _apiRev.rev && (now.body?.wid ?? null) === _apiRev.wid) return
  }
  const got = await apiFetch(cfg, '/api/data', opts)
  const doc = got.body?.state
  // The same defaults the file read merges in; null is a profile that never synced from a device.
  _state = doc && typeof doc === 'object' && !Array.isArray(doc) ? Object.assign({}, defaultsShape(), doc) : null
  _apiRev = { rev: got.body?.rev ?? 0, wid: typeof doc?._wid === 'string' ? doc._wid : null }
}

// Test-only: work against a passed-in state, not the disk.
export function _seedStateForTests(state) {
  _uid = 'test-uid'
  _db = { users: [{ id: _uid, name: 'Test', created: '2026-07-26T00:00:00.000Z' }], creds: [], subs: [], invites: [] }
  _state = state
  _loadedMtime = Number.MAX_SAFE_INTEGER   // never re-read from disk in a test
  _seeded = true
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
