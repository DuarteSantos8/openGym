import { isAssisted } from './exercises.js'
// Estimated one-rep max (issue #18).
//
// Deliberately knows nothing about the exercise database: an estimate needs a weight AND a
// rep count, and only reps-mode sets carry both. Cardio sets ({min, speed}) and timed sets
// ({sec, w}) therefore drop out of every scan here on their own — there is no exercise-type
// check to keep in sync.
//
// Formulas are the usual submaximal-load estimators. Epley is the default because it is the
// one most lifters have seen; all of them agree closely at low reps and diverge as reps rise,
// which is exactly why REP_CAP exists.

// The formulas and the single-set estimate live with the engine
// (api/engine/one-rm.js), so the API's profile migration uses the same numbers.
import { DEFAULT_FORMULA, FORMULAS, REP_CAP, estimate1RM } from './prescription/index.js'
export { DEFAULT_FORMULA, FORMULAS, REP_CAP, estimate1RM }

// Best estimate out of one workout entry's completed sets.
// `topW` is ignored on purpose: it records the working weight a user confirmed after the
// exercise, with no rep count attached, so it cannot produce an estimate.
export function bestSetOf(exposure, formula = DEFAULT_FORMULA) {
  // An assistance machine has no one-rep max to estimate: the load is the help you were given,
  // so Epley on it would rise as you got weaker and call that a record (issue #232). These
  // exercises stay out of the estimate, the curve and the strength list entirely.
  if (isAssisted(exposure?.exerciseId)) return null
  let best = null
  ;(exposure?.performance?.sets || []).forEach(row => {
    if (row.status !== 'completed' || row.role === 'warmup') return
    const reps = row.observations?.find(x => x.metric === 'repetitions')?.value
    const weight = row.resistance?.kind === 'external-load' ? row.resistance.value : null
    const est = estimate1RM(weight, reps, formula)
    if (est !== null && (!best || est > best.est)) best = { est, w: Number(weight), r: Math.round(Number(reps)) }
  })
  return best
}

// One point per workout in which the exercise produced an estimate — feeds the trend chart.
// Chronological, matching the order workouts are appended in.
export function e1rmSeries(S, exId, formula = DEFAULT_FORMULA) {
  if (isAssisted(exId)) return []
  const pts = []
  ;(S.workouts || []).forEach(w => {
    const exposure = (w.exposures || []).find(x => x.exerciseId === exId)
    if (!exposure) return
    const best = bestSetOf(exposure, formula)
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
export function is1RMRecord(S, exId, exposure, formula = DEFAULT_FORMULA) {
  const now = bestSetOf(exposure, formula)
  if (!now) return null
  const prev = best1RM(S, exId, formula)
  return !prev || now.est > prev.est ? { ...now, prev: prev ? prev.est : 0 } : null
}
