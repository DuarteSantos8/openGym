// The live widget's − and + buttons (lib/live-layout.js ACTIONS wDown/wUp, rDown/rUp, effort):
// what each steps through for the set shown, worked out here with the workout screen's own rules
// (the exercise's weight step or the profile's, the bells you own, reps in twos on a per-side
// exercise, the effort scale of the profile). A surface away from the page (the Lock Screen,
// Android's notification) only walks along these lists, so it never needs plates or units.
//
//   { w: { v, t, i }, r: { v, t, i }, e: { v, t, i } }   v the stored values, t as shown, i the set's
//
// For effort, -1 stands for "not rated" (the lists are numbers only, for Swift and Java).
import { fmtNum, cleanNum } from './format.js'
import { modeOf, repStep, EFFORT, effortOf } from './history.js'
import { weightIncrement, stepWeight } from './progression.js'
import { ownedWeightsFor, stepOwned } from './dumbbells.js'
import { shownWeight, exUnitOf } from './ex-unit.js'
import { isSideSet, syncSideAggregate } from './workout-model.js'

export const LADDER = 12
// The Lock Screen gets fewer steps either side: its update has to fit in 4 KB.
export const LIVE_STEPS = 4
export const NO_EFFORT = -1

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

// The set's own numbers: a per-side row by its first open side, as the workout screen shows it.
const rowOf = s => (isSideSet(s) ? (!s.sides.L.done ? s.sides.L : s.sides.R) : s)

/** The effort scale `− +` walks on this profile, or null with effort off. */
export function effortLadder (S, cur) {
  const kind = effortOf(S)
  if (!EFFORT[kind]) return null
  const sc = EFFORT[kind]
  const vals = []
  for (let x = kind === 'rpe' ? 6 : 0; x <= (kind === 'rpe' ? 10 : 5); x++) vals.push(x)
  const v = [NO_EFFORT, ...vals]
  const at = num(cur) == null ? 0 : Math.max(0, v.indexOf(Math.round(cur)))
  return { v, t: v.map(x => (x === NO_EFFORT ? sc.hd + ' –' : `${sc.hd} ${fmtNum(x)}`)), i: at, f: sc.f }
}

/**
 * The lists for set `setIdx` of entry `entryIdx`, only the `fields` asked for ('w', 'r', 'e');
 * `steps` how many either side. A cardio set gets none, a hold no reps or weight.
 */
export function adjustFor (S, A, entryIdx, setIdx, fields, steps = LIVE_STEPS) {
  const e = A?.entries?.[entryIdx]
  const s = e?.sets?.[setIdx]
  const out = {}
  if (!e || !s || !Array.isArray(fields) || !fields.length) return out
  const cfg = { ...(e.target || {}), id: e.id }
  let mode = 'reps'
  try { mode = modeOf(cfg) } catch { mode = 'reps' }
  if (mode === 'cardio') return out
  const row = rowOf(s)
  const unit = exUnitOf(S, e.id)
  try {
    if (fields.includes('w') && mode === 'reps') {
      const lad = weightLadder(S, cfg, row.w, steps)
      out.w = { v: lad.v, t: lad.v.map(x => `${fmtNum(shownWeight(S, e.id, x))} ${unit}`), i: lad.i }
    }
    if (fields.includes('r') && mode === 'reps') {
      const step = repStep(cfg)
      const r = Math.max(0, Math.round(num(Number(row.r)) ?? num(Number(cfg.reps)) ?? 0))
      const v = []
      for (let x = r - steps * step; x <= r + steps * step; x += step) if (x >= 0) v.push(x)
      out.r = { v, t: v.map(x => fmtNum(x)), i: v.indexOf(r) }
    }
    if (fields.includes('e')) {
      const lad = effortLadder(S, s.rir ?? s.rpe ?? null)
      if (lad) out.e = { v: lad.v, t: lad.t, i: lad.i }
    }
  } catch { /* a list that cannot be worked out is left out: its buttons do not show */ }
  return out
}

/** One step of field `f` from the set's value: the value after it, or null at the end of the list. */
export function stepped (adj, f, dir) {
  const a = adj && adj[f]
  if (!a || !Array.isArray(a.v) || !a.v.length) return null
  if (f === 'e') return a.v[(a.i + (dir > 0 ? 1 : a.v.length - 1)) % a.v.length]
  const j = a.i + (dir > 0 ? 1 : -1)
  return j >= 0 && j < a.v.length ? a.v[j] : null
}

// The numbers the widget logged, onto a set row (each side of a per-side one: half the reps each).
export function withNumbers (row, { w, r, sec }) {
  if (isSideSet(row)) {
    const side = (x, half) => ({ ...x, ...(w != null ? { w } : {}), ...(r != null ? { r: half } : {}) })
    const L = r != null ? Math.ceil(r / 2) : null, R = r != null ? Math.floor(r / 2) : null
    return syncSideAggregate({ ...row, sides: { L: side(row.sides.L, L), R: side(row.sides.R, R) } })
  }
  return { ...row, ...(w != null ? { w } : {}), ...(r != null ? { r } : {}), ...(sec != null ? { sec } : {}) }
}
