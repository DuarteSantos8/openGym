import { isAssisted } from './exercises.js'
import { currentDbLoad, dbLoadOf, entryDbLoad, workoutAs, meaningFactor } from './dumbbells.js'
import { workoutAt } from './history.js'
// Estimated one-rep max (issue #18).
//
// Deliberately knows nothing about the exercise database: an estimate needs a weight AND a
// rep count, and only reps-mode sets carry both. Cardio sets ({min, speed}) and timed sets
// ({sec, w}) therefore drop out of every scan here on their own — there is no exercise-type
// check to keep in sync.
//
// Formulas are submaximal-load estimators. Epley is the default because it is the
// one most lifters have seen; all of them agree closely at low reps and diverge as reps rise,
// which is exactly why REP_CAP exists. The weighted ensemble (issue #155) blends seven
// formulas plus an RIR %1RM map to produce a more stable estimate at higher rep ranges.

// The formulas and the single-set estimate live with the engine
// (api/engine/one-rm.js), so the API's profile migration uses the same numbers.
import { currentOneRm, DEFAULT_FORMULA, FORMULAS, REP_CAP, WEIGHTED_REP_CAP, FORMULA_NAMES, formulaOf, ensembleCV, weightedEstimate, estimate1RM } from './prescription/index.js'
export { DEFAULT_FORMULA, FORMULAS, REP_CAP, WEIGHTED_REP_CAP, FORMULA_NAMES, formulaOf, ensembleCV, weightedEstimate, estimate1RM }

// Best estimate out of one workout entry's completed sets.
// `topW` is ignored on purpose: it records the working weight a user confirmed after the
// exercise, with no rep count attached, so it cannot produce an estimate.
export function bestSetOf(exposure, formula = DEFAULT_FORMULA) {
  // An assistance machine has no one-rep max to estimate: the load is the help you were given,
  // so Epley on it would rise as you got weaker and call that a record (issue #232). These
  // exercises stay out of the estimate, the curve and the strength list entirely.
  if (typeof exposure?.assisted === 'boolean' ? exposure.assisted : isAssisted(exposure?.exerciseId)) return null
  let best = null
  ;(exposure?.performance?.sets || []).forEach(row => {
    if (row.status !== 'completed' || row.role === 'warmup') return
    const reps = row.observations?.find(x => x.metric === 'repetitions')?.value
    const weight = row.resistance?.kind === 'external-load' ? row.resistance.value : null
    const est = estimate1RM(weight, reps, formula, row.rir ?? null)
    if (est !== null && (!best || est > best.est)) best = { est, w: Number(weight), r: Math.round(Number(reps)) }
  })
  return best
}

function bestSetOfEntries(entries, formula = DEFAULT_FORMULA) {
  let best = null
  for (const entry of entries || []) {
    const candidate = bestSetOf(entry, formula)
    if (candidate && (!best || candidate.est > best.est)) best = candidate
  }
  return best
}

// One point per workout in which the exercise produced an estimate — feeds the trend chart.
// Chronological, matching the order workouts are appended in.
export function e1rmSeries(S, exId, formula = formulaOf(S), as = currentDbLoad(S, exId)) {
  const pts = []
  ;(S.workouts || []).forEach(stored => {
    const w = workoutAs(stored, exId, as)
    // A combined session can hold the exercise twice: one point, from its strongest occurrence.
    const best = bestSetOfEntries((w.exposures || []).filter(x => x.exerciseId === exId), formula)
    if (best) pts.push({ t: workoutAt(w), d: w.d, y: best.est, w: best.w, r: best.r })
  })
  return pts
}

// All-time best estimate for an exercise, with the set and date it came from — the source
// matters, because "142.5 kg est. from 100×10" is a very different claim from "from 140×1".
export function best1RM(S, exId, formula = formulaOf(S), as) {
  let best = null
  e1rmSeries(S, exId, formula, as ?? currentDbLoad(S, exId)).forEach(p => { if (!best || p.y > best.est) best = { est: p.y, w: p.w, r: p.r, d: p.d, t: p.t } })
  return best
}

// Did this workout beat every estimate that came before it? Used for the finish summary,
// so it compares against history that does not yet contain `w`.
export function is1RMRecord(S, exId, exposure, formula = formulaOf(S)) {
  const now = bestSetOf(exposure, formula)
  if (!now) return null
  // Held against history read the way this session logged its weight (lib/dumbbells.js).
  const prev = best1RM(S, exId, formula, entryDbLoad(exposure))
  return !prev || now.est > prev.est ? { ...now, prev: prev ? prev.est : 0 } : null
}

// Confidence index (0–1) of a 1RM estimate. Accounts for rep-count decay, RIR
// subjectivity, and (for the weighted ensemble) inter-formula disagreement.
export function calculate1RMAccuracy(reps, rir = null, formula = 'weighted') {
  const r = Number(reps)
  if (!isFinite(r) || r < 1) return 0
  if (r === 1 && rir === 0) return 1
  if (r > WEIGHTED_REP_CAP) return 0

  // Rep-count decay: 1.0 at 1 rep → 0.5 at WEIGHTED_REP_CAP
  const repFactor = r === 1 ? 1 : 1 - 0.5 * (r - 1) / (WEIGHTED_REP_CAP - 1)

  // Reps left in reserve introduce subjective uncertainty (~8% penalty). RIR 0
  // (to failure) is the objective end of the scale and carries no penalty.
  const rirVal = Number(rir)
  const rirFactor = (rir != null && isFinite(rirVal) && rirVal > 0) ? 0.92 : 1

  // Inter-formula spread (weighted only): higher CV → lower confidence
  let spreadFactor = 1
  if (formula === 'weighted' && r >= 2) {
    const cv = ensembleCV(100, r)
    spreadFactor = Math.max(0.5, 1 - cv / 0.15 * 0.5)
  }

  return Math.round(repFactor * rirFactor * spreadFactor * 100) / 100
}

/** The latest frozen 1RM read in this session's meaning; the stored record stays untouched. */
export function oneRmForMeaning(profile, exerciseId, meaning) {
  const record = currentOneRm(profile.oneRepMaxes, exerciseId)
  if (!record) return null
  const source = (profile.workouts || []).flatMap(w => w.exposures || []).find(x => x.exposureId === record.sourceRecordId)
  const from = dbLoadOf(record.dbLoad) || (source ? entryDbLoad(source) : 'as')
  const factor = meaningFactor(from, meaning, { id: exerciseId, side: source?.side, bells: source?.bells })
  return factor === 1 ? record : { ...record, value: record.value * factor }
}
