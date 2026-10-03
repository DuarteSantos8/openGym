// Which logged session a prescription starts from, and whether the plan was edited since
// (openGym v1.3.9, issues #216 and #275). Pure: the caller passes the profile's workouts,
// prescriptions and progression; generatePrescription consumes the result.
import { canonicalJSON } from './canonical.js'
import { advanceProgression } from './advance.js'

/** The part of a rule that, edited, restarts progression: sets, reps and a declared hold. Weight is not in it. */
export function planFingerprint(rule) {
  const p = rule.parameters
  return canonicalJSON({ sets: p.sets, reps: p.reps, durationSeconds: p.durationSeconds ?? null })
}

const isWork = row => row.status === 'completed' && row.role !== 'warmup'

/** The heaviest completed work load of a log (the lightest, on an assistance machine): v1's readSession.weight. */
export function bestLoad(x, assisted) {
  const loads = (x?.performance?.sets || []).filter(r => isWork(r) && r.resistance?.kind === 'external-load').map(r => r.resistance.value)
  return loads.length ? (assisted ? Math.min(...loads) : Math.max(...loads)) : x?.actual?.load?.value ?? null
}

/**
 * The weakest completed working load of a log — the lightest, or on an assistance machine the one
 * with the most help: its summary, else its rows (legacy and imported history).
 */
function liftedLoad(x, assisted) {
  if (x.actual?.load) return { ...x.actual.load }
  const loads = (x.performance?.sets || []).filter(r => isWork(r) && r.resistance?.kind === 'external-load')
  if (!loads.length) return null
  const weakest = loads.reduce((a, b) => ((assisted ? b.resistance.value > a.resistance.value : b.resistance.value < a.resistance.value) ? b : a)).resistance
  return { value: weakest.value, unit: weakest.unit }
}

export function chronologicalWorkouts(workouts = []) {
  const day = w => Number.isFinite(Date.parse(w.d)) ? Date.parse(w.d) : Math.floor((w.start ?? 0) / 86400000) * 86400000
  return [...workouts].sort((a, b) => day(a) - day(b) || (a.start ?? 0) - (b.start ?? 0) || String(a.id ?? '').localeCompare(String(b.id ?? '')))
}

function newest(workouts, match) {
  workouts = chronologicalWorkouts(workouts)
  for (let i = workouts.length - 1; i >= 0; i--) {
    const exposures = workouts[i].exposures || []
    for (let j = exposures.length - 1; j >= 0; j--) if (match(exposures[j])) return exposures[j]
  }
  return null
}

/**
 * A track's state as its counted logs leave it, advanced one after another the way each finish
 * advanced it, up to and including `upTo` (default: every log). Null when it has none.
 */
export function replayProgression({ workouts = [], trackId, prescriptions = {}, upTo = null }) {
  let state = null
  let previous = null
  for (const w of chronologicalWorkouts(workouts)) for (const x of w.exposures || []) {
    const p = x.trackId === trackId && x.prescriptionId && !x.excludedFromProgression && x.actual ? prescriptions[x.prescriptionId] : null
    if (p) {
      if (previous?.planFingerprint && p.planFingerprint && previous.planFingerprint !== p.planFingerprint) state = null
      state = advanceProgression({ state, prescription: p, log: { id: x.exposureId, actual: x.actual }, now: x.completedAt ?? null })
      previous = p
    }
    if (x === upTo) return state
  }
  return state
}

/**
 * The occurrence's own newest counted log comes first (#216). Only when it has none, the
 * exercise's newest log anywhere: a prescription-less one is imported or legacy history, never
 * counted on a track but still what was last lifted.
 * Explicitly excluded work never supplies that fallback; ordinary unlinked history still does.
 *
 * A reset (#275): the baseline's recorded plan differs from this rule's, or the baseline was
 * borrowed and records no plan. An own log with no recorded plan never resets.
 */
export function resolveProgressionContext({ trackId, exerciseId, rule, workouts = [], prescriptions = {}, progression = {}, assisted = false }) {
  const own = newest(workouts, x => x.trackId === trackId && x.prescriptionId && !x.excludedFromProgression)
  const borrowed = own ? null : newest(workouts, x => x.exerciseId === exerciseId
    && x.progressionExclusion !== 'explicit'
    && (!x.prescriptionId || !x.excludedFromProgression) && (x.performance?.sets || []).some(isWork))
  const baseline = own || borrowed
  const source = own ? 'slot' : borrowed ? 'exercise' : null
  let state = (baseline?.trackId && progression[baseline.trackId]) || null
  // A track's state is what its newest log left. When the baseline is not that log — a day logged
  // into the past reads only the history before it (#284), and a logged-late session never
  // advanced its track — the state is what the track's logs up to the baseline leave, replayed.
  const derive = !!baseline?.prescriptionId && !!baseline.actual && (!state || (!!state.lastCompletedLogId && state.lastCompletedLogId !== baseline.exposureId))
  const lastPrescription = prescriptions[derive ? baseline.prescriptionId : state?.lastPrescriptionId ?? baseline?.prescriptionId] || null
  if (derive) state = replayProgression({ workouts, trackId: baseline.trackId, prescriptions, upTo: baseline })
  const recorded = lastPrescription?.planFingerprint ?? null
  const reset = recorded ? (recorded !== planFingerprint(rule) ? 'plan_changed' : null)
    : source === 'exercise' ? 'first_in_routine' : null
  return { baseline, source, reset, state: reset ? null : state, lastPrescription, heldLoad: baseline ? liftedLoad(baseline, assisted) : null }
}
