// Backup to WebDAV (#582, idea by @Mahaveer1013): the JSON backup of Settings → Data & backup,
// written to a folder on a WebDAV server of your own (Nextcloud, ownCloud, a NAS, Apache or nginx
// with WebDAV, Koofr, …) once a day and whenever you tap Back up now, and read back from there
// on a new phone. No account with anyone, no server of openGym's in between: this device talks to
// your WebDAV server directly.
//
// What is kept where:
//   - the address, the user name and the switches: this device only (localStorage, CONFIG_KEY),
//     never S, which syncs to every device and rides in every backup
//   - the password (an app password, please): the platform's secure storage, like the Coach's
//     API key (lib/coach-secrets.js): the Keychain on iPhone, the Keystore on Android; a browser
//     has nothing better than its own storage
//   - whose it is (`owner`, see ownerOf in lib/webdav-run.js): the account or the local profile
//     that set it up. A device is sometimes shared: when someone else is signed in, nothing goes
//     up and nothing is read back, the sheet only offers Disconnect.
//
// Only GET, PUT and DELETE are used, plus one MKCOL to make the folder when it is missing: the
// phone apps send through native HTTP (no CORS there), and Android's HTTP stack knows no PROPFIND.
// So the folder holds an index of its own (INDEX_NAME) next to the dated backups, newest first.
// A browser needs the server to allow this origin (CORS): docs/WEBDAV_BACKUP.md.
//
// Kept: the newest KEEP backups, one per day (a second backup on a day replaces that day's).

export const CONFIG_KEY = 'gym_webdav_v1'
export const SECRET_KEY = 'webdav.password'
export const INDEX_NAME = 'opengym-backups.json'
export const KEEP = 14
export const DAY_MS = 86400000
// A daily backup is due once the last good one is this old (a little under a day, so one taken at
// 08:10 is due again at 08:00 the next morning).
export const DUE_MS = 20 * 3600000
export const NAME_RE = /^opengym-backup-\d{4}-\d{2}-\d{2}\.json$/

const store = () => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }

/** The folder address as it is used: https (or http on a home network), ending in a slash. */
export function folderUrl(raw) {
  let s = String(raw || '').trim()
  if (!s) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s
  let u
  try { u = new URL(s) } catch { return null }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (u.username || u.password) return null   // the name and password go in their own fields
  u.hash = ''
  u.search = ''
  if (!u.pathname.endsWith('/')) u.pathname += '/'
  return u.toString()
}

/** Why a typed address will not do, or null. */
export function urlProblem(raw) {
  const s = String(raw || '').trim()
  if (!s) return 'Paste the address of the folder on your WebDAV server.'
  let u
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s) } catch { return 'That does not look like an address.' }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'It has to start with https://.'
  if (u.username || u.password) return 'Leave the name and password out of the address, they have their own fields.'
  return null
}

const clean = c => {
  const url = folderUrl(c?.url)
  if (!url) return null
  const last = c?.last && typeof c.last === 'object' ? {
    at: Number.isFinite(c.last.at) ? c.last.at : 0,
    ok: c.last.ok === true,
    ...(typeof c.last.name === 'string' && NAME_RE.test(c.last.name) ? { name: c.last.name } : {}),
    ...(typeof c.last.msg === 'string' && c.last.msg ? { msg: c.last.msg.slice(0, 200) } : {}),
  } : null
  return {
    url,
    user: String(c?.user || '').slice(0, 200),
    daily: c?.daily !== false,
    lastOk: Number.isFinite(c?.lastOk) ? c.lastOk : 0,
    ...(last ? { last } : {}),
    ...(typeof c?.owner === 'string' && c.owner ? { owner: c.owner.slice(0, 200) } : {}),
  }
}

/** This device's WebDAV settings, or null when none are set up. */
export function loadConfig() {
  try { return clean(JSON.parse(store()?.getItem(CONFIG_KEY) || 'null')) } catch { return null }
}
export function saveConfig(c) {
  const v = c ? clean(c) : null
  try { if (v) store()?.setItem(CONFIG_KEY, JSON.stringify(v)); else store()?.removeItem(CONFIG_KEY) } catch { /* not kept */ }
  for (const fn of listeners) { try { fn(v) } catch { /* a listener's own problem */ } }
  return v
}
const listeners = new Set()
export const onConfigChange = fn => { listeners.add(fn); return () => listeners.delete(fn) }

/**
 * Whose the settings are, for the account or local profile `owner` that is active now:
 * 'mine', 'foreign' (set up by somebody else on this device), or null when none are set up.
 * Settings from before they had an owner are taken as the active one's (see claimWebdav).
 */
export function ownership(cfg, owner) {
  if (!cfg) return null
  return !cfg.owner || cfg.owner === owner ? 'mine' : 'foreign'
}

/** "Basic …" for a name and password, UTF-8 safe. */
export function basicAuth(user, pass) {
  const bytes = new TextEncoder().encode(`${user || ''}:${pass || ''}`)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return 'Basic ' + btoa(bin)
}

/** The day's backup file name. */
export const backupName = (day = new Date()) => {
  const d = day instanceof Date ? day : new Date(day)
  const p = n => String(n).padStart(2, '0')
  return `opengym-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`
}

