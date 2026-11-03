// Log a set from the Home Screen widget (v1.4.5), the page's side. While a workout runs, the
// widget snapshot (lib/widgets.js) carries `logger`: the set to do now and the few after it, each
// with what its − and + buttons step through, worked out here with the workout screen's own rules
// (the exercise's weight step or the profile's, the dumbbells or the machine stack you own, reps
// in twos on a per-side exercise, five seconds on a hold). The widget only moves along those
// lists, so it never needs to know about plates, units or steps itself.
//
// A tap on − or + changes the widget's own copy at once (Android: WidgetLogger.java in a
// broadcast receiver; iPhone: an App Intent in the widget extension). Log set queues an event,
// { id, type: 'setDone', wid, exId, entryIdx, setIdx, w, r, sec, at }, and moves the widget on to
// the next set. The app applies the queue when it runs (applyWidgetEvents): through the workout
// screen's own tick when that screen is open (rest timer, PR check), else straight into the
// stored workout. Each event once, by its id, and only then acknowledged.
//
// Text only: no exercise animations or pictures (Gym visual licence). Phone app only.
import { MOBILE, nativePlatform } from './mobile.js'
import { EXIDX } from './exercises.js'
import { t } from './i18n.js'
import { fmtNum, exerciseNameText, cleanNum } from './format.js'
import { modeOf, isBw, repStep, bestWeightForEntry } from './history.js'
import { weightIncrement, stepWeight } from './progression.js'
import { ownedWeightsFor, stepOwned } from './dumbbells.js'
import { shownWeight, exUnitOf } from './ex-unit.js'
import { isWarmupRow, isSideSet, syncSideAggregate } from './workout-model.js'
import { upcomingSets } from './live-activity.js'

// The set now and this many after it: enough for a few Log set taps with the app asleep.
export const LOGGER_AHEAD = 5
// Steps either side of the set's weight the widget can walk without the app.
export const LADDER = 12
export const SEC_STEP = 5
const APPLIED_KEY = 'gym_widget_applied'
const APPLIED_MAX = 300

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The weights − and + walk through from `w`, lightest first, and where `w` sits in them. */
export function weightLadder (S, cfg, w, n = LADDER) {
  const owned = ownedWeightsFor(S, cfg)
  const step = weightIncrement(cfg, S.unit)
  const tap = (v, dir) => { const c = cleanNum(v, step); return owned ? stepOwned(owned, c, dir) : stepWeight(c, step, dir) }
  const start = Math.max(0, num(Number(w)) || 0)
  const down = [], up = []
  let v = start
  for (let i = 0; i < n; i++) { const x = tap(v, -1); if (!(x < v)) break; down.unshift(x); v = x }
  v = start
  for (let i = 0; i < n; i++) { const x = tap(v, 1); if (!(x > v)) break; up.push(x); v = x }
  return { v: [...down, start, ...up], i: down.length }
}

/** One set as the widget shows and steps it, or null for one it cannot log (cardio). */
export function loggerSet (S, A, { entryIdx, setIdx }) {
  const e = A.entries[entryIdx]
  const s = e?.sets?.[setIdx]
  if (!s) return null
  const cfg = { ...(e.target || {}), id: e.id }
  const mode = modeOf(cfg)
  if (mode === 'cardio') return null
  const unit = exUnitOf(S, e.id)
  const warm = !!isWarmupRow(s)
  const work = (e.sets || []).filter(x => !isWarmupRow(x))
  const n = warm ? (e.sets || []).filter(isWarmupRow).indexOf(s) + 1 : work.indexOf(s) + 1
  const out = {
    k: `${A.id || ''}:${entryIdx}:${setIdx}`,
    exId: String(e.id),
    entryIdx,
    setIdx,
    name: EXIDX[e.id] ? exerciseNameText(EXIDX[e.id]) : String(cfg.name || e.name || e.id),
    line: warm ? t('Warm-up') + ' ' + n : t('Set {0} of {1}', n, work.length),
    mode,
  }
  // A timed hold's optional weight is left alone: it logs the seconds.
  if (mode === 'time') {
    out.sec = { v: Math.max(0, Math.round(num(s.sec) ?? num(cfg.sec) ?? 30)), step: SEC_STEP }
    out.secLabel = t('Seconds')
    return out
  }
  const lad = weightLadder(S, cfg, s.w)
  out.w = { v: lad.v, t: lad.v.map(x => `${fmtNum(shownWeight(S, e.id, x))} ${unit}`), i: lad.i }
  out.wLabel = isBw(cfg) ? t('Added') : t('Weight')
  out.r = { v: Math.max(0, Math.round(num(s.r) ?? num(cfg.reps) ?? 0)), step: repStep(cfg) }
  out.rLabel = t('Reps')
  return out
}

