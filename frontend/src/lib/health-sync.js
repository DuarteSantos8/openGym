import { healthOwner } from './health-owner.js'
import { invalidateWorkoutWeather, disableWorkoutWeather, waitForWorkoutWeather, weatherForWorkout } from './workout-weather.js'
import { workoutEnergy } from './workout-energy.js'
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
import { healthRecords, planSync, writtenIds, goneIds, recordKey } from './health-connect.js'
import { isOn } from './modules.js'
import { exerciseNameFor } from './i18n-core.js'
import { EXIDX } from './exercises.js'
import { speedUnitOf } from './speed.js'

export const HEALTH_FILE = 'opengym-health.json'
const OFF = { on: false, written: {}, at: 0, error: null, readHr: false, readWeight: false, wHistory: false, wCursor: 0, seen: {}, hrTried: {}, readError: null }

// Bound by the store, after its profile has been restored. Tests and standalone consumers
// without a binding retain the legacy local file. A bound account never adopts unscoped consent.
let context = null
let generation = 0
let cachedOwner
const owner = () => context ? healthOwner({ getState: context }) : null
const ready = () => !context || (context()?.ready !== false && !context()?.healthPaused)
const token = () => ({ owner: owner(), generation })
const current = t => t.owner === owner() && t.generation === generation && ready()
const fileFor = who => who == null ? HEALTH_FILE : `opengym-health-${recordKey({ owner: who })}.json`
export function startHealthScope(store) {
  store.subscribe((next, prev) => {
    if (next.ready !== prev.ready || isOn(next.S, 'health') !== isOn(prev.S, 'health') || healthOwner({ getState: () => next }) !== healthOwner({ getState: () => prev })) invalidateHealthSync()
  })
}
export function bindHealthOwner(getContext) { context = getContext; invalidateHealthSync() }
export function invalidateHealthSync() {
  const wasOn = !!cached?.on
  generation++; cached = null; cachedOwner = undefined; lastWeightRead = 0
  invalidateWorkoutWeather()
  if (context && MOBILE && !ready()) {
    if (wasOn) mirrorOn(false).catch(() => {})
    return
  }
  if (context && MOBILE) queueMicrotask(() => {
    if (!ready()) { if (wasOn) mirrorOn(false).catch(() => {}); return }
    const attempt = token()
    loadHealth().then(h => {
      if (current(attempt)) { mirrorOn(h.on, attempt).catch(() => {}); told(h) }
    }).catch(() => {})
  })
}
export const healthWritingEnabled = () => ready() && cachedOwner === owner() && !!cached?.on && (!context || isOn(context()?.S, 'health'))
const changed = () => Object.assign(new Error('Health sync account changed'), { code: 'accountChanged' })
const requireCurrent = t => { if (!current(t)) throw changed() }

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
async function mirrorOn(on, t = token()) {
  const p = await plugin().catch(() => null)
  if (t.owner !== owner() || t.generation !== generation || (on && !ready())) return
  if (p?.platform === 'ios') await p.HC.setEnabled({ on: !!on && (!context || isOn(context()?.S, 'health')) }).catch(() => {})
}

// The file's content, read once and then kept here: a save while it is off (the usual case) must
// not cost a file read, and every change to it goes through saveHealth anyway.
let cached = null
export async function loadHealth() {
  if (!ready()) return { ...OFF }
  const who = owner(), attempt = generation
  if (cached && cachedOwner === who) return cached
  const f = await readJsonFile(fileFor(who))
  if (who !== owner() || attempt !== generation) return loadHealth()
  const map = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
  cached = f && typeof f === 'object' ? { ...OFF, ...f, written: map(f.written), seen: map(f.seen), hrTried: map(f.hrTried) } : { ...OFF }
  cachedOwner = who
  return cached
}
const saveHealth = async (h, t = token()) => {
  if (!current(t)) return
  // Capture the destination before awaiting disk: an old write can only reach its old account.
  cached = h; cachedOwner = t.owner
  await writeJsonFile(fileFor(t.owner), h)
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
let runningAttempt = null
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
  if (!MOBILE || !ready()) return Promise.resolve(null)
  // Not read yet: initHealthSync reads it at launch and syncs then, which covers a save made
  // before that; the save path itself never waits on the file.
  if (!cached || cachedOwner !== owner() || !cached.on) return Promise.resolve(cached)
  // Settings → Modules: Health off pauses the sync. Nothing is disconnected; switched back on, the
  // next save writes everything that changed meanwhile (planSync compares with what was written).
  if (S && !isOn(S, 'health')) return Promise.resolve(cached)
  if (running) {
    const queued = token()
    if (runningAttempt?.owner === queued.owner && runningAttempt?.generation === queued.generation) { again = S; return running }
    // An old account's pass is winding down: the new account still gets its own pass afterwards.
    return running.then(() => current(queued) ? syncHealth(context?.().S || S) : cached)
  }
  again = null
  const attempt = token()
  runningAttempt = attempt
  running = (async () => {
    let h = await loadHealth()
    let next = S
    while (next) {
      if (!current(attempt)) return cached
      if (h.on) h = await syncOnce(next, h, attempt)
      // A state that came in meanwhile, taken only now: cleared before a pass, it would lose a
      // change made while the pass was starting.
      next = again
      again = null
    }
    return h
  })().finally(() => { running = null })
  return running
}