/** An index as stored: our file names only, newest first, no repeats. */
export function cleanIndex(doc) {
  const list = Array.isArray(doc?.backups) ? doc.backups : []
  const seen = new Set()
  const out = []
  for (const b of list) {
    if (!b || typeof b.name !== 'string' || !NAME_RE.test(b.name) || seen.has(b.name)) continue
    seen.add(b.name)
    out.push({ name: b.name, at: Number.isFinite(b.at) ? b.at : 0, size: Number.isFinite(b.size) ? b.size : 0, ...(Number.isFinite(b.workouts) ? { workouts: b.workouts } : {}) })
  }
  return out.sort((a, b) => b.name.localeCompare(a.name) || b.at - a.at)
}

/** The index after a backup named `entry.name`: it first, the oldest past KEEP dropped (and returned). */
export function nextIndex(list, entry, keep = KEEP) {
  const all = cleanIndex({ backups: [entry, ...list.filter(b => b.name !== entry.name)] })
  return { list: all.slice(0, keep), drop: all.slice(keep).map(b => b.name) }
}

/** A refusal in the words the sheet shows. */
export class DavError extends Error {
  constructor(code, status = 0) { super(code); this.code = code; this.status = status }
}
export function errorText(e) {
  switch (e?.code) {
    case 'auth': return 'The server did not take that name and password. An app password usually works best.'
    case 'missing': return 'That folder is not there, and openGym could not make it. Make it on the server first.'
    case 'forbidden': return 'The server says this account may not write there.'
    case 'full': return 'The server is out of space for this account.'
    case 'network': return 'Could not reach the server. In a browser it also has to allow this site (CORS), see the guide.'
    case 'no-password': return 'Type the password again: this device does not have it.'
    case 'not-backup': return 'That file is not an openGym backup.'
    case 'empty': return 'Nothing to back up yet: log a workout first.'
    case 'foreign': return 'This backup belongs to another account'
    default: return 'The server answered with an error.'
  }
}

const statusError = status => new DavError(status === 401 ? 'auth' : status === 403 ? 'forbidden' : status === 404 || status === 409 ? 'missing' : status === 507 ? 'full' : 'http', status)

/**
 * A client for one folder. `fetchFn(url, { method, headers, body })` answers { ok, status, text() };
 * the app hands it lib/capacitor-fetch.js nativeFetch, which is the browser's fetch on the web.
 */
export function davClient({ url, user, password, fetchFn }) {
  const base = folderUrl(url)
  if (!base) throw new DavError('bad-url')
  const auth = basicAuth(user, password)
  const call = async (method, name, body, type) => {
    let res
    try {
      res = await fetchFn(name == null ? base : base + encodeURIComponent(name), {
        method, headers: { Authorization: auth, ...(type ? { 'Content-Type': type } : {}) }, ...(body != null ? { body } : {}),
      })
    } catch { throw new DavError('network') }
    return res
  }
  const api = {
    base,
    async get(name) {
      const res = await call('GET', name)
      if (res.status === 404) return null
      if (!res.ok) throw statusError(res.status)
      return res.text()
    },
    async put(name, text, type = 'application/json') {
      let res = await call('PUT', name, text, type)
      // The folder is missing: make it once, then try again.
      if (res.status === 404 || res.status === 409) {
        let made
        try { made = await call('MKCOL', null) } catch { throw new DavError('missing', res.status) }
        if (!(made.ok || made.status === 405)) throw statusError(made.status === 401 ? 401 : res.status)
        res = await call('PUT', name, text, type)
      }
      if (!res.ok) throw statusError(res.status)
    },
    async del(name) {
      const res = await call('DELETE', name)
      if (!(res.ok || res.status === 404)) throw statusError(res.status)
    },
    async index() {
      const text = await api.get(INDEX_NAME)
      if (!text) return []
      try { return cleanIndex(JSON.parse(text)) } catch { return [] }
    },
  }
  return api
}

const countOf = S => (Array.isArray(S?.workouts) ? S.workouts.length : 0)

/**
 * One backup: the state as JSON to today's file, the index updated, the oldest past KEEP deleted.
 * A delete that fails is left for the next run; the backup itself counts. → { name, size, at }
 */
export async function backupTo(client, S, { now = Date.now() } = {}) {
  const text = JSON.stringify(S, null, 2)
  const name = backupName(new Date(now))
  await client.put(name, text)
  const { list, drop } = nextIndex(await client.index(), { name, at: now, size: text.length, workouts: countOf(S) })
  await client.put(INDEX_NAME, JSON.stringify({ v: 1, app: 'openGym', backups: list }, null, 1))
  for (const old of drop) { try { await client.del(old) } catch { /* next time */ } }
  return { name, size: text.length, at: now }
}

/** A backup's text from the folder, checked to be one of ours (an object with our keys). */
export async function readBackup(client, name) {
  if (!NAME_RE.test(name)) throw new DavError('not-backup')
  const text = await client.get(name)
  if (text == null) throw new DavError('missing', 404)
  let doc
  try { doc = JSON.parse(text) } catch { throw new DavError('not-backup') }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new DavError('not-backup')
  return text
}

/** Whether a daily backup is due on this device now. */
export function isDue(cfg, now = Date.now()) {
  return !!(cfg && cfg.daily && (!cfg.lastOk || now - cfg.lastOk >= DUE_MS))
}
