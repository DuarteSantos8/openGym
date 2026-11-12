// Health Connect on the Android app (#200): turning it on, and keeping it in step with the log.
// What gets written is worked out in lib/health-connect.js; this file owns the native plugin
// (HealthConnectPlugin.java) and the phone's own record of what it wrote.
//
// It is a fact about this phone, not about the training log: kept in its own file in the app's
// data directory, never in S, so it does not sync to a server, ride in a backup, or switch on a
// second phone. Off until the user turns it on; nothing is asked of Health Connect before that.
//
// The iPhone app does the same with Apple Health (AppleHealthPlugin.swift): the same calls, the
// same records, the same file. There it also asks to read the heart rate and the body weight, for
// the Apple Watch app (its workout session shows the heart rate per set), and tells the watch
// whether it is on (setEnabled: the App Group's "healthEnabled", which the watch link passes on).
//
// Since v1.4.3 it can also read two things back (#544, #127), each behind a switch of its own and
// off by default: the heart rate during a finished workout (for any watch that saves to the hub,
// not just the Apple Watch), and weigh-ins other apps saved there. Only while the app is open, only
// the workouts of the last day and the weigh-ins since the last read (30 days the first time), so
// no background or history permission is asked for. What it decides is in lib/health-read.js.
//
// The web build never gets here (MOBILE is a build-time flag).
import { mergeHeartRate, mergeWeighIns, lacksHeartRate } from './health-read.js'
import { MOBILE, nativePlatform, readJsonFile, writeJsonFile } from './mobile.js'
import { healthRecords, planSync, writtenIds, goneIds } from './health-connect.js'
import { isOn } from './modules.js'
import { exerciseNameFor } from './i18n-core.js'
import { EXIDX } from './exercises.js'
import { speedUnitOf } from './speed.js'

export const HEALTH_FILE = 'opengym-health.json'
const OFF = { on: false, written: {}, at: 0, error: null, readHr: false, readWeight: false, wHistory: false, wCursor: 0, seen: {}, hrTried: {}, readError: null, watchOwned: {}, watchDeferred: {} }

// A finish the watch could not confirm (the app died, or Health could not be read). The phone
// closes the workout and does not write Apple Health for this long: long enough for a locked
// watch to save on unlock, short enough that a save which never comes still gets a phone copy.
export const WATCH_HEALTH_WAIT_MS = 24 * 60 * 60 * 1000

// Wrapped in an object, as in rest-alert.js: a Capacitor plugin proxy answers `then`, so a
// promise resolved with the bare proxy never settles.
let pluginP = null
const plugin = () => pluginP || (pluginP = (async () => {
  const platform = await nativePlatform()
  if (!platform) return null
  const { registerPlugin } = await import('@capacitor/core')
  return { HC: registerPlugin(platform === 'ios' ? 'AppleHealth' : 'HealthConnect'), platform }
})().catch(() => null))

// iPhone: the switch as the watch reads it. Android has no watch to tell.
async function mirrorOn(on) {
  const p = await plugin().catch(() => null)
  if (p?.platform === 'ios') await p.HC.setEnabled({ on: !!on }).catch(() => {})
}

// The file's content, read once and then kept here: a save while it is off (the usual case) must
// not cost a file read, and every change to it goes through saveHealth anyway.
let cached = null
// Noted before the file is read (a finish as the app opens). Folded in on the next load or save.
const pendingOwned = new Set()
// id -> earliest moment the phone may write, when the watch has not confirmed the save.
const pendingDeferred = new Map()
// The generation at which an id was put on the in-memory copy. It is confirmed only once a
// write of that generation, or a later one, has reached disk.
const ownedAt = new Map()
const deferredAt = new Map()
let generation = 0
let durable = 0
let flushing = null

const watchSyncId = wid => (typeof wid === 'string' && wid ? (wid.startsWith('opengym-w-') ? wid : 'opengym-w-' + wid) : null)

// One write at a time, always of the latest copy. A sync that captured an older copy cannot
// land after a watch note and wipe it: the note changes the copy, and the write loops.
function flush() {
  if (flushing) return flushing
  flushing = (async () => {
    let failed = false
    try {
      while (durable < generation) {
        const gen = generation
        const snapshot = cached
        const ok = await writeJsonFile(HEALTH_FILE, snapshot)
        if (ok === false) { failed = true; return false }
        if (generation === gen) durable = gen
      }
      return true
    } finally {
      flushing = null
      // A note that arrived as this write finished still has to land. A failed write waits for
      // the next call: retrying here would spin while the file stays unwritable.
      if (!failed && durable < generation) flush()
    }
  })()
  return flushing
}