async function syncOnce(S, h, attempt) {
  const p = await plugin()
  if (!p || !current(attempt)) return h
  // Finish may beat the location callback. Only this workout's pending capture is awaited;
  // a refusal/provider failure resolves without blocking the ordinary export.
  if (p.platform === 'ios' && context) await waitForWorkoutWeather({ getState: context })
  if (!current(attempt)) return h
  const records = healthRecords(S, { nameOf, speedUnit: speedUnitOf(S), includeEnergy: p.platform === 'ios' })
  if (p.platform === 'ios') {
    const waiting = new Set((S.workouts || []).filter(w => {
      const e = workoutEnergy(w.healthMetrics)
      return e && !e.final
    }).map(w => 'opengym-w-' + w.id))
    records.sessions = records.sessions.filter(w => !waiting.has(w.id)).map(rec => {
      const w = (S.workouts || []).find(w => 'opengym-w-' + w.id === rec.id)
      const weather = context && w && weatherForWorkout({ getState: context }, w)
      return weather ? { ...rec, weather } : rec
    })
  }
  const plan = planSync(records, h.written, goneIds(S))
  const nothing = !plan.sessions.length && !plan.weights.length && !plan.remove.sessions.length && !plan.remove.weights.length
  if (nothing) {
    if (!h.error) return h
    // Nothing to write, but the last attempt failed: clear it once Health Connect says yes again.
    const st = await p.HC.status().catch(() => null)
    if (!(st?.status === 'available' && st.granted)) return h
    if (!current(attempt)) return h
    const out = { ...h, error: null }
    await saveHealth(out, attempt)
    if (current(attempt)) told(out)
    return out
  }
  let out = { ...h }
  try {
    if (plan.sessions.length || plan.weights.length) {
      if (!current(attempt)) return h
      await p.HC.write({ sessions: plan.sessions, weights: plan.weights })
      if (!current(attempt)) return h
      // Written but not yet removed: kept as written, so a failed remove is tried again.
      const kept = Object.fromEntries(Object.entries(h.written).filter(([id]) => !plan.written[id]))
      out.written = { ...kept, ...plan.written }
    }
    let written = plan.written
    if (plan.remove.sessions.length || plan.remove.weights.length) {
      // Apple Health answers what it could not take out (`left`: one the watch saved that the
      // phone may not delete): kept as written, so the next sync tries again.
      if (!current(attempt)) return h
      const res = await p.HC.remove(plan.remove)
      if (!current(attempt)) return h
      const left = Array.isArray(res?.left) ? res.left : []
      if (left.length) written = { ...written, ...Object.fromEntries(left.filter(id => h.written[id]).map(id => [id, h.written[id]])) }
    }
    out = { ...out, written, at: Date.now(), error: null }
  } catch (e) {
    out.error = e?.code === 'permission' ? 'permission' : e?.code === 'unavailable' ? 'unavailable' : 'failed'
  }
  await saveHealth(out, attempt)
  if (current(attempt)) told(out)
  return out
}

/**
 * Turning it on: asks for the two write permissions, then writes the whole log once. Resolves
 * with { ok, reason } — reason 'denied' when the user did not grant both, or the status when
 * Health Connect is not there to ask.
 */
export async function enableHealth(S) {
  const attempt = token()
  requireCurrent(attempt)
  const p = await plugin()
  requireCurrent(attempt)
  if (!p) return { ok: false, reason: 'unsupported' }
  const st = await p.HC.status().catch(() => ({ status: 'unsupported' }))
  requireCurrent(attempt)
  if (st.status !== 'available') return { ok: false, reason: st.status }
  const granted = st.granted || (await p.HC.requestPermissions().catch(() => ({ granted: false }))).granted
  requireCurrent(attempt)
  if (!granted) return { ok: false, reason: 'denied' }
  const h = await loadHealth()
  requireCurrent(attempt)
  await saveHealth({ ...h, on: true, error: null })
  requireCurrent(attempt)
  await mirrorOn(true)
  requireCurrent(attempt)
  const after = await syncHealth(S)
  requireCurrent(attempt)
  return { ok: !after?.error, reason: after?.error || null, health: after }
}

/**
 * Turning it off stops the writing. With `removeWritten`, what openGym wrote is taken out of
 * Health Connect too; without it, it stays there as the user's own data. Rejects when the
 * removal fails, and then stays on, so nothing is left behind that the phone forgot it wrote.
 */
