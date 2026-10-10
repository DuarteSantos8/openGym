import { isAssisted } from './exercises.js'
import { isSideSet } from './workout-model.js'
import { entriesForExercise, metricRowsForEntry, workoutAt } from './history.js'
import { currentDbLoad, entryDbLoad, workoutAs } from './dumbbells.js'
// Estimated one-rep max (issue #18, extended issue #155).
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

// Above this many reps an individual formula says more about work capacity than maximal
// strength, and the formulas disagree by double digits. Refusing to guess beats printing
// a fantasy.
export const REP_CAP = 12

// Weighted ensemble can tolerate slightly higher reps because the blend cancels
// individual-formula drift — but it still has a ceiling.
export const WEIGHTED_REP_CAP = 15

// ── Formula Suite ────────────────────────────────────────────────────────────────

export const FORMULAS = {
  epley:    (w, r) => w * (1 + r / 30),
  brzycki:  (w, r) => w * 36 / (37 - r),
  lombardi: (w, r) => w * Math.pow(r, 0.1),
  oconner:  (w, r) => w * (1 + r / 40),
  mayhew:   (w, r) => (w * 100) / (52.2 + 41.9 * Math.exp(-0.055 * r)),
  wathan:   (w, r) => (w * 100) / (48.8 + 53.8 * Math.exp(-0.075 * r)),
  lander:   (w, r) => (w * 100) / (101.3 - 2.67123 * r),
}
export const DEFAULT_FORMULA = 'epley'

// The formula a profile picked in Settings (Discord "toggle which 1RM formula to use"). Anything
// this build does not know reads as the default, so an older or newer device can't break it.
// Names as the formulas' authors are known, so not translated. 'weighted' blends all seven.
export const FORMULA_NAMES = {
  epley: 'Epley', brzycki: 'Brzycki', lombardi: 'Lombardi', oconner: 'O’Conner',
  mayhew: 'Mayhew', wathan: 'Wathan', lander: 'Lander',
}
export const formulaOf = S => {
  const f = S?.oneRmFormula
  return f === 'weighted' || Object.hasOwn(FORMULAS, f) ? f : DEFAULT_FORMULA
}

// ── RIR %1RM map (Mike Tuchscherer / RTS scale) ─────────────────────────────────
// Index 0 = 1 rep to failure, index 14 = 15 reps to failure.
const RIR_PCT = [
  100, 95.5, 92.2, 89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9,
  71.7, 69.5, 67.5, 65.5, 63.6,
]

function rirEstimate(w, effectiveReps) {
  const idx = Math.min(Math.max(Math.round(effectiveReps) - 1, 0), RIR_PCT.length - 1)
  return (w * 100) / RIR_PCT[idx]
}

// ── Weight Matrix ────────────────────────────────────────────────────────────────
// a_i: absolute reliability; v_i(r): variable attenuation as effective reps rise.
// weight_i(r) = a_i * v_i(r)
const WEIGHTS = {
  epley:    { a: 0.95, v: r => r <= 6  ? 1 : Math.max(0.4, 1 - (r - 6) * 0.12) },
  brzycki:  { a: 1.10, v: r => r <= 8  ? 1 : Math.max(0.3, 1 - (r - 8) * 0.18) },
  lombardi: { a: 0.85, v: r => r <= 5  ? 1 : Math.max(0.4, 1 - (r - 5) * 0.10) },
  oconner:  { a: 0.90, v: r => r <= 6  ? 1 : Math.max(0.4, 1 - (r - 6) * 0.12) },
  mayhew:   { a: 0.95, v: r => r <= 8  ? 1 : Math.max(0.5, 1 - (r - 8) * 0.10) },
  wathan:   { a: 0.90, v: r => r <= 7  ? 1 : Math.max(0.4, 1 - (r - 7) * 0.12) },
  lander:   { a: 0.85, v: r => r <= 7  ? 1 : Math.max(0.35, 1 - (r - 7) * 0.15) },
  rir:      { a: 1.00, v: r => r <= 10 ? 1 : Math.max(0.4, 1 - (r - 10) * 0.15) },
}