// Watch maps stay the ones on the live copy. `h` updates the rest (what was written, whether
// sync is on). Pending notes are folded in, so a finish during a save still lands.
const saveHealth = h => {
  const gen = ++generation
  // A live copy wins over the caller's maps: those were captured before an await and are stale.
  // With no live copy yet, the caller's maps are the file just read.
  const watchOwned = { ...(cached?.watchOwned || {}), ...(cached ? {} : (h?.watchOwned || {})) }
  const watchDeferred = { ...(cached?.watchDeferred || {}), ...(cached ? {} : (h?.watchDeferred || {})) }
  for (const id of pendingOwned) watchOwned[id] = 1
  for (const [id, until] of pendingDeferred) if (!watchOwned[id]) watchDeferred[id] = until
  pendingOwned.clear()
  pendingDeferred.clear()
  for (const id of Object.keys(watchDeferred)) if (watchOwned[id]) delete watchDeferred[id]
  cached = { ...h, watchOwned, watchDeferred }
  return flush().then(ok => !!(ok && durable >= gen))
}

/** The watch saved this workout to Apple Health. This phone must not write over it. */
// True once the id is on disk (or already was). False when the file write failed: the id stays
// on the copy, and the caller keeps the watch event so the next drain tries again.
export function noteWatchOwned(wid) {
  const id = watchSyncId(wid)
  if (!id) return true
  pendingDeferred.delete(id)
  if (!cached) { pendingOwned.add(id); return true }
  const at = ownedAt.get(id)
  if (cached.watchOwned?.[id] && at && durable >= at) return true
  const watchDeferred = { ...(cached.watchDeferred || {}) }
  delete watchDeferred[id]
  cached = { ...cached, watchOwned: { ...(cached.watchOwned || {}), [id]: 1 }, watchDeferred }
  const wrote = saveHealth(cached)
  ownedAt.set(id, generation)
  return wrote.then(ok => !!(ok && durable >= ownedAt.get(id)))
}

/**
 * The watch finished this workout and could not say whether Apple Health has it. The phone
 * keeps its own copy out until `at` plus a day, then writes. True once that is on disk.
 */
export function noteHealthDeferred(wid, at) {
  const id = watchSyncId(wid)
  if (!id) return true
  // Already owned on disk: nothing to wait for. Owned only in memory, after a failed write: the
  // ownership write has to finish before this event can be acknowledged.
  if (cached?.watchOwned?.[id]) {
    const noted = ownedAt.get(id)
    if (!noted || durable >= noted) return true
    return noteWatchOwned(wid)
  }
  const until = (Number(at) > 0 ? Number(at) : Date.now()) + WATCH_HEALTH_WAIT_MS
  if (!cached) { pendingDeferred.set(id, until); return true }
  const noted = deferredAt.get(id)
  if ((cached.watchDeferred?.[id] || 0) >= until && noted && durable >= noted) return true
  cached = { ...cached, watchDeferred: { ...(cached.watchDeferred || {}), [id]: until } }
  const wrote = saveHealth(cached)
  deferredAt.set(id, generation)
  return wrote.then(ok => !!(ok && durable >= deferredAt.get(id)))
}

/** The watch's save failed. The phone may write this workout on the next sync. */
export function clearHealthDeferred(wid) {
  const id = watchSyncId(wid)
  if (!id) return true
  pendingDeferred.delete(id)
  deferredAt.delete(id)
  if (!cached?.watchDeferred?.[id]) return true
  const watchDeferred = { ...(cached.watchDeferred || {}) }
  delete watchDeferred[id]
  cached = { ...cached, watchDeferred }
  return saveHealth(cached)
}

/** Ids remembered so far, including ones waiting for the file. For tests. */
export function watchOwnedIds() {
  const ids = new Set(pendingOwned)
  if (cached?.watchOwned) for (const id of Object.keys(cached.watchOwned)) if (cached.watchOwned[id]) ids.add(id)
  return [...ids]
}

/** Ids whose phone write is still waiting, including ones not on disk yet. For tests. */
export function watchDeferredIds(now = Date.now()) {
  const ids = new Set()
  for (const [id, until] of pendingDeferred) if (until > now) ids.add(id)
  if (cached?.watchDeferred) for (const [id, until] of Object.entries(cached.watchDeferred)) if (until > now) ids.add(id)
  return [...ids]
}