/** The widget's `logger` block, or null when no workout is running here. */
export function buildLogger (S) {
  const A = S?.active
  if (!A || !Array.isArray(A.entries) || !A.entries.length || A.editingWorkoutId) return null
  const sets = []
  const up = upcomingSets(S)
  for (const x of up) {
    if (sets.length > LOGGER_AHEAD) break
    let v = null
    try { v = loggerSet(S, A, x) } catch { v = null }
    // A cardio set waits for the app: the widget stops at it.
    if (!v) break
    sets.push(v)
  }
  return {
    wid: String(A.id || ''),
    sets,
    // Sets are left after the ones carried: once those are logged the widget says to open the app.
    more: up.length > sets.length,
    labels: {
      logSet: t('Log set'),
      allDone: t('All sets done'),
      openApp: t('Open openGym for the next set'),
      less: t('Decrease'),
      more: t('Increase'),
    },
  }
}

/* ---------- applying the widget's taps ---------- */

let handlers = null   // the workout screen's, while it is open: setDone (its own tick)
const readApplied = () => { try { return JSON.parse(localStorage.getItem(APPLIED_KEY)) || [] } catch { return [] } }
const writeApplied = ids => { try { localStorage.setItem(APPLIED_KEY, JSON.stringify(ids.slice(-APPLIED_MAX))) } catch { /* the queue's ack is what counts */ } }

function entryIndexOf (A, ev) {
  if (A.entries[ev.entryIdx] && String(A.entries[ev.entryIdx].id) === String(ev.exId)) return ev.entryIdx
  return A.entries.findIndex(e => String(e.id) === String(ev.exId))
}

// The numbers the widget logged, onto a set row (each side of a per-side one: half the reps each).
function withNumbers (row, { w, r, sec }) {
  if (isSideSet(row)) {
    const side = (x, half) => ({ ...x, ...(w != null ? { w } : {}), ...(r != null ? { r: half } : {}) })
    const L = r != null ? Math.ceil(r / 2) : null, R = r != null ? Math.floor(r / 2) : null
    return syncSideAggregate({ ...row, sides: { L: side(row.sides.L, L), R: side(row.sides.R, R) } })
  }
  return { ...row, ...(w != null ? { w } : {}), ...(r != null ? { r } : {}), ...(sec != null ? { sec } : {}) }
}

/**
 * One widget tick applied to a store draft `s` without the workout screen: the numbers, the tick,
 * when it happened, and the exercise's best weight once all its sets are done (as the screen's own
 * tick does). Returns false when there is nothing to do (another workout, a set gone or done).
 */
export function applyWidgetSet (s, ev) {
  const A = s?.active
  if (!A || !Array.isArray(A.entries) || A.editingWorkoutId || (ev.wid && String(A.id) !== String(ev.wid))) return false
  const idx = entryIndexOf(A, ev)
  const e = idx >= 0 ? A.entries[idx] : null
  const row = e?.sets?.[ev.setIdx]
  if (!row || row.done) return false
  let next = withNumbers(row, { w: num(ev.w), r: num(ev.r), sec: num(ev.sec) })
  if (isSideSet(next)) next = syncSideAggregate({ ...next, sides: { L: { ...next.sides.L, done: true }, R: { ...next.sides.R, done: true } } })
  next = { ...next, done: true, at: num(ev.at) || Date.now() }
  delete next.planSec
  const sets = e.sets.map((x, i) => (i === ev.setIdx ? next : x))
  const entry = { ...e, sets }
  if (sets.every(x => x.done)) entry.topW = bestWeightForEntry(entry) || null
  s.active = { ...A, entries: A.entries.map((x, i) => (i === idx ? entry : x)) }
  return true
}

