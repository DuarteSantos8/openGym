// The iPhone's own workout session (#818), the page's side (native: ios/App/App/PhoneWorkoutPlugin.swift).
//
// AirPods Pro 3 and Powerbeats Pro 2 measure the heart rate, but iOS only turns their sensor on
// while an app on the phone runs a workout session, which apps may do since iOS 26. So the phone
// runs one, the same kind the Apple Watch app runs, when all of this holds:
//
//   - the iPhone app on iOS 26 or later (the plugin says `supported`),
//   - Apple Health switched on (Settings → Data; no switch of its own),
//   - a live workout on this phone (not one being logged after the fact, not the tour's practice),
//   - and no Apple Watch app taking it: the watch has not said it has the workout, and is not
//     there right now with Apple Health on. A watch that could take it gets a few seconds to show
//     up first (the phone opens the watch app at the start), and the watch taking it later still
//     wins: the phone's session is then dropped, unsaved, so Apple Health gets one workout.
//
// Its readings land in the very fields the watch fills (set.hr, set.restHr; lib/heart-rate.js),
// worked out the way the watch does it: a set from the end of the rest before it (or the tick
// before it, when that rest was cut short) up to its own tick, a rest from the tick until the rest
// timer ended or the next set was ticked. Only a set without a reading gets one, so merge and
// display stay as they are. The page can sleep in between (phone locked in a pocket): the native
// side keeps every reading with its own time, and the sets are worked out when the page wakes.
//
// When the workout is finished, the session saves it to Apple Health (once: AppleHealthPlugin skips
// its own post-hoc write for it); discarded, it is dropped (also a session iOS handed back after a
// crash, whose workout is gone by then). AirPods taken out only pause readings.
import { MOBILE, nativePlatform } from './mobile.js'
import { sanitizeHr, cleanSamples } from './heart-rate.js'
import { isSideSet } from './workout-model.js'
import { plannedType } from './health-connect.js'

/** A workout older than this when the page first sees it gets no fresh session (only a recovered one). */
export const FRESH_START_MS = 10 * 60e3
/** How long a watch that could take the workout gets to show up before the phone starts its own. */
export const WATCH_GRACE_MS = 15e3
// Shorter than this is no window to measure: a rest cut short by the next tick, ticks caught up.
const MIN_WINDOW_MS = 5000
// A last rest nobody ended stops counting here, or at the workout's end.
const LAST_REST_MS = 5 * 60e3
// The set's heart rate is worked out this long after its tick, so the readings up to it are in.
const SETTLE_MS = 3000
const RESTS_KEY = 'gym_phone_rests'

/** Whether a workout is one measured live on this phone (not logged afterwards, not the tour's). */
export function isLiveWorkout(A, { tourSandbox = false } = {}) {
  return !!(A && A.id && Array.isArray(A.entries) && !A.backfill && !A.editingWorkoutId && !tourSandbox)
}

/**
 * Whether the phone runs its own session for the running workout:
 * { run, wait, reason }. `wait` (ms) when a watch may still take it; `reason` one of
 * 'unsupported' | 'health' | 'none' | 'watch' | 'wait' | 'stale' | 'run'.
 *
 *   supported    the plugin can (iOS 26+)          healthOn   Apple Health switched on
 *   S, tourSandbox, now
 *   watch        { linked, enabled, health, reachable }: paired with the app, Settings → Apple
 *                Watch on, what the watch said about its Apple Health, the watch app there right now
 *   watchClaimed the watch said it has this workout   running  the phone's session runs for it
 */
export function phoneSessionPlan({ supported = false, healthOn = false, S = null, tourSandbox = false, now = Date.now(), watch = {}, watchClaimed = false, running = false } = {}) {
  const off = reason => ({ run: false, wait: 0, reason })
  if (!supported) return off('unsupported')
  if (!healthOn) return off('health')
  const A = S && S.active
  if (!isLiveWorkout(A, { tourSandbox })) return off('none')
  if (watchClaimed) return off('watch')
  const watchMay = !!(watch.linked && watch.enabled !== false && watch.health === 'on')
  if (watchMay && watch.reachable) return off('watch')
  if (running) return { run: true, wait: 0, reason: 'run' }
  const start = Number(A.start)
  const age = Number.isFinite(start) && start > 0 ? now - start : Infinity
  if (watchMay && age >= 0 && age < WATCH_GRACE_MS) return { run: false, wait: WATCH_GRACE_MS - age, reason: 'wait' }
  if (!(age <= FRESH_START_MS)) return off('stale')
  return { run: true, wait: 0, reason: 'run' }
}

