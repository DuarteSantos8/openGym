// Execution is always permissive: this module only explains how a logged value differs from its
// prescription. It returns warnings, never errors, and never changes a value it reads.
import { groupIdOf, phaseOf } from './program.js'

/** RPE is an entry scale; the engine compares RIR. rir = 10 − rpeEntered. */
export function normalizeEffort({ rir = null, rpeEntered = null } = {}) {
  return rpeEntered != null ? { rir: 10 - rpeEntered, rpeEntered } : { rir, rpeEntered: null }
}

/** True when a percent prescription has no 1RM to resolve from — its rows are manually fillable. */
export function missingReference(prescription) {
  if (prescription.snapshot1RM) return false
  if (prescription.parameters.load.expression.mode === 'percent_1rm') return true
  return !!prescription.ruleSnapshot.program.trainingMax && !prescription.trainingMax
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
  // A Max set is as many reps as you can: there is nothing to be outside of.
  if (planned.max) { /* no finding */ }
  // An AMRAP set's ceiling is not a ceiling.
  else if (planned.amrap) { if (actual.reps != null && actual.reps < planned.reps.min) out.push(finding('below_range', 'reps', planned.reps, actual.reps, at)) }
  else outside(out, 'reps', planned.reps, actual.reps, at)
  const load = actual.load?.value
  if (load != null) {
    if (planned.load) outside(out, 'load', { min: planned.load.value, max: planned.loadTo?.value ?? planned.load.value }, load, at)
    else if (missingReference(prescription)) out.push(finding('missing_reference', 'load', null, load, at))
    // The target is a cap on the work and a floor on the help an assistance machine gives.
    const cap = prescription.target.resolved?.value
    if (cap != null && (prescription.assisted ? load < cap : load > cap)) out.push(finding('above_cap', 'load', cap, load, at))
  }
  outside(out, 'durationSeconds', p.durationSeconds, actual.durationSeconds, at)
  outside(out, 'rir', p.rir, normalizeEffort(actual).rir, at)
  return out
}

/**
 * The exercise-level actual that completion reads: every completed work set is counted, and the
 * weakest deciding set (the rows of the phase's success scope) supplies reps, load, duration and
 * effort — for an assistance machine that is the set with the most help. Each deciding set is also
 * held to its own row: `short` when one fell below its target, `light` when one was lifted below
 * its prescribed load. Sets added past the prescription are extra work: they never move the plan
 * (v1 #233). Values are copied exactly as logged.
 */
export function summarizeActual(prescription, performed) {
  const rows = prescription.rows
  const success = phaseOf(prescription).success
  const inScope = i => success.scope !== 'groups' || (!!rows[i] && success.groupIds.includes(groupIdOf(prescription, rows[i])))
  const prescribed = s => s.row == null || (s.row >= 0 && s.row < rows.length)
  const required = performed.filter(prescribed)
  // A Max set says nothing about whether the plan was hit: the other sets decide, unless every set is a Max.
  const notMax = required.filter(s => !rows[s.row]?.max)
  const pool = notMax.length ? notMax : required
  const deciding = pool.filter(s => s.row == null || inScope(s.row))
  const valueOf = s => (prescription.parameters.durationSeconds ? s.durationSeconds : s.reps)
  const short = deciding.some(s => s.row != null && Number.isFinite(valueOf(s)) && valueOf(s) < (prescription.parameters.durationSeconds || rows[s.row].reps).min)
  const step = prescription.ruleSnapshot.rounding.step ?? 0
  // Only a phase that asks for the prescribed load reads it.
  const light = (success.load === 'prescribed' || prescription.backoffStep > 0) && deciding.some(s => {
    const want = rows[s.row]?.load?.value
    if (!(want > 0) || !Number.isFinite(s.load?.value)) return false
    return prescription.assisted ? s.load.value > want + step / 2 + 1e-9 : s.load.value < want - step / 2 - 1e-9
  })
  const incomplete = deciding.some(s => !Number.isFinite(prescription.parameters.durationSeconds ? s.durationSeconds : s.reps) || (rows[s.row]?.load?.value > 0 && (!Number.isFinite(s.load?.value) || s.sideLoads?.some(v => !Number.isFinite(v)))) || s.sideReps?.some(v => !Number.isFinite(v)))
  const least = values => { const vs = values.filter(Number.isFinite); return vs.length ? Math.min(...vs) : null }
  // A timed hold done on both sides is one set: a limb row alone (the other side not done) is not.
  const done = new Set(required.filter(s => !s.limb || required.some(o => o.row === s.row && o.limb && o.limb !== s.limb)).map((s, i) => s.row ?? i)).size
  const loads = deciding.map(s => s.load).filter(l => Number.isFinite(l?.value))
  const durationSeconds = least(deciding.map(s => s.durationSeconds))
  const speed = least(deciding.map(s => s.speed))
  const rir = least(deciding.map(s => normalizeEffort(s).rir))
  const rpes = deciding.map(s => s.rpeEntered).filter(Number.isFinite)
  return {
    sets: done,
    ...(incomplete ? { incomplete: true } : {}),
    ...(short ? { short: true } : {}),
    ...(light ? { light: true } : {}),
    ...(deciding.some(s => prescription.rows[s.row]?.amrap) ? { amrapReps: least(deciding.filter(s => prescription.rows[s.row]?.amrap).map(s => s.reps)) } : {}),
    reps: least(deciding.map(s => s.reps)),
    load: loads.length ? { ...loads.reduce((a, b) => ((prescription.assisted ? b.value > a.value : b.value < a.value) ? b : a)) } : null,
    ...(durationSeconds != null ? { durationSeconds } : {}),
    ...(speed != null ? { speed } : {}),
    ...(rir != null ? { rir } : {}),
    ...(rpes.length ? { rpeEntered: Math.max(...rpes) } : {})
  }
}
