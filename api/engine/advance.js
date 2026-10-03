// Session finalization: one completed log against its prescription in, the track's next
// ProgressionState out. The completion list is a flat AND — every condition must pass.
import { roundLoad } from './load.js'
import { DELOAD_GATES, INCREMENTING_GATES, PRESETS } from './rules.js'

export function initialProgressionState(trackId) {
  return {
    trackId, status: 'active', cyclesCompleted: 0,
    lastPrescriptionId: null, lastCompletedLogId: null, lastActual: null,
    terminalTarget: null, completedAt: null,
    planRuleRevision: null, readyToIncrement: false, position: 0, trainingMax: null,
    stalls: 0, stallLoad: null, stallBest: null, readyToDeload: false
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

// At least what was prescribed, on the rows that decide: sets and reps (or seconds), as v1 judged a
// session. The load lifted is not part of it — generate.js builds the next load from what was lifted.
function hit(p, a) {
  const rows = decidingRows(p)
  const actual = targetActual(p, a)
  if (a.incomplete) return false
  return a.sets >= Math.max(p.parameters.sets.min, p.rows.length) && actual != null && actual >= Math.min(...rows.map(r => targetRange(p, r).min))
}

/** Load-progressing work whose log carries no load (an assistance machine's 0 is real help, not a missing weight). */
export function unweightedLog(p, actual) {
  return INCREMENTING_GATES.includes(PRESETS[p.preset].gate) && !p.assisted && !((actual?.load?.value ?? p.parameters.load.resolved?.value ?? 0) > 0)
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
    return target != null && load != null && (p.assisted ? load <= target : load >= target)
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
  if (base.status === 'completed' && base.planRuleRevision === p.planRuleRevision) return { ...next, readyToIncrement: false, readyToDeload: false }
  Object.assign(next, { status: 'active', terminalTarget: null, completedAt: null })

  const gate = PRESETS[p.preset].gate
  const earned = gate ? GATES[gate](p, log.actual) && effortOk(p, log.actual) : false
  next.clean = hit(p, log.actual) && effortOk(p, log.actual)
  next.incrementMultiplier = p.preset === 'greyskull' && next.clean && log.actual.amrapReps >= 2 * p.parameters.reps.min ? 2 : 1
  next.readyToIncrement = earned && INCREMENTING_GATES.includes(gate)
  // A loaded lift logged with no weight (a quick-added exercise starts at 0): there is nothing to
  // progress from, so v1 held and asked for the weight. No step is earned and no miss is counted.
  const unweighted = unweightedLog(p, log.actual)
  if (unweighted) next.readyToIncrement = false
  if (gate === 'rung' && earned && p.position < (p.special.rungs?.length ?? 0) - 1) next.position = p.position + 1
  // The prescription's own position, not the old state's: a deloaded hold was generated further back.
  if (gate === 'seconds') next.position = earned ? p.position + 1 : p.position
  // A stall is a session short of even the minimum prescribed (v1's "not ok"): a clean session that
  // has not yet reached the top of a range is a hold, not a stall, and ends the streak. The streak
  // is also broken by a change of load — the lighter weight after a deload is not judged by the
  // misses that earned it.
  if (unweighted) Object.assign(next, { stalls: 0, stallLoad: null, stallBest: null, readyToDeload: false })
  else if (DELOAD_GATES.includes(gate)) {
    const missed = !hit(p, log.actual)
    // What the run is at: the load lifted, or a hold's window — v1 kept counting misses across a
    // hold's back-off and deloaded it again straight away; a new window is a new run here.
    const at = gate === 'seconds' ? p.parameters.durationSeconds?.min ?? null : log.actual.load?.value ?? p.parameters.load.resolved?.value ?? null
    const got = targetActual(p, log.actual)
    const sameRun = missed && base.stalls > 0 && base.stallLoad === at
    // v1 stallCount (!93): at one weight, beating the best of the run is progress, not a stall.
    const improved = p.preset === 'double' && sameRun && got != null && got > (base.stallBest ?? Infinity)
    next.stalls = !missed ? 0 : sameRun ? base.stalls + (improved ? 0 : 1) : 1
    next.stallLoad = missed ? at : null
    next.stallBest = missed ? (sameRun ? Math.max(base.stallBest ?? 0, got ?? 0) : got ?? null) : null
    next.readyToDeload = missed && !!p.deload && next.stalls >= p.deload.after
  }
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
    Object.assign(next, { status: 'completed', terminalTarget: p.target.resolved ? { ...p.target.resolved } : null, completedAt: now, readyToIncrement: false, readyToDeload: false })
  }
  return next
}