export function _resetWatchOwned() {
  pendingOwned.clear()
  pendingDeferred.clear()
  ownedAt.clear()
  deferredAt.clear()
  if (!cached) return
  cached = { ...cached, watchOwned: {}, watchDeferred: {} }
  generation += 1
  durable = generation
  return writeJsonFile(HEALTH_FILE, cached)
}

export async function loadHealth() {
  if (cached) return cached
  const f = await readJsonFile(HEALTH_FILE)
  // A concurrent load already stored a copy that includes ownership noted since then.
  if (cached) return cached
  const map = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
  cached = f && typeof f === 'object' ? { ...OFF, ...f, written: map(f.written), seen: map(f.seen), hrTried: map(f.hrTried), watchOwned: map(f.watchOwned), watchDeferred: map(f.watchDeferred) } : { ...OFF }
  if (pendingOwned.size || pendingDeferred.size) await saveHealth(cached)
  return cached
}

// The file plus anything noted since this object was copied, so a sync already running
// does not save over a watch workout it just learned about.
function liveOwned(h) {
  const watchOwned = { ...(h?.watchOwned || {}), ...(cached?.watchOwned || {}) }
  for (const id of pendingOwned) watchOwned[id] = 1
  return watchOwned
}
const withOwned = h => ({ ...h, watchOwned: liveOwned(h) })
const ownedSet = map => {
  const ids = Object.keys(map || {}).filter(id => map[id])
  return ids.length ? new Set(ids) : null
}

/** { status: 'available' | 'update' | 'missing' | 'unsupported', granted, platform } */
export async function healthStatus() {
  if (!MOBILE) return { status: 'unsupported', granted: false, platform: null }
  try {
    const p = await plugin()
    if (!p) return { status: 'unsupported', granted: false, platform: null }
    return { ...(await p.HC.status()), platform: p.platform }
  } catch { return { status: 'unsupported', granted: false, platform: null } }
}

/** Health Connect's own screen for what apps wrote, or its store page where it is missing. */
export async function openHealthConnect() {
  const p = await plugin()
  if (p) await p.HC.openSettings()
}

const nameOf = e => (EXIDX[e.id] ? exerciseNameFor(EXIDX[e.id]) : (e.n || e.id))

// One sync at a time. A change that comes in while one runs is not lost: the running one is
// followed by a single further pass with the newest state.
let running = null
let again = null
const listeners = new Set()
/** Called with the file's new content after every sync, for the Settings row. */
export function onHealthChange(cb) { listeners.add(cb); return () => listeners.delete(cb) }
const told = h => { listeners.forEach(cb => { try { cb(h) } catch { /* a closed screen */ } }) }

/**
 * Writes what changed since the last sync and removes what was deleted from openGym. A no-op
 * while it is off. Resolves with the file's content afterwards; `error` is 'permission' when
 * Health Connect refused (the user took the permission back), 'unavailable' when it is gone.
 */
export function syncHealth(S) {
  if (!MOBILE) return Promise.resolve(null)
  // Not read yet: initHealthSync reads it at launch and syncs then, which covers a save made
  // before that; the save path itself never waits on the file.
  if (!cached || !cached.on) return Promise.resolve(cached)
  // Settings → Modules: Health off pauses the sync. Nothing is disconnected; switched back on, the
  // next save writes everything that changed meanwhile (planSync compares with what was written).
  if (S && !isOn(S, 'health')) return Promise.resolve(cached)
  if (running) { again = S; return running }
  again = null
  running = (async () => {
    let h = await loadHealth()
    let next = S
    while (next) {
      if (h.on) h = await syncOnce(next, h)
      // A state that came in meanwhile, taken only now: cleared before a pass, it would lose a
      // change made while the pass was starting.
      next = again
      again = null
    }
    return h
  })().finally(() => { running = null })
  return running
}

const deferredActive = (h, now = Date.now()) => new Set(Object.keys(h.watchDeferred || {}).filter(id => h.watchDeferred[id] > now))

