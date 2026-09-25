// api/engine/warmup.js
// Warm-up rows for one prescription. Pure: the resolved work rows and the occurrence's warm-up
// recipe in, rounded warm-up rows out. Never reads history and never touches progression — the
// rows are `phase: 'warmup'`, which every progression/volume/1RM reader already skips
// (spec "Intelligent Warm-up Plans").
import { roundLoad } from './load.js'

const steps = list => list.map(([percent, reps]) => ({ percent, reps }))
const RECIPES = {
  heavy: steps([[25, 8], [40, 5], [60, 3], [75, 1], [85, 1]]),
  standard: steps([[40, 8], [60, 5], [75, 2], [85, 1]]),
  light: steps([[50, 8], [70, 4], [85, 1]])
}
const HEAVY = new Set(['barbell', 'smith machine'])
// 'body weight' only reaches the planner with a positive external load (a belt, a vest).
const STANDARD = new Set(['dumbbell', 'machine', 'leverage machine', 'leverage', 'cable', 'body weight'])

/** Missing metadata never blocks a workout: it reads as standard. */
export const warmupClass = eq => (!eq ? 'standard' : HEAVY.has(eq) ? 'heavy' : STANDARD.has(eq) ? 'standard' : 'light')

/** Longest smart ramp the equipment class offers; a bigger count would silently clamp. */
export const warmupMaxCount = eq => RECIPES[warmupClass(eq)].length

export function warmupSteps(warmup, eq) {
  if (warmup?.mode === 'template') return warmup.steps
  if (warmup?.mode === 'smart') return RECIPES[warmupClass(eq)].slice(-warmup.count)
  return []
}

/** The first positive resolved work load is the only reference — never a range end or a later row. */
export function planWarmupRows({ rows, warmup, eq, rounding }) {
  const work = rows.find(r => r.load?.value > 0)?.load
  if (!work) return []
  // The set editor's step (see loadStepFor); an allowed-values rule has none, so the unit default.
  const down = { mode: 'down', step: rounding?.step || (work.unit === 'lb' ? 5 : 2.5) }
  const out = []
  for (const { percent, reps } of warmupSteps(warmup, eq)) {
    const value = roundLoad(work.value * percent / 100, down)
    if (value <= 0 || value >= work.value || value === out.at(-1)?.load.value) continue
    out.push({ load: { value, unit: work.unit }, reps, phase: 'warmup' })
  }
  return out
}

const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi
const keys = o => Object.keys(o).sort().join()
const stepOk = (s, decimals) => !!s && typeof s === 'object' && keys(s) === 'percent,reps'
  && Number.isFinite(s.percent) && s.percent >= 1 && s.percent <= 100 && Number(s.percent.toFixed(decimals)) === s.percent
  && int(s.reps, 1, 30)

/** Every trust boundary (editor save, plan import, shared-plan merge) runs this. Missing = off. */
export function validateWarmup(w, decimals = 1) {
  if (w === undefined) return true
  if (!w || typeof w !== 'object' || Array.isArray(w)) return false
  if (w.mode === 'off') return keys(w) === 'mode'
  if (w.mode === 'smart') return keys(w) === 'count,mode' && int(w.count, 1, 5)
  if (w.mode === 'template') return keys(w) === 'mode,steps' && Array.isArray(w.steps)
    && w.steps.length >= 1 && w.steps.length <= 5 && w.steps.every(s => stepOk(s, decimals))
  return false
}

/** Legacy `warmupSets: n` → smart ramp of min(n, 5); zero or negative → off (omitted). */
export function migrateOccurrence(occ) {
  if (!occ || !('warmupSets' in occ)) return occ
  const { warmupSets, ...rest } = occ
  const n = Math.round(Number(warmupSets)) || 0
  return n > 0 && !rest.warmup ? { ...rest, warmup: { mode: 'smart', count: Math.min(5, n) } } : rest
}

/** Pure and idempotent. Only saved routine occurrences change; sessions, history, prescriptions
 *  and progression are never touched. The same object comes back when there is nothing to do,
 *  so the caller can tell whether a save is owed. */
export function migrateWarmups(state) {
  if (!state?.routines?.some(r => r?.ex?.some(o => o && 'warmupSets' in o))) return state
  return { ...state, routines: state.routines.map(r => (r?.ex ? { ...r, ex: r.ex.map(migrateOccurrence) } : r)) }
}