const stampOf = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null)

// The sets done and ticked, oldest tick first: { key, entryIdx, setIdx, exId, set, tick }.
function ticked(w) {
  const out = []
  ;(w?.entries || []).forEach((entry, ei) => {
    ;(entry?.sets || []).forEach((s, si) => {
      if (!s) return
      let tick = null
      if (isSideSet(s)) {
        for (const side of [s.sides.L, s.sides.R]) {
          if (side?.done !== true) continue
          const at = stampOf(side.at) ?? stampOf(s.at)
          if (at != null && (tick == null || at > tick)) tick = at
        }
      } else if (s.done === true) tick = stampOf(s.at)
      if (tick != null) out.push({ key: `${ei}:${si}`, entryIdx: ei, setIdx: si, exId: entry.id, set: s, tick })
    })
  })
  return out.sort((a, b) => a.tick - b.tick)
}

// { avg, max } of the readings in (from, to], or null without one.
function stats(samples, from, to) {
  let n = 0, sum = 0, max = 0
  for (const [t, bpm] of samples) {
    if (t <= from || t > to) continue
    n++; sum += bpm
    if (bpm > max) max = bpm
  }
  return n ? sanitizeHr({ avg: sum / n, max }) : null
}

/**
 * The heart rate the phone's session measured, as patches for the sets of workout `w` that have
 * none yet: [{ where: { wid, exId, entryIdx, setIdx }, fields: { hr?, restHr? } }].
 *
 *   samples  [[ms, bpm]] (or { t, bpm }) from the session
 *   rests    { 'entry:set': { from, to? } }: the rest timers that ran after a set (to: when it
 *            ran out or was skipped; none yet while it runs)
 *   from     when the session started: nothing before it was measured
 *   endedAt  the workout's end, once it is finished (the last rest stops there)
 */
export function liveHrPatches(w, samples, { rests = {}, from = 0, endedAt = null } = {}) {
  if (!w || !w.id) return []
  const all = cleanSamples(samples).filter(([t]) => t > from)
  if (!all.length) return []
  const sets = ticked(w)
  const out = []
  sets.forEach((x, i) => {
    const prev = sets[i - 1], next = sets[i + 1]
    const fields = {}
    if (!sanitizeHr(x.set.hr)) {
      // From the end of the rest before it, or from the tick before it when that rest was cut short
      // by this very set (or there was none): the watch's own window (SessionStore completeSet).
      let setFrom = from
      if (prev) {
        const r = rests[prev.key]
        const restEnd = r && stampOf(r.to)
        setFrom = restEnd != null && restEnd > prev.tick && x.tick - restEnd >= MIN_WINDOW_MS ? restEnd : prev.tick
      }
      setFrom = Math.max(setFrom, from)
      if (x.tick - setFrom >= MIN_WINDOW_MS) {
        const hr = stats(all, setFrom, x.tick)
        if (hr) fields.hr = hr
      }
    }
    const r = rests[x.key]
    if (r && !sanitizeHr(x.set.restHr)) {
      let end = stampOf(r.to)
      if (next && (end == null || next.tick < end)) end = next.tick
      if (end == null && endedAt != null) end = Math.min(Number(endedAt), x.tick + LAST_REST_MS)
      if (end != null && end - x.tick >= MIN_WINDOW_MS) {
        const hr = stats(all, x.tick, end)
        if (hr) fields.restHr = hr
      }
    }
    if (fields.hr || fields.restHr) out.push({ where: { wid: w.id, exId: x.exId, entryIdx: x.entryIdx, setIdx: x.setIdx }, fields })
  })
  return out
}

/**
 * The rests as they went, from the rest timer (useUI's `timer`) changing from `prev` to `next`:
 * a rest that starts is noted from now, one that ran out or went (skipped, the next set ticked, a
 * new rest) ends then. The short pause between two sides of a timed set is not a rest. Mutates and
 * returns `rests`.
 */