// A watch copy that has since appeared becomes owned, and this phone stops waiting to write it.
async function settleDeferred(p, h) {
  const ids = [...deferredActive(h)]
  if (!ids.length || p.platform !== 'ios') return h
  const res = await p.HC.probeWatch({ ids }).catch(() => null)
  const found = Array.isArray(res?.found) ? res.found.filter(id => ids.includes(id)) : []
  if (!res?.readable || !found.length) return h
  const watchOwned = { ...(cached?.watchOwned || {}) }
  const watchDeferred = { ...(cached?.watchDeferred || {}) }
  for (const id of found) {
    watchOwned[id] = 1
    delete watchDeferred[id]
    pendingOwned.delete(id)
    pendingDeferred.delete(id)
  }
  cached = { ...(cached || h), watchOwned, watchDeferred }
  const wrote = saveHealth(cached)
  for (const id of found) ownedAt.set(id, generation)
  await wrote
  return cached
}

async function syncOnce(S, h) {
  const p = await plugin()
  if (!p) return h
  h = await settleDeferred(p, withOwned(h))
  const records = healthRecords(S, { nameOf, speedUnit: speedUnitOf(S) })
  // Owned, and anything still inside the wait, are left out. The plan is built again immediately
  // before the write, from ownership learned since the last await.
  const planOf = hh => planSync(
    { ...records, sessions: records.sessions.filter(s => !deferredActive(hh).has(s.id)) },
    hh.written, goneIds(S), ownedSet(hh.watchOwned),
  )
  let plan = planOf(h)
  const nothing = !plan.sessions.length && !plan.weights.length && !plan.remove.sessions.length && !plan.remove.weights.length
  if (nothing) {
    if (!h.error) return h
    // Nothing to write, but the last attempt failed: clear it once Health Connect says yes again.
    const st = await p.HC.status().catch(() => null)
    if (!(st?.status === 'available' && st.granted)) return h
    const out = withOwned({ ...h, error: null })
    await saveHealth(out)
    told(out)
    return out
  }
  let out = withOwned({ ...h })
  try {
    if (plan.sessions.length || plan.weights.length) {
      plan = planOf(cached || out)
      await p.HC.write({ sessions: plan.sessions, weights: plan.weights })
      // Written but not yet removed: kept as written, so a failed remove is tried again.
      const kept = Object.fromEntries(Object.entries(h.written).filter(([id]) => !plan.written[id]))
      out.written = { ...kept, ...plan.written }
    }
    let written = plan.written
    if (plan.remove.sessions.length || plan.remove.weights.length) {
      // Apple Health answers what it could not take out (`left`: one the watch saved that the
      // phone may not delete): kept as written, so the next sync tries again.
      const res = await p.HC.remove(plan.remove)
      const left = Array.isArray(res?.left) ? res.left : []
      if (left.length) written = { ...written, ...Object.fromEntries(left.filter(id => h.written[id]).map(id => [id, h.written[id]])) }
    }
    out = { ...out, written, at: Date.now(), error: null }
  } catch (e) {
    out.error = e?.code === 'permission' ? 'permission' : e?.code === 'unavailable' ? 'unavailable' : 'failed'
  }
  // What the watch noted while this write ran is already on the live copy. This save keeps
  // those maps and only updates what the sync itself decided.
  if (cached) {
    const now = Date.now()
    let watchDeferred = cached.watchDeferred || {}
    if (!out.error) {
      watchDeferred = {}
      for (const [id, until] of Object.entries(cached.watchDeferred || {})) {
        if (until > now && !cached.watchOwned?.[id]) watchDeferred[id] = until
      }
      cached = { ...cached, written: out.written, watchDeferred, at: now, error: null }
    } else {
      cached = { ...cached, error: out.error }
    }
    await saveHealth(cached)
    told(cached)
    return cached
  }
  await saveHealth(out)
  told(out)
  return out
}

/**
 * Turning it on: asks for the two write permissions, then writes the whole log once. Resolves
 * with { ok, reason } — reason 'denied' when the user did not grant both, or the status when
 * Health Connect is not there to ask.
 */
export async function enableHealth(S) {
  const p = await plugin()
  if (!p) return { ok: false, reason: 'unsupported' }
  const st = await p.HC.status().catch(() => ({ status: 'unsupported' }))
  if (st.status !== 'available') return { ok: false, reason: st.status }
  const granted = st.granted || (await p.HC.requestPermissions().catch(() => ({ granted: false }))).granted
  if (!granted) return { ok: false, reason: 'denied' }
  const h = await loadHealth()
  await saveHealth({ ...h, on: true, error: null })
  await mirrorOn(true)
  const after = await syncHealth(S)
  return { ok: !after?.error, reason: after?.error || null, health: after }
}

/**
 * Turning it off stops the writing. With `removeWritten`, what openGym wrote is taken out of
 * Health Connect too; without it, it stays there as the user's own data. Rejects when the
 * removal fails, and then stays on, so nothing is left behind that the phone forgot it wrote.
 */