/**
 * Applies the events not applied yet, in order, and returns the ids done with: applied now,
 * applied before, or about a workout that is not running any more.
 */
export function applyWidgetEvents (events, getState) {
  if (!Array.isArray(events)) return []
  const applied = readApplied()
  const done = []
  for (const ev of events) {
    if (!ev || typeof ev.id !== 'string') continue
    if (applied.includes(ev.id)) { done.push(ev.id); continue }
    const st = getState()
    const A = st?.S?.active
    if (ev.type === 'setDone' && A && Array.isArray(A.entries) && !A.editingWorkoutId && (!ev.wid || ev.wid === String(A.id))) {
      const idx = entryIndexOf(A, ev)
      const set = idx >= 0 ? A.entries[idx].sets?.[ev.setIdx] : null
      if (set && !set.done) {
        if (handlers) {
          // The numbers first, then the screen's own tick (rest timer, the end-of-workout sheet).
          st.update(s => {
            const a = s.active
            const nums = { w: num(ev.w), r: num(ev.r), sec: num(ev.sec) }
            s.active = { ...a, entries: a.entries.map((x, k) => (k === idx ? { ...x, sets: x.sets.map((y, i) => (i === ev.setIdx ? withNumbers(y, nums) : y)) } : x)) }
          })
          handlers.setDone(idx, ev.setIdx, { at: num(ev.at) })
        } else {
          st.update(s => { applyWidgetSet(s, ev) })
        }
      }
    }
    applied.push(ev.id)
    done.push(ev.id)
  }
  writeApplied(applied)
  return done
}

/** The workout screen hands over its tick while it is open. Returns the unbind. */
export function bindWidgetActions (h) {
  handlers = h
  drainWidgetEvents()
  return () => { if (handlers === h) handlers = null }
}

/* ---------- the native queue ---------- */

let pluginP = null
// Inside an object: a Capacitor plugin proxy answers `then` (the Coach hang, #42).
const plugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE) return null
  const platform = await nativePlatform()
  if (platform !== 'ios' && platform !== 'android') return null
  const { registerPlugin } = await import('@capacitor/core')
  return { WidgetBridge: registerPlugin('WidgetBridge') }
})().catch(() => null))

let getStateRef = null
let draining = null
const storeReady = () => getStateRef?.()?.ready !== false

/** Takes the widget's taps from the native queue, applies them, acks them once they are on disk. */
export function drainWidgetEvents () {
  if (draining) return draining
  draining = (async () => {
    try {
      const p = await plugin()
      if (!p || !getStateRef || !storeReady()) return []
      const { events = [] } = (await p.WidgetBridge.drain()) || {}
      const done = applyWidgetEvents(events, getStateRef)
      if (done.length) await getStateRef()?.saveNow?.()
      if (done.length) await p.WidgetBridge.ack({ ids: done })
      return done
    } catch { return [] } finally { draining = null }
  })()
  return draining
}

/**
 * Started once by the app: drains when the app starts, comes back to the front, the store has its
 * copy back, or the native side says a tap came in (Android, while the app runs). Resolves with
 * the stop function.
 */
export async function startWidgetActions ({ useStore }) {
  const p = await plugin()
  if (!p) return () => {}
  getStateRef = () => useStore.getState()
  const off = useStore.subscribe((s, prev) => { if (s.ready && !prev.ready) drainWidgetEvents() })
  const sub = await p.WidgetBridge.addListener('widgetEvent', () => { drainWidgetEvents() }).catch(() => null)
  const onVisible = () => { if (document.visibilityState === 'visible') drainWidgetEvents() }
  document.addEventListener('visibilitychange', onVisible)
  drainWidgetEvents()
  return () => { off(); sub?.remove?.(); document.removeEventListener('visibilitychange', onVisible) }
}

// Test seams.
export function _setWidgetActionsForTest (bridge, getState) { pluginP = Promise.resolve(bridge ? { WidgetBridge: bridge } : null); getStateRef = getState || null }
export function _resetWidgetActions () { handlers = null; pluginP = null; getStateRef = null; draining = null }
