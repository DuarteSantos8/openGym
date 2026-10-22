// The openGym watch app (iOS only): while a workout runs here, the watch runs a workout session,
// so Health records heart rate at workout rate and keeps one workout with it attached. This file
// owns the native plugin (WatchLinkPlugin.swift) and the phone's own record of it, kept in its own
// file like opengym-health.json: a fact about this phone, never in S.
//
// The watch saves its workout to Health under the same id the phone's Health export uses
// (opengym-w-<id>), so the export holds back a workout the watch is recording (watchHeldIds):
// for good once the watch says it saved it, until it says it failed, and at most WATCH_WAIT_MS
// after the end when it says nothing at all.
import { MOBILE, isIOS, readJsonFile, writeJsonFile } from './mobile.js'

export const WATCH_FILE = 'opengym-watch.json'
export const WATCH_WAIT_MS = 10 * 60000
// A start that never got its end (the app was killed mid-workout) stops holding after a day.
const PENDING_MAX_MS = 24 * 3600000
const HELD_MAX = 50
const HR_FRESH_MS = 15000
const EVENTS = ['heartRate', 'watchState', 'restAction', 'reachability']
const NO_WATCH = { supported: false, paired: false, appInstalled: false, reachable: false }
const DEFAULT = { useWatch: true, held: {} }

// Wrapped in an object, as in rest-alert.js: a Capacitor plugin proxy answers `then`, so a
// promise resolved with the bare proxy never settles.
let pluginP = null
const plugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE || !(await isIOS())) return null
  const { registerPlugin } = await import('@capacitor/core')
  return { W: registerPlugin('WatchLink') }
})().catch(() => null))

/** { supported, paired, appInstalled, reachable }, all false where there is no watch to ask. */
export async function watchStatus() {
  try {
    const p = await plugin()
    if (!p) return { ...NO_WATCH }
    return { ...NO_WATCH, ...(await p.W.status()) }
  } catch { return { ...NO_WATCH } }
}

// The file, read once and then kept here; every change goes through savePref, one at a time.
let cached = null
let writes = Promise.resolve()
export async function loadWatchPref() {
  if (cached) return cached
  const f = await readJsonFile(WATCH_FILE)
  cached = f && typeof f === 'object'
    ? { ...DEFAULT, ...f, useWatch: f.useWatch !== false, held: f.held && typeof f.held === 'object' ? f.held : {} }
    : { ...DEFAULT }
  return cached
}
const savePref = change => (writes = writes.then(async () => {
  const next = change(await loadWatchPref())
  cached = { ...next, held: trimHeld(next.held) }
  await writeJsonFile(WATCH_FILE, cached)
  return cached
}))
const trimHeld = held => Object.fromEntries(Object.entries(held || {})
  .sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0))
  .slice(0, HELD_MAX))

/** The Settings switch. Nothing is sent to the watch while it is off. */
export function setUseWatch(on) {
  return savePref(f => ({ ...f, useWatch: !!on }))
}

/** Starts the watch session for the workout that just started here. Null when nothing was sent. */
export async function watchStartSession(active) {
  if (!MOBILE || !active?.id || active.backfill || active.editingWorkoutId) return null
  try {
    const p = await plugin()
    if (!p || !(await loadWatchPref()).useWatch) return null
    const st = await watchStatus()
    if (!st.paired || !st.appInstalled) return null
    const id = String(active.id)
    await savePref(f => ({ ...f, held: { ...f.held, [id]: { s: 'pending', at: Date.now() } } }))
    return await p.W.startSession({ id, name: String(active.name || ''), start: Number(active.start) || Date.now() })
  } catch { return null }
}

/**
 * Ends the watch session of a workout this phone started on it, the switch notwithstanding: a
 * session left running would record for hours. With `discard` the watch throws it away; `end`
 * is the workout's end when it is not now.
 */
export async function watchEndSession(id, { discard = false, end: at } = {}) {
  if (!MOBILE || id == null) return null
  try {
    const key = String(id)
    const was = (await loadWatchPref()).held[key]
    if (was?.s !== 'pending' || was.end) return null
    const p = await plugin()
    if (!p) return null
    const end = Number(at) > 0 ? Number(at) : Date.now()
    await savePref(f => {
      const held = { ...f.held }
      if (discard) delete held[key]
      else held[key] = { ...was, end }
      return { ...f, held }
    })
    return await p.W.endSession({ id: key, end, discard: !!discard })
  } catch { return null }
}