export function noteRest(rests, prev, next, now = Date.now()) {
  const keyOf = t => (t && t.kind !== 'switch' && Number.isInteger(t.forIdx) && Number.isInteger(t.forSet) ? `${t.forIdx}:${t.forSet}` : null)
  const pk = keyOf(prev), nk = keyOf(next)
  const open = pk && rests[pk] && rests[pk].to == null
  if (open && (pk !== nk || (next.ready && !prev.ready))) {
    // Ran out (at its end, even when the page only noticed later), or skipped / cut short now.
    const endsAt = stampOf(prev.endsAt)
    rests[pk].to = prev.paused || endsAt == null ? now : Math.min(now, endsAt)
  }
  // A rest that starts, or starts again after it ran out (+15 s on "Rest's over").
  if (nk && !next.ready && !next.paused && (pk !== nk || prev.ready || !rests[nk])) rests[nk] = { from: rests[nk] && pk === nk ? rests[nk].from : now }
  return rests
}

/* ---------- the native side ---------- */

let pluginP = null
// Inside an object: a Capacitor plugin proxy answers `then` (lib/rest-alert.js, the Coach hang #42).
const phonePlugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE || (await nativePlatform()) !== 'ios') return null
  const { registerPlugin } = await import('@capacitor/core')
  return { PW: registerPlugin('PhoneWorkout') }
})().catch(() => null))

/** Whether this phone can run its own workout session (the iPhone app on iOS 26 or later). */
export async function phoneSessionSupported () {
  try { const p = await phonePlugin(); return !!(p && (await p.PW.status())?.supported) } catch { return false }
}

// The last reading, for the workout screen's small live readout: { bpm, at } or null.
let latest = null
const liveListeners = new Set()
const tellLive = () => { for (const fn of liveListeners) { try { fn(latest) } catch { /* a closed screen */ } } }
/** The phone session's last reading (shown while it is under a minute old), or null. */
export const liveHeartRate = (now = Date.now()) => (latest && now - latest.at < 60e3 ? latest : null)
export function onLiveHeartRate (fn) { liveListeners.add(fn); return () => liveListeners.delete(fn) }

const readRests = () => { try { const v = JSON.parse(localStorage.getItem(RESTS_KEY) || 'null'); return v && typeof v === 'object' ? v : null } catch { return null } }
const writeRests = v => { try { localStorage.setItem(RESTS_KEY, JSON.stringify(v)) } catch { /* for this run */ } }

/**
 * Started once by the iPhone app. `apply(patches)` writes heart-rate patches into the store (the
 * same patchSetIn the watch's setHr goes through). `watch` gives the watch's side:
 * { status(), claimed(wid), onClaim(fn), prefs(), reported() }.
 */
