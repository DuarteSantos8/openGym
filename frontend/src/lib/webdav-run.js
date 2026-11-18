// Backup to WebDAV (#582): the runs, as the app does them. lib/webdav.js holds the rules and the
// client; this file wires them to the store, the secure storage and the network, and keeps one
// run at a time. The daily one starts from App.jsx (on start, on coming back to the app, and
// every hour while it is open); Back up now and Restore from the sheet (components/WebDavBackup.jsx).
import { useStore } from '../store/useStore.js'
import { secureGet, secureSet, secureRemove } from './coach-secrets.js'
import { nativeFetch } from './capacitor-fetch.js'
import { davClient, backupTo, readBackup, loadConfig, saveConfig, isDue, ownership, DavError, SECRET_KEY } from './webdav.js'

let running = null

/**
 * Who is using the app right now, as WebDAV settings remember it: the signed-in (or paired)
 * account, or 'local' for a guest or a phone in local mode. null while the app is still starting
 * and does not know yet.
 */
export function currentOwner(st = useStore.getState()) {
  if (!st.ready) return null
  return st.user?.id ? 'u:' + st.user.id : 'local'
}

/**
 * Settings from before they had an owner are taken as the active one's, once the app knows who
 * that is: on that device they were almost surely theirs. Returns the settings as they are now.
 */
export function claimWebdav(owner = currentOwner()) {
  const cfg = loadConfig()
  if (cfg && !cfg.owner && owner) return saveConfig({ ...cfg, owner })
  return cfg
}

/** The settings as the screens see them: with `foreign` when another account set them up here. */
export function webdavView(cfg = loadConfig(), owner = currentOwner()) {
  if (!cfg) return null
  return owner && ownership(cfg, owner) === 'foreign' ? { ...cfg, foreign: true } : cfg
}

// Nothing goes up to and nothing comes down from another person's folder.
const guard = cfg => {
  const owner = currentOwner()
  if (!owner) throw new DavError('not-ready')
  if (ownership(cfg && !cfg.owner ? claimWebdav(owner) : cfg, owner) === 'foreign') throw new DavError('foreign')
}

export const getPassword = () => secureGet(SECRET_KEY)
export const setPassword = v => secureSet(SECRET_KEY, v)

/** Forget this device's WebDAV settings and password (the backups on the server stay). */
export async function forgetWebdav() {
  saveConfig(null)
  await secureRemove(SECRET_KEY)
}

export async function clientFor(cfg = loadConfig(), password = null, fetchFn = nativeFetch) {
  if (!cfg) throw new DavError('bad-url')
  const pass = password ?? await getPassword()
  if (!pass) throw new DavError('no-password')
  return davClient({ url: cfg.url, user: cfg.user, password: pass, fetchFn })
}

const hasSomething = S => !!(S && ((S.workouts || []).length || (S.routines || []).length || (S.bodyweight || []).length))

/**
 * One backup now. `manual` runs it whatever the schedule says; the daily one only when due.
 * Resolves { ok, name? , skipped?, error? } and never throws; the outcome is kept in the config
 * for the sheet to show.
 */
export function runBackup({ manual = false, now = Date.now(), fetchFn = nativeFetch } = {}) {
  if (running) return running
  running = (async () => {
    const cfg = loadConfig()
    if (!cfg) return { ok: false, skipped: 'off' }
    try { guard(cfg) } catch (e) { return manual ? { ok: false, error: e } : { ok: false, skipped: e.code } }
    if (!manual && !isDue(cfg, now)) return { ok: false, skipped: 'not-due' }
    const S = useStore.getState().S
    if (!hasSomething(S)) {
      if (manual) return { ok: false, error: new DavError('empty') }
      return { ok: false, skipped: 'empty' }
    }
    try {
      const client = await clientFor(cfg, null, fetchFn)
      const out = await backupTo(client, S, { now })
      saveConfig({ ...loadConfig(), lastOk: now, last: { at: now, ok: true, name: out.name } })
      return { ok: true, name: out.name }
    } catch (e) {
      const error = e instanceof DavError ? e : new DavError('http')
      saveConfig({ ...loadConfig(), last: { at: now, ok: false, msg: error.code } })
      return { ok: false, error }
    }
  })().finally(() => { running = null })
  return running
}

/** The list of backups in the folder, newest first. Throws a DavError. */
export async function listBackups({ fetchFn = nativeFetch } = {}) {
  guard(loadConfig())
  const client = await clientFor(loadConfig(), null, fetchFn)
  return client.index()
}

/** One backup's text, checked. Throws a DavError. */
export async function fetchBackup(name, { fetchFn = nativeFetch } = {}) {
  guard(loadConfig())
  const client = await clientFor(loadConfig(), null, fetchFn)
  return readBackup(client, name)
}