/** The rest timer of useUI, mirrored on the wrist while the watch records a workout; null clears it. */
export async function watchRest(timer) {
  if (!MOBILE) return
  try {
    const p = await plugin()
    if (!p) return
    const f = await loadWatchPref()
    if (!f.useWatch || !Object.values(f.held).some(e => e?.s === 'pending' && !e.end)) return
    if (!timer || timer.ready) { await p.W.clearRest(); return }
    const paused = !!timer.paused
    const total = Math.max(0, Math.round(timer.total || 0))
    const left = Math.max(0, Math.round(timer.left || 0))
    await p.W.rest(paused ? { total, paused, left } : { endsAt: timer.endsAt, total, paused, left })
  } catch { /* the watch shows its own countdown until the next change */ }
}

/**
 * At launch: a watch session whose end was never sent (the app killed mid-finish, a workout
 * discarded from the error screen) is ended with its saved workout's end, or thrown away.
 */
export async function reconcileWatch(S) {
  if (!MOBILE) return
  const f = await loadWatchPref()
  const activeId = S?.active?.id != null ? String(S.active.id) : null
  for (const [id, e] of Object.entries(f.held)) {
    if (e?.s !== 'pending' || e.end || id === activeId) continue
    const w = (S?.workouts || []).find(x => String(x.id) === id)
    await watchEndSession(id, w ? { end: w.end } : { discard: true })
  }
}

/** Ids of workouts the phone leaves to the watch to write to Health. */
export async function watchHeldIds(now = Date.now()) {
  const f = await loadWatchPref()
  const out = new Set()
  for (const [id, e] of Object.entries(f.held)) {
    if (e?.s === 'saved') out.add(id)
    else if (e?.s === 'pending' && (e.end ? now - e.end < WATCH_WAIT_MS : now - (e.at || 0) < PENDING_MAX_MS)) out.add(id)
  }
  return out
}

// What the watch said about a workout's session, into the held list.
function noteWatchState({ state, id } = {}) {
  if (id == null) return Promise.resolve()
  const key = String(id)
  return savePref(f => {
    const held = { ...f.held }
    if (state === 'ended') held[key] = { s: 'saved', at: Date.now() }
    else if (state === 'failed') delete held[key]
    else if (state === 'running') held[key] = { ...(held[key] || {}), s: 'pending', at: held[key]?.at || Date.now() }
    else return f
    return { ...f, held }
  })
}

// One native subscription per event, handed to every listener here.
const subs = new Set()
let wired = null
const wire = () => wired || (wired = plugin()
  .then(p => p && Promise.all(EVENTS.map(name => p.W.addListener(name, data => emit(name, data)))))
  .catch(() => null))
function emit(name, data) {
  track(name, data)
  subs.forEach(cb => { try { cb(name, data) } catch { /* a closed screen */ } })
}

/** cb(name, data) for heartRate, watchState, restAction and reachability. Returns the unsubscribe. */
export function onWatchEvent(cb) {
  subs.add(cb)
  wire()
  return () => { subs.delete(cb) }
}

/**
 * Once, from the store: what the watch's end, failure and rest buttons mean to the app, and with
 * getState a look for a session left running a few seconds after launch (reconcileWatch).
 * onEnded(id) after the watch saved a workout, onFailed(id) when it did not, onRestAction('add15' | 'skip').
 */
let started = false
export function initWatchLink({ onEnded, onFailed, onRestAction, getState } = {}) {
  if (!MOBILE || started) return
  started = true
  if (getState) setTimeout(() => { reconcileWatch(getState()).catch(() => {}) }, 3000)
  onWatchEvent((name, data) => {
    if (name === 'restAction') {
      if (data?.action === 'add15' || data?.action === 'skip') onRestAction?.(data.action)
      return
    }
    if (name !== 'watchState') return
    noteWatchState(data).then(() => {
      if (data?.state === 'ended') onEnded?.(String(data.id))
      if (data?.state === 'failed') onFailed?.(String(data.id))
    }).catch(() => {})
  })
}

// The live heart rate for the workout screen: the last reading, and whether the watch runs a session.
let hr = null
let watchState = null
const hrSubs = new Set()
function track(name, data) {
  if (name === 'heartRate' && Number.isFinite(data?.bpm)) hr = { bpm: Math.round(data.bpm), seen: Date.now() }
  else if (name === 'watchState') watchState = data || null
  else return
  hrSubs.forEach(cb => { try { cb() } catch { /* a closed screen */ } })
}

/** { bpm, running }: bpm only while the watch runs the workout and its last reading is under 15 s old. */
export function watchHeartRate(now = Date.now()) {
  const running = watchState?.state === 'running'
  return { bpm: running && hr && now - hr.seen < HR_FRESH_MS ? hr.bpm : null, running }
}

export function subscribeWatchHeartRate(cb) {
  hrSubs.add(cb)
  wire()
  return () => { hrSubs.delete(cb) }
}
