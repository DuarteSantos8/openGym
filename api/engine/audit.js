// Execution is always permissive: this module only explains how a logged value differs from its
// prescription. It returns warnings, never errors, and never changes a value it reads.

/** RPE is an entry scale; the engine compares RIR. rir = 10 − rpeEntered. */
export function normalizeEffort({ rir = null, rpeEntered = null } = {}) {
  return rpeEntered != null ? { rir: 10 - rpeEntered, rpeEntered } : { rir, rpeEntered: null }
}

/** True when a percent prescription has no 1RM to resolve from — its rows are manually fillable. */
export function missingReference(prescription) {
  if (prescription.snapshot1RM) return false
  if (prescription.parameters.load.expression.mode === 'percent_1rm') return true
  return prescription.preset === 'five_three_one' && !prescription.trainingMax
}

const finding = (code, field, expected, actual, row) => ({ code, field, expected, actual, severity: 'warning', ...(row != null ? { row } : {}) })

function outside(out, field, bounds, value, row) {
  if (!bounds || value == null) return
  if (value < bounds.min) out.push(finding('below_range', field, bounds, value, row))
  else if (value > bounds.max) out.push(finding('above_range', field, bounds, value, row))
}

/**
 * @param {Object} prescription
 * @param {Object} actual  one set — { row, reps, load, durationSeconds, rir, rpeEntered }, `row`
 *                         being its prescribed row index — or the whole exercise, { sets }.
 * @param {Object|null} [state] the track's ProgressionState
 */
export function auditExecution(prescription, actual, state = null) {
  const out = []
  const p = prescription.parameters
  if (actual.row == null) {
    outside(out, 'sets', p.sets, actual.sets)
    if (prescription.statusAtGeneration === 'completed' || (state?.status === 'completed' && state.planRuleRevision === prescription.planRuleRevision)) out.push(finding('completed_track', 'track', null, null))
    return out
  }
  const at = actual.row
  const planned = prescription.rows[Math.min(at, prescription.rows.length - 1)]
  // An AMRAP set's ceiling is not a ceiling.
  if (planned.amrap) { if (actual.reps != null && actual.reps < planned.reps.min) out.push(finding('below_range', 'reps', planned.reps, actual.reps, at)) }
  else outside(out, 'reps', planned.reps, actual.reps, at)
  const load = actual.load?.value
  if (load != null) {
    if (planned.load) outside(out, 'load', { min: planned.load.value, max: planned.loadTo?.value ?? planned.load.value }, load, at)
    else if (missingReference(prescription)) out.push(finding('missing_reference', 'load', null, load, at))
    const cap = prescription.target.resolved?.value
    if (cap != null && load > cap) out.push(finding('above_cap', 'load', cap, load, at))
  }
  outside(out, 'durationSeconds', p.durationSeconds, actual.durationSeconds, at)
  outside(out, 'rir', p.rir, normalizeEffort(actual).rir, at)
  return out
}

/**
 * The exercise-level actual that completion reads: every completed work set is counted, and the
 * weakest deciding set (a pyramid's anchor rows, otherwise all rows) supplies reps, load,
 * duration and effort. Values are copied exactly as logged.
 */
export function summarizeActual(prescription, performed) {
  const anchors = prescription.rows.flatMap((r, i) => (r.anchor ? [i] : []))
  const deciding = anchors.length ? performed.filter(s => anchors.includes(s.row)) : performed
  const least = values => { const vs = values.filter(Number.isFinite); return vs.length ? Math.min(...vs) : null }
  const loads = deciding.map(s => s.load).filter(l => Number.isFinite(l?.value))
  const durationSeconds = least(deciding.map(s => s.durationSeconds))
  const rir = least(deciding.map(s => normalizeEffort(s).rir))
  const rpes = deciding.map(s => s.rpeEntered).filter(Number.isFinite)
  return {
    sets: performed.length,
    reps: least(deciding.map(s => s.reps)),
    load: loads.length ? { ...loads.reduce((a, b) => (b.value < a.value ? b : a)) } : null,
    ...(durationSeconds != null ? { durationSeconds } : {}),
    ...(rir != null ? { rir } : {}),
    ...(rpes.length ? { rpeEntered: Math.max(...rpes) } : {})
  }
}