export async function disableHealth({ removeWritten = false } = {}) {
  if (running) await running.catch(() => {})
  const h = await loadHealth()
  if (removeWritten) {
    const ids = writtenIds(h.written)
    if (ids.sessions.length || ids.weights.length) {
      const p = await plugin()
      if (!p) throw new Error('unavailable')
      await p.HC.remove(ids)
    }
  }
  const out = { ...h, on: false, error: null, written: removeWritten ? {} : h.written }
  await saveHealth(out)
  await mirrorOn(false)
  told(out)
  return out
}

// Back in the foreground: a change synced from another device while the phone was away, or a
// permission the user granted again in Health Connect's own settings, is picked up then.
let started = false
export function initHealthSync(getState, apply = null) {
  if (!MOBILE || started) return
  started = true
  applyRef = apply
  import('@capacitor/app').then(({ App }) => {
    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return
      syncHealth(getState()).catch(() => {})
      readHealth(getState, { force: true }).catch(() => {})
    })
  }).catch(() => {})
  // Once at launch, for a workout finished just before the app was closed. Reading the file here
  // also settles whether it is on, which the saves wait for (syncHealth).
  setTimeout(() => loadHealth().then(h => {
    mirrorOn(h.on)
    readHealth(getState, { force: true }).catch(() => {})
    return syncHealth(getState())
  }).catch(() => {}), 3000)
}

/* ------------------------------------------------------------------ reading back (v1.4.3) -- */

// How long after a workout its heart rate is still looked for: Garmin and Fitbit hand theirs to
// the hub when the watch next syncs, which can be hours later.
export const HR_WINDOW_MS = 24 * 3600e3
// Between two reads of the same thing, at most this often while the app is in use, and this often
// when it comes back to the foreground.
const READ_EVERY_MS = 10 * 60e3
const RESUME_EVERY_MS = 2 * 60e3
// The first read of weigh-ins goes this far back (what Health Connect gives without the history
// permission); later ones from the newest seen, minus a margin for a scale that syncs late.
export const WEIGHT_FIRST_MS = 30 * 24 * 3600e3
// With Health Connect's history permission (Android, idea from #801) the first read goes back a
// year instead, so a scale's weigh-ins from before openGym arrive too. Asked for with the weight;
// refused, the read simply stays at 30 days.
export const WEIGHT_HISTORY_MS = 365 * 24 * 3600e3
const WEIGHT_MARGIN_MS = 2 * 24 * 3600e3
const SEEN_KEEP_MS = 60 * 24 * 3600e3

const srcOf = platform => (platform === 'ios' ? 'ah' : 'hc')

// The store's update, given at launch (initHealthSync): a read result goes into the log the way any
// other change does, so it is saved, stamped and synced.
let applyRef = null
let readRunning = null
let lastWeightRead = 0

/**
 * Turns one of the two reads on (`kind`: 'hr' | 'weight'): asks for that read permission only,
 * then reads once. Resolves with { ok, reason }; reason 'denied' when it was not granted.
 */
export async function enableRead(kind, getState, { apply = null } = {}) {
  const p = await plugin()
  if (!p) return { ok: false, reason: 'unsupported' }
  const st = await p.HC.status().catch(() => ({ status: 'unsupported' }))
  if (st.status !== 'available') return { ok: false, reason: st.status }
  const perm = kind === 'hr' ? 'heartRate' : 'weight'
  // The history permission only where Health Connect has it (status says so); Apple Health has none.
  const history = kind === 'weight' && p.platform !== 'ios' && st.history === true
  const res = await p.HC.requestPermissions({ read: history ? [perm, 'history'] : [perm], write: [] }).catch(() => null)
  // Apple Health never says whether reading was allowed (that it was refused is itself private):
  // `read` is then missing, and a refusal just reads nothing.
  const ok = res && (res.read ? res.read[perm] !== false : true)
  if (!ok) return { ok: false, reason: 'denied' }
  const h = await loadHealth()
  const out = { ...h, [kind === 'hr' ? 'readHr' : 'readWeight']: true, readError: null }
  if (kind === 'weight') out.wHistory = history && res.read?.history === true
  await saveHealth(out)
  told(out)
  if (getState) await readHealth(getState, { force: true, apply }).catch(() => {})
  return { ok: true, reason: null, health: cached }
}

