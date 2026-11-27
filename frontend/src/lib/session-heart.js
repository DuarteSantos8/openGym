// The heart rate of the workout in progress, as the Apple Watch measures it, for the band under the
// workout screen's progress bar (components/HeartBand.jsx). The watch sends each new reading the
// moment Apple Health gives it one (about every five seconds), with its own time. The page can sleep
// or start again in the middle: what it missed is read back from Apple Health when the band shows
// (lib/health-sync.js), so the curve still starts at the start. Nothing of it is saved: it stays in
// Apple Health.

import { isOn } from './modules.js'

// The range lib/heart-rate.js keeps too: outside it, a sensor glitch.
const BPM_MIN = 25
const BPM_MAX = 250
/** Readings closer than this are one: the same one from two ways in (live and read back). */
const SAME_MS = 1000

let cur = { wid: null, samples: [], watch: false }
const listeners = new Set()

/**
 * `state` with `readings` ([ms, bpm]) added for workout `wid`: in time order, one per moment,
 * nonsense left out. Another workout starts from nothing. `watch`: the readings came live from the
 * Apple Watch, which is what the band waits for (Apple Health also holds other sources, AirPods).
 */
export function addHeart(state, wid, readings, { watch = false } = {}) {
  const same = state && state.wid === wid
  const samples = same ? [...state.samples] : []
  const seen = (same && state.watch) || watch
  let changed = !same || seen !== !!state?.watch
  for (const r of Array.isArray(readings) ? readings : []) {
    const at = Number(r?.[0])
    const bpm = Math.round(Number(r?.[1]))
    if (!(at > 0) || !(bpm >= BPM_MIN && bpm <= BPM_MAX)) continue
    let lo = 0, hi = samples.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (samples[mid][0] < at) lo = mid + 1; else hi = mid }
    if (samples[lo] && samples[lo][0] - at < SAME_MS) continue
    if (samples[lo - 1] && at - samples[lo - 1][0] < SAME_MS) continue
    samples.splice(lo, 0, [at, bpm])
    changed = true
  }
  return changed ? { wid, samples, watch: seen } : state
}

/** The last reading when it is recent enough to show as now: { bpm, at } or null. */
export function lastHeart(state, now = Date.now()) {
  const last = state?.samples?.[state.samples.length - 1]
  return last && now - last[0] < 60e3 ? { bpm: last[1], at: last[0] } : null
}

/** Whether the band has a curve to show for workout `wid`: the watch has sent it readings. */
export const watchCurve = (state, wid) => !!state && state.wid === wid && state.watch && state.samples.length > 0

/** Where the curve starts: the workout's start on the clock. A resume moves A.start on by the pause
 *  (lib/workout-pause.js), so the time paused is taken back off: the curve keeps the whole session. */
export const heartOrigin = A => (Number(A?.start) || 0) - (Number(A?.pausedMs) || 0)

/** Whether the workout screen shows the watch's heart band (components/HeartBand.jsx), and so whether
 *  the header's ♥ follows the watch (components/LiveHeartRate.jsx): one condition for both. A live
 *  session (not one logged afterwards or being edited) in the iPhone app (`ios`), with the Watch and
 *  Health modules on and the curve not switched off (Settings → Workout). */
export const heartBandShown = (S, A, { editing = false, ios = false } = {}) =>
  !!A && !(A.backfill || editing) && ios && isOn(S, 'watch') && isOn(S, 'health') && S?.heartCurve !== false

/** The workout a batch from the watch goes to: the one running here, and only when the batch names
 *  it. A batch without its workout (the watch not yet on one) goes nowhere: read back from Apple
 *  Health later, its readings still fill the curve. */
export const heartBatchFor = (batch, activeId) => (activeId && batch?.wid === activeId ? activeId : null)

/** The watch's readings on this phone's clock: `off` is the watch's clock minus the phone's
 *  (lib/watch-sync.js phoneClock), the same gap its events carry. */
export function onPhoneClock(readings, off) {
  const o = Number(off)
  if (!o || Math.abs(o) > 12 * 3600e3 || !Array.isArray(readings)) return readings
  return readings.map(r => (Array.isArray(r) ? [Number(r[0]) - o, r[1]] : r))
}

export const sessionHeart = () => cur
export function onSessionHeart(fn) { listeners.add(fn); return () => listeners.delete(fn) }

/** Readings for workout `wid`, live from the watch (`watch: true`) or read back from Apple Health. */
export function feedHeart(wid, readings, opts) {
  if (wid == null) return
  const next = addHeart(cur, wid, readings, opts)
  if (next === cur) return
  cur = next
  for (const fn of listeners) { try { fn(cur) } catch { /* a closed screen */ } }
}

/* How big the band is: 'line' (one line), 'big' (the whole curve) or 'pill' (only the ♥ in the
   header). Kept on this device, the way the user left it. */
const VIEW_KEY = 'gym_heart_band'
export const HEART_VIEWS = ['line', 'big', 'pill']
export function heartView() {
  try { const v = localStorage.getItem(VIEW_KEY); return HEART_VIEWS.includes(v) ? v : 'line' } catch { return 'line' }
}
export function setHeartView(v) {
  try { localStorage.setItem(VIEW_KEY, v) } catch { /* private mode: this session only */ }
}
