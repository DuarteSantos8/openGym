// Session finalization: one completed log against its prescription in, the track's next
// ProgressionState out. The completion list is a flat AND — every condition must pass.
import { roundLoad } from './load.js'
import { INCREMENTING_GATES, PRESETS } from './rules.js'

export function initialProgressionState(trackId) {
  return {
    trackId, status: 'active', cyclesCompleted: 0,
    lastPrescriptionId: null, lastCompletedLogId: null, lastActual: null,
    terminalTarget: null, completedAt: null,
    planRuleRevision: null, readyToIncrement: false, position: 0, trainingMax: null
  }
}

const decidingRows = p => (p.rows.some(r => r.anchor) ? p.rows.filter(r => r.anchor) : p.rows)
const targetActual = (p, a) => p.parameters.durationSeconds ? a.durationSeconds : a.reps
const targetRange = (p, row) => p.parameters.durationSeconds || row.reps
const targetMax = (p, a) => {
  const actual = targetActual(p, a)
  const range = p.parameters.durationSeconds || p.parameters.reps
  return actual != null && actual >= range.max
}

// At least what was prescribed, on the rows that decide.
function hit(p, a) {
  const rows = decidingRows(p)
  const actual = targetActual(p, a)
  if (!(a.sets >= p.parameters.sets.min) || actual == null || actual < Math.min(...rows.map(r => targetRange(p, r).min))) return false
  const loads = rows.map(r => r.load?.value).filter(Number.isFinite)
  return !loads.length || (a.load?.value ?? -Infinity) >= Math.min(...loads)
}

const GATES = {
  hit,
  max_reps: (p, a) => hit(p, a) && targetMax(p, a),
  max_sets_reps: (p, a) => hit(p, a) && a.sets >= p.parameters.sets.max && targetMax(p, a),
  rung: (p, a) => a.sets >= p.parameters.sets.max && a.reps != null && a.reps >= p.parameters.reps.max,
  // A timed hold with no load: reaching the top of the seconds window is the whole step.
  seconds: (p, a) => hit(p, a) && targetMax(p, a)
}

const PASSES = {
  target_load: (p, a) => {
    const target = p.target.resolved?.value
    const load = a.load?.value ?? p.parameters.load.resolved?.value
    return target != null && load != null && load >= target
  },
  max_sets: (p, a) => a.sets >= p.parameters.sets.max,
  max_reps: targetMax,
  max_duration: (p, a, next, c) => a.durationSeconds != null && a.durationSeconds >= (c.target ?? p.parameters.durationSeconds.max),
  cycle_count: (p, a, next, c) => next.cyclesCompleted >= c.target,
  training_max: (p, a, next, c) => (next.trainingMax?.value ?? -Infinity) >= c.target,
  difficulty_rung: p => p.position === p.special.rungs.length - 1
}

// A rule that names a target effort holds the load when its weakest deciding set left fewer reps
// in reserve than the floor. No logged effort never blocks. Greyskull's last set is an AMRAP taken
// to failure, so it cannot be held to a floor.
const effortOk = (p, a) => p.preset === 'greyskull' || !p.parameters.rir || a.rir == null || a.rir >= p.parameters.rir.min

/** @param {{ state: Object|null, prescription: Object, log: { id: string, actual: Object }, now: string }} input */
export function advanceProgression({ state, prescription: p, log, now }) {
  const base = state || initialProgressionState(p.trackId)
  const next = { ...base, planRuleRevision: p.planRuleRevision, lastPrescriptionId: p.id, lastCompletedLogId: log.id, lastActual: log.actual }
  // Completed freezes automation only — the log above is still recorded. An edited rule reopens.
  if (base.status === 'completed' && base.planRuleRevision === p.planRuleRevision) return { ...next, readyToIncrement: false }
  Object.assign(next, { status: 'active', terminalTarget: null, completedAt: null })

  const gate = PRESETS[p.preset].gate
  const earned = gate ? GATES[gate](p, log.actual) && effortOk(p, log.actual) : false
  next.readyToIncrement = earned && INCREMENTING_GATES.includes(gate)
  if (gate === 'rung' && earned && p.position < (p.special.rungs?.length ?? 0) - 1) next.position = p.position + 1
  if (gate === 'seconds' && earned) next.position = p.position + 1
  if (p.preset === 'five_three_one') {
    next.trainingMax = p.trainingMax ? { ...p.trainingMax } : null
    next.position = p.position + 1
    if (next.position >= p.special.cycleSets.length) {
      next.position = 0
      next.cyclesCompleted = base.cyclesCompleted + 1
      if (p.trainingMax) next.trainingMax = { value: roundLoad(p.trainingMax.value + p.special.endOfCycleIncrement.value, p.rounding), unit: p.trainingMax.unit }
    }
  }

  if (p.completion.length && p.completion.every(c => PASSES[c.metric](p, log.actual, next, c))) {
    Object.assign(next, { status: 'completed', terminalTarget: p.target.resolved ? { ...p.target.resolved } : null, completedAt: now, readyToIncrement: false })
  }
  return next
}