export async function disableHealth({ removeWritten = false } = {}) {
  const attempt = token()
  requireCurrent(attempt)
  if (running) await running.catch(() => {})
  requireCurrent(attempt)
  const h = await loadHealth()
  requireCurrent(attempt)
  if (removeWritten) {
    const ids = writtenIds(h.written)
    if (ids.sessions.length || ids.weights.length) {
      const p = await plugin()
      requireCurrent(attempt)
      if (!p) throw new Error('unavailable')
      await p.HC.remove(ids)
      requireCurrent(attempt)
    }
  }
  disableWorkoutWeather()
  const out = { ...h, on: false, error: null, written: removeWritten ? {} : h.written }
  await saveHealth(out)
  requireCurrent(attempt)
  await mirrorOn(false)
  requireCurrent(attempt)
  told(out)
  return out
}

// Back in the foreground: a change synced from another device while the phone was away, or a
// permission the user granted again in Health Connect's own settings, is picked up then.
let started = false
export function initHealthSync(getState, apply = null, getContext = null) {
  if (getContext) bindHealthOwner(getContext)
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
let readAttempt = null
let lastWeightRead = 0

/**
 * Turns one of the two reads on (`kind`: 'hr' | 'weight'): asks for that read permission only,
 * then reads once. Resolves with { ok, reason }; reason 'denied' when it was not granted.
 */
export async function enableRead(kind, getState, { apply = null } = {}) {
  const attempt = token()
  requireCurrent(attempt)
  const p = await plugin()
  requireCurrent(attempt)
  if (!p) return { ok: false, reason: 'unsupported' }
  const st = await p.HC.status().catch(() => ({ status: 'unsupported' }))
  requireCurrent(attempt)
  if (st.status !== 'available') return { ok: false, reason: st.status }
  const perm = kind === 'hr' ? 'heartRate' : 'weight'
  // The history permission only where Health Connect has it (status says so); Apple Health has none.
  const history = kind === 'weight' && p.platform !== 'ios' && st.history === true
  const res = await p.HC.requestPermissions({ read: history ? [perm, 'history'] : [perm], write: [] }).catch(() => null)
  requireCurrent(attempt)
  // Apple Health never says whether reading was allowed (that it was refused is itself private):
  // `read` is then missing, and a refusal just reads nothing.
  const ok = res && (res.read ? res.read[perm] !== false : true)
  if (!ok) return { ok: false, reason: 'denied' }
  const h = await loadHealth()
  requireCurrent(attempt)
  const out = { ...h, [kind === 'hr' ? 'readHr' : 'readWeight']: true, readError: null }
  if (kind === 'weight') out.wHistory = history && res.read?.history === true
  await saveHealth(out)
  requireCurrent(attempt)
  told(out)
  if (getState) await readHealth(getState, { force: true, apply }).catch(() => {})
  requireCurrent(attempt)
  return { ok: true, reason: null, health: cached }
}

/** Turns a read off. What it already brought in stays in the log, as the user's data. */
export async function disableRead(kind) {
  const attempt = token()
  requireCurrent(attempt)
  if (readRunning) await readRunning.catch(() => {})
  requireCurrent(attempt)
  const h = await loadHealth()
  requireCurrent(attempt)
  const out = kind === 'hr' ? { ...h, readHr: false, hrTried: {} } : { ...h, readWeight: false }
  if (!out.readHr && !out.readWeight) out.readError = null
  await saveHealth(out)
  requireCurrent(attempt)
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
  if (!MOBILE || !ready() || !cached || cachedOwner !== owner() || !(cached.readHr || cached.readWeight)) return Promise.resolve(cached)
  if (!isOn(getState?.(), 'health')) return Promise.resolve(cached)   // paused with the Health module
  if (readRunning) {
    const queued = token()
    if (readAttempt?.owner === queued.owner && readAttempt?.generation === queued.generation) return readRunning
    return readRunning.then(() => current(queued) ? readHealth(getState, { force, now, apply }) : cached)
  }
  readAttempt = token()
  readRunning = readOnce(getState, force, now, apply || applyRef, token()).finally(() => { readRunning = null })
  return readRunning
}

async function readOnce(getState, force, now, applyFn, attempt) {
  const p = await plugin()
  if (!p || !current(attempt)) return cached
  const src = srcOf(p.platform)
  const every = force ? RESUME_EVERY_MS : READ_EVERY_MS
  let h = { ...(await loadHealth()) }
  let error = null
  // `decide` runs on a copy first: an update that changes nothing would still stamp and push.
  const apply = (decide, fn = decide) => {
    if (!current(attempt)) return false
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
        if (!current(attempt)) return cached
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
      if (!current(attempt)) return cached
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

  if (!current(attempt)) return cached
  h.readError = error
  await saveHealth(h, attempt)
  if (current(attempt)) told(h)
  return h
}