export async function startPhoneWorkout ({ useStore, useUI, apply, watch }) {
  const p = await phonePlugin()
  if (!p) return () => {}
  let supported = false
  try { supported = !!(await p.PW.status())?.supported } catch { supported = false }
  if (!supported) return () => {}

  let healthOn = false, offHealth = () => {}
  try {
    const hs = await import('./health-sync.js')
    healthOn = !!(await hs.loadHealth())?.on
    offHealth = hs.onHealthChange(h => { if (!!h?.on !== healthOn) { healthOn = !!h?.on; evaluate() } })
  } catch { /* no Apple Health here */ }

  // The running session: { wid, start } or null. The rests of its workout, kept across a reload.
  let running = null
  let rests = {}
  const saved = readRests()
  const keepRests = () => { if (running) writeRests({ wid: running.wid, rests }) }
  let waitTm = null, settleTm = null, busy = Promise.resolve()
  let recovered = false

  const getS = () => useStore.getState().S
  const ready = () => useStore.getState().ready !== false

  const watchInfo = async () => {
    try {
      const st = (await watch?.status?.()) || {}
      return { linked: !!(st.paired && st.installed), reachable: !!st.reachable, enabled: watch?.prefs?.().enabled !== false, health: watch?.reported?.()?.health || null }
    } catch { return { linked: false } }
  }

  const measure = async (run, w, endedAt = null) => {
    if (!run || !w) return
    let samples = []
    try { samples = (await p.PW.samples({ since: run.start }))?.samples || [] } catch { samples = [] }
    const patches = liveHrPatches(w, samples, { rests, from: run.start, endedAt })
    if (patches.length) apply(patches)
  }

  // `save`: the workout is over, saved when it is in the history. Not there, it was discarded:
  // dropped, and the native side takes out a copy that reached Apple Health anyway. `save` false
  // (the watch took it, Apple Health went off): only the phone's session goes.
  const stop = async save => {
    const r = running
    if (!r) return
    running = null
    latest = null
    tellLive()
    clearTimeout(settleTm)
    const w = save ? (getS()?.workouts || []).find(x => x && x.id === r.wid) : null
    if (w) await measure(r, w, Number(w.end) || Date.now())
    writeRests(null)
    rests = {}
    const how = w ? { save: true, ...(Number(w.end) > 0 ? { at: Number(w.end) } : {}), ...(w.name ? { title: String(w.name) } : {}) }
      : save ? { save: false, discarded: true } : { save: false }
    try { await p.PW.end({ wid: r.wid, ...how }) } catch { /* the session ends with the app */ }
  }

  const evaluate = () => { busy = busy.then(evaluateNow).catch(() => {}); return busy }
  const evaluateNow = async () => {
    clearTimeout(waitTm)
    // Not before the store has its copy, and never over the tour's practice workout (the real one,
    // if any, is set aside meanwhile and comes back after).
    if (!ready() || useStore.getState().tourSandbox) return
    const S = getS()
    const A = S?.active
    // A session iOS kept through a crash: taken up for its workout, or ended for one that is over.
    if (!recovered) {
      recovered = true
      try {
        const r = (await p.PW.recover()) || {}
        if (r.wid) {
          running = { wid: r.wid, start: Number(r.start) || Date.now() }
          rests = saved && saved.wid === r.wid && saved.rests && typeof saved.rests === 'object' ? saved.rests : {}
        }
      } catch { /* nothing to recover */ }
    }
    if (running && A?.id !== running.wid) { await stop(true); return evaluateNow() }
    const info = await watchInfo()
    const plan = phoneSessionPlan({
      supported, healthOn, S, now: Date.now(),
      watch: info, watchClaimed: !!(A?.id && watch?.claimed?.(A.id)), running: !!running,
    })
    if (!plan.run) {
      // The watch took it, or Apple Health went off: the phone's session goes, unsaved.
      if (running) await stop(false)
      if (plan.wait > 0) waitTm = setTimeout(evaluate, plan.wait + 250)
      return
    }
    if (!running) {
      try {
        const res = await p.PW.start({ wid: A.id, type: plannedType(A.entries) || undefined })
        if (!res?.ok) return
        running = { wid: A.id, start: Number(res.start) || Date.now() }
        rests = {}
        keepRests()
      } catch { return }
    }
  }

  const settle = () => {
    clearTimeout(settleTm)
    settleTm = setTimeout(() => {
      const A = getS()?.active
      if (running && A?.id === running.wid) measure(running, A).catch(() => {})
    }, SETTLE_MS)
  }

  // A workout started, finished or dropped: decided again. A set ticked: measured shortly after.
  let doneCount = -1
  const countDone = A => { let n = 0; for (const e of A?.entries || []) for (const s of e?.sets || []) if (s?.done || (s?.sides && (s.sides.L?.done || s.sides.R?.done))) n++; return n }
  const offStore = useStore.subscribe((s, prev) => {
    if (s.ready && !prev.ready) { evaluate(); return }
    if (s.S === prev.S && s.tourSandbox === prev.tourSandbox) return
    const A = s.S?.active, B = prev.S?.active
    if (A?.id !== B?.id || !!A?.backfill !== !!B?.backfill || s.tourSandbox !== prev.tourSandbox) { doneCount = -1; evaluate() }
    if (running && A?.id === running.wid) {
      const n = countDone(A)
      if (n !== doneCount) { doneCount = n; settle() }
    }
  })
  const offUI = useUI.subscribe((s, prev) => {
    if (s.timer === prev.timer || !running) return
    noteRest(rests, prev.timer, s.timer)
    keepRests()
    settle()
  })
  const offClaim = watch?.onClaim?.(() => evaluate()) || (() => {})
  const sub = await Promise.resolve(p.PW.addListener('heartRate', e => {
    const bpm = Math.round(Number(e?.bpm)), at = Number(e?.at) || Date.now()
    if (!running || !(bpm >= 25 && bpm <= 250)) return
    latest = { bpm, at }
    tellLive()
  })).catch(() => null)
  const onVisible = () => { if (document.visibilityState === 'visible') { evaluate(); settle() } }
  document.addEventListener('visibilitychange', onVisible)
  evaluate()
  return () => { offStore(); offUI(); offHealth(); offClaim(); sub?.remove?.(); document.removeEventListener('visibilitychange', onVisible); clearTimeout(waitTm); clearTimeout(settleTm) }
}

// Test seams.
export function _setPhonePluginForTest (plugin) { pluginP = Promise.resolve(plugin ? { PW: plugin } : null); latest = null }