// Coefficient of variation across the seven formula estimates (scale-invariant).
function ensembleCV(w, effectiveReps) {
  const vals = Object.keys(FORMULAS).map(f => FORMULAS[f](w, effectiveReps))
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  const variance = vals.reduce((a, e) => a + (e - mean) ** 2, 0) / vals.length
  return Math.sqrt(variance) / mean
}

// Weighted average of all formula estimates and the RIR %1RM map. Exported unrounded so
// internal consumers (e.g. the fatigue model's intensity anchor) keep the precise blend;
// the public estimate1RM() applies display rounding.
export function weightedEstimate(w, effectiveReps) {
  let total = 0
  let wsum = 0
  for (const [name, fn] of Object.entries(FORMULAS)) {
    const wt = WEIGHTS[name].a * WEIGHTS[name].v(effectiveReps)
    total += fn(w, effectiveReps) * wt
    wsum += wt
  }
  const rirWt = WEIGHTS.rir.a * WEIGHTS.rir.v(effectiveReps)
  total += rirEstimate(w, effectiveReps) * rirWt
  wsum += rirWt
  return total / wsum
}

// ── Public API ───────────────────────────────────────────────────────────────────

// Estimate a 1RM from one set. Returns null for anything it cannot honestly answer:
// missing/zero/negative load, no reps, non-finite input, or more reps than the cap.
// A single rep to failure is not an estimate — it is the measurement — and comes back
// unchanged.
export function estimate1RM(w, r, formula = DEFAULT_FORMULA, rir = null) {
  const weight = Number(w)
  const reps = Number(r)
  if (!isFinite(weight) || !isFinite(reps)) return null
  if (weight <= 0 || reps < 1) return null

  const validRir = rir != null && Number(rir) >= 0

  // r === 1, no RIR or RIR 0 → measurement, not estimate
  if (reps === 1 && (!validRir || Number(rir) === 0)) {
    return Math.round(weight * 10) / 10
  }

  if (formula === 'weighted') {
    const effectiveReps = validRir ? reps + Number(rir) : reps
    if (effectiveReps > WEIGHTED_REP_CAP) return null
    const est = weightedEstimate(weight, effectiveReps)
    if (!isFinite(est) || est <= 0) return null
    return Math.round(est * 10) / 10
  }

  if (reps > REP_CAP) return null
  const fn = FORMULAS[formula] || FORMULAS[DEFAULT_FORMULA]
  const est = reps === 1 ? weight : fn(weight, Math.round(reps))
  if (!isFinite(est) || est <= 0) return null
  return Math.round(est * 10) / 10
}

// Best estimate out of one workout entry's completed sets.
// `topW` is ignored on purpose: it records the working weight a user confirmed after the
// exercise, with no rep count attached, so it cannot produce an estimate.
export function bestSetOf(entry, formula = DEFAULT_FORMULA) {
  // An assistance machine has no one-rep max to estimate: the load is the help you were given,
  // so Epley on it would rise as you got weaker and call that a record (issue #232). These
  // exercises stay out of the estimate, the curve and the strength list entirely.
  if (entry?.target?.assisted === true || isAssisted(entry) || isAssisted(entry?.id)) return null
  let best = null
  metricRowsForEntry(entry, 'reps').forEach(s => {
    const sets = isSideSet(s)
      ? [s.sides.L, s.sides.R].filter(side => side?.done === true)
      : [s]
    sets.forEach(set => {
      const est = estimate1RM(set.w, set.r, formula, set.rir ?? null)
      if (est !== null && (!best || est > best.est)) best = { est, w: Number(set.w), r: Math.round(Number(set.r)) }
    })
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
// `as` is the meaning a dumbbell weight is read in (lib/dumbbells.js): the exercise's own by
// default, so a session logged as "40 total" sits on the same curve as one logged as "20 each".
export function e1rmSeries(S, exId, formula = formulaOf(S), as = currentDbLoad(S, exId)) {
  if (isAssisted(exId)) return []
  const pts = []
  ;(S.workouts || []).forEach(w => {
    const best = bestSetOfEntries(entriesForExercise(workoutAs(w, exId, as), exId), formula)
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
export function is1RMRecord(S, exId, entry, formula = formulaOf(S)) {
  const now = bestSetOf(entry, formula)
  if (!now) return null
  // Held against history read the way this session logged its weight (lib/dumbbells.js).
  const prev = best1RM(S, exId, formula, entryDbLoad(entry))
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
