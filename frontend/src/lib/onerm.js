// Estimated one-rep max (issue #18).
//
// Deliberately knows nothing about the exercise database: an estimate needs a weight AND a
// rep count, and only reps-mode sets carry both. Cardio sets ({min, speed}) and timed sets
// ({sec, w}) therefore drop out of every scan here on their own — there is no exercise-type
// check to keep in sync.
//
// Formulas are the usual submaximal-load estimators. Epley is the default because it is the
// one most lifters have seen; all of them agree closely at low reps and diverge as reps rise,
// which is exactly why reporting consumers such as MCP apply REP_CAP.

import { normalizePhase, modeForSet, historyUnitCompatible, historyEntryCompatible } from './workout-model.js'

// API/reporting consumers refuse estimates above this many reps. The frontend keeps its
// historical estimator uncapped so an explicitly recorded high-rep result remains visible.
export const REP_CAP = 12

export const FORMULAS = {
  // Epley 1985 — w · (1 + r/30)
  epley: (w, r) => w * (1 + r / 30),
  // Brzycki 1993 — w · 36/(37 − r); formula validation below rejects non-finite/non-positive output
  brzycki: (w, r) => w * 36 / (37 - r),
  // Lombardi 1989 — w · r^0.10
  lombardi: (w, r) => w * Math.pow(r, 0.1)
}
export const DEFAULT_FORMULA = 'epley'

// Estimate a 1RM from one set. Returns null for anything it cannot honestly answer:
// missing/zero/negative load, no reps, non-finite input, or a formula that cannot produce a
// finite positive estimate.
// A single rep is not an estimate — it is the measurement — and comes back unchanged.
export function estimate1RM(w, r, formula = DEFAULT_FORMULA) {
  const weight = Number(w)
  const reps = Number(r)
  if (!isFinite(weight) || !isFinite(reps)) return null
  if (weight <= 0 || reps < 1) return null
  const fn = FORMULAS[formula] || FORMULAS[DEFAULT_FORMULA]
  const est = reps === 1 ? weight : fn(weight, Math.round(reps))
  if (!isFinite(est) || est <= 0) return null
  return Math.round(est * 10) / 10
}

// Best estimate out of one workout entry's completed sets.
// `topW` is ignored on purpose: it records the working weight a user confirmed after the
// exercise, with no rep count attached, so it cannot produce an estimate.
export function bestSetOf(entry, formula = DEFAULT_FORMULA, expectedUnit = null, inheritedUnit = null) {
  if (!historyEntryCompatible(entry, expectedUnit, inheritedUnit)) return null
  // A mode switch must not turn a timed or cardio entry that happens to retain a legacy
  // numeric field into a strength estimate. Missing targets remain legacy reps behaviour.
  // An entry can also contain malformed or legacy mixed-mode rows. Treat that as an
  // ineligible record rather than selecting the reps row and silently combining it with a
  // time prescription in the same workout.
  const targetSource = entry?.target || entry || {}
  if (modeForSet({}, targetSource) !== 'reps') return null
  const workModes = new Set((entry?.sets || [])
    .filter(s => normalizePhase(s.phase, 'work') === 'work')
    .map(s => modeForSet(s, entry.target || entry)))
  if (workModes.size !== 1 || !workModes.has('reps')) return null
  let best = null
  ;(entry?.sets || []).forEach(s => {
    if (!s.done || normalizePhase(s.phase, 'work') !== 'work') return
    if (modeForSet(s, entry.target || entry) !== 'reps') return
    const est = estimate1RM(s.w, s.r, formula)
    if (est !== null && (!best || est > best.est)) best = { est, w: Number(s.w), r: Math.round(Number(s.r)) }
  })
  return best
}

// One point per workout in which the exercise produced an estimate — feeds the trend chart.
// Chronological, matching the order workouts are appended in.
export function e1rmSeries(S, exId, formula = DEFAULT_FORMULA) {
  const pts = []
  ;(S.workouts || []).forEach(w => {
    if (!historyUnitCompatible(w, S.unit)) return
    const entry = w.entries.find(e => e.id === exId)
    if (!entry) return
    const best = bestSetOf(entry, formula, S.unit, w.unit)
    if (best) pts.push({ t: w.start, d: w.d, y: best.est, w: best.w, r: best.r })
  })
  return pts
}

// All-time best estimate for an exercise, with the set and date it came from — the source
// matters, because "142.5 kg est. from 100×10" is a very different claim from "from 140×1".
export function best1RM(S, exId, formula = DEFAULT_FORMULA) {
  let best = null
  e1rmSeries(S, exId, formula).forEach(p => { if (!best || p.y > best.est) best = { est: p.y, w: p.w, r: p.r, d: p.d, t: p.t } })
  return best
}

// Did this workout beat every estimate that came before it? Used for the finish summary,
// so it compares against history that does not yet contain `w`.
export function is1RMRecord(S, exId, entry, formula = DEFAULT_FORMULA) {
  const now = bestSetOf(entry, formula, S.unit)
  if (!now) return null
  const prev = best1RM(S, exId, formula)
  return !prev || now.est > prev.est ? { ...now, prev: prev ? prev.est : 0 } : null
}