/** Turns a read off. What it already brought in stays in the log, as the user's data. */
export async function disableRead(kind) {
  if (readRunning) await readRunning.catch(() => {})
  const h = await loadHealth()
  const out = kind === 'hr' ? { ...h, readHr: false, hrTried: {} } : { ...h, readWeight: false }
  if (!out.readHr && !out.readWeight) out.readError = null
  await saveHealth(out)
  told(out)
  return out
}

/**
 * One read pass: the heart rate of every workout finished in the last day that still lacks some,
 * and the weigh-ins since the last read. A no-op while both switches are off; never runs twice at
 * once; reads the same thing at most every ten minutes (two after coming back to the foreground,
 * `force`). The log changes only when something new came in.
 */
export function readHealth(getState, { force = false, now = Date.now(), apply = null } = {}) {
  if (!MOBILE || !cached || !(cached.readHr || cached.readWeight)) return Promise.resolve(cached)
  if (!isOn(getState?.(), 'health')) return Promise.resolve(cached)   // paused with the Health module
  if (readRunning) return readRunning
  readRunning = readOnce(getState, force, now, apply || applyRef).finally(() => { readRunning = null })
  return readRunning
}

async function readOnce(getState, force, now, applyFn) {
  const p = await plugin()
  if (!p) return cached
  const src = srcOf(p.platform)
  const every = force ? RESUME_EVERY_MS : READ_EVERY_MS
  let h = { ...(await loadHealth()) }
  let error = null
  // `decide` runs on a copy first: an update that changes nothing would still stamp and push.
  const apply = (decide, fn = decide) => {
    const probe = JSON.parse(JSON.stringify(getState() || {}))
    if (!decide(probe)) return false
    if (applyFn) applyFn(s => { fn(s) })
    return true
  }
  const fail = e => { error = e?.code === 'permission' ? 'permission' : e?.code === 'unavailable' ? 'unavailable' : 'failed' }

  if (h.readHr) {
    const S = getState()
    const tried = {}
    for (const [wid, at] of Object.entries(h.hrTried || {})) if (now - Number(at) < HR_WINDOW_MS * 2) tried[wid] = at
    for (const w of S?.workouts || []) {
      const end = Number(w?.end), start = Number(w?.start)
      if (!w?.id || !(start > 0) || !(end > start) || now - end > HR_WINDOW_MS || end > now) continue
      if (!lacksHeartRate(w) && w.hr?.src !== src) continue
      if (tried[w.id] && now - Number(tried[w.id]) < every) continue
      try {
        const res = await p.HC.readHeartRate({ from: start, to: end + 5 * 60e3 })
        tried[w.id] = now
        const samples = Array.isArray(res?.samples) ? res.samples : []
        if (samples.length) apply(s => mergeHeartRate(s, w.id, samples, src, now))
      } catch (e) { fail(e); break }
    }
    h.hrTried = tried
  }

  if (h.readWeight && (force ? now - lastWeightRead >= RESUME_EVERY_MS : now - lastWeightRead >= READ_EVERY_MS)) {
    const sinceFor = back => (h.wCursor > 0 ? Math.max(h.wCursor - WEIGHT_MARGIN_MS, now - back) : now - back)
    try {
      let res
      try {
        res = await p.HC.readWeights({ since: sinceFor(h.wHistory ? WEIGHT_HISTORY_MS : WEIGHT_FIRST_MS) })
      } catch (e) {
        // The history permission taken back in Health Connect's settings: the 30 days still read.
        if (!(h.wHistory && e?.code === 'permission')) throw e
        h.wHistory = false
        res = await p.HC.readWeights({ since: sinceFor(WEIGHT_FIRST_MS) })
      }
      lastWeightRead = now
      const records = Array.isArray(res?.records) ? res.records : []
      // The memo is filled in on the copy that decides; the store's update replays the same merge.
      const seen = { ...(h.seen || {}) }
      const before = { ...seen }
      if (records.length) apply(probe => mergeWeighIns(probe, records, { src, seen }).length > 0,
        s => { mergeWeighIns(s, records, { src, seen: { ...before } }) })
      for (const [d, v] of Object.entries(seen)) if (now - Number(v?.t) > SEEN_KEEP_MS) delete seen[d]
      h.seen = seen
      const newest = records.reduce((m, r) => Math.max(m, Number(r?.t) || 0), 0)
      if (newest > h.wCursor) h.wCursor = newest
    } catch (e) { fail(e) }
  }

  h.readError = error
  await saveHealth(h)
  told(h)
  return h
}
