// Session finalization: one completed log against its prescription in, the track's next
// ProgressionState out — including the values the next session targets. The order is fixed:
// judge the session, then completion, then a phase exit, then a stall back-off or the program's
// operators. The completion list is a flat AND — every condition must pass.
import { applyIncrement, roundLoad } from './load.js'
import { deloadPercent, deloadedLoad, deloadedPosition } from './deload.js'
import { bestLoad, bestLoadOf, entryValues, groupIdOf, operatorFor, phaseById, phaseOf, startOf, unweightedLog, valuesOfPrescription } from './program.js'


export function initialProgressionState(trackId) {
  return {
    trackId, status: 'active', cyclesCompleted: 0,
    lastPrescriptionId: null, lastCompletedLogId: null, lastActual: null,
    terminalTarget: null, completedAt: null, planRuleRevision: null, planFingerprint: null,
    phaseId: null, phaseExposures: 0, phaseSuccesses: 0, values: null,
    stalls: 0, stallAt: null, stallBest: null, deload: null
  }
}

const targetActual = (p, a) => (p.parameters.durationSeconds ? a.durationSeconds : a.reps)
// v1 readSession `low`: the fewest reps of the prescribed sets, a set left undone counting as none.
const lowOf = (p, a) => (a.sets < p.rows.length ? 0 : a.reps)

// At least what was prescribed, on every prescribed row of the success scope: sets and reps (or
// seconds), as v1 judged a session. The load counts only when the phase asks for it.
function minimumHit(p, phase, a) {
  if (a.incomplete || a.short || ((phase.success.load === 'prescribed' || p.backoffStep > 0) && a.light)) return false
  const scope = phase.success.scope === 'groups' ? p.rows.filter(r => phase.success.groupIds.includes(groupIdOf(p, r))) : p.rows
  const floor = Math.min(...scope.map(r => (p.parameters.durationSeconds || r.reps).min))
  const actual = targetActual(p, a)
  return a.sets >= Math.max(p.parameters.sets.min, p.rows.length) && actual != null && actual >= floor
}

/** How a session reads against its prescription: worked, at least the minimum, and the top of every range. */
export function verdictOf(p, a) {
  const phase = phaseOf(p)
  // A rule that names a target effort holds when its weakest deciding set left fewer reps in
  // reserve than the floor. No logged effort never blocks.
  const effort = phase.success.effort === 'ignore' || !p.parameters.rir || a.rir == null || a.rir >= p.parameters.rir.min
  const hit = minimumHit(p, phase, a)
  const success = hit && effort
  const range = p.parameters.durationSeconds || p.parameters.reps
  const reached = targetActual(p, a)
  return { hit, success, maximum: success && reached != null && reached >= range.max }
}

const PASSES = {
  target_load: (p, a) => {
    const target = p.target.resolved?.value
    const load = a.load?.value ?? p.parameters.load.resolved?.value
    return target != null && load != null && (p.assisted ? load <= target : load >= target)
  },
  max_sets: (p, a) => a.sets >= p.parameters.sets.max,
  max_reps: (p, a) => { const v = targetActual(p, a); return v != null && v >= (p.parameters.durationSeconds || p.parameters.reps).max },
  max_duration: (p, a, next, c) => a.durationSeconds != null && a.durationSeconds >= (c.target ?? p.parameters.durationSeconds.max),
  cycle_count: (p, a, next, c) => next.cyclesCompleted >= c.target,
  training_max: (p, a, next, c) => (next.values.trainingMax?.value ?? -Infinity) >= c.target,
  difficulty_rung: p => { const op = operatorFor(phaseOf(p), 'difficulty'); return !!op && p.values.difficulty === op.max },
  rest_floor: (p, a, next, c, v) => v.success && p.parameters.restSeconds <= c.target
}

/**
 * The operator chain: each operator in declared order moves its value by one step when its
 * condition holds; one that is already at its bound carries to the next. The first one that moves
 * ends the chain, and the operators it carried past start over when they ask to (resetOnCarry).
 */
function runOperators(phase, p, log, v, values, { loads = true } = {}) {
  const a = log.actual
  const passes = when => when === 'worked' || (when === 'success' ? v.success : v.maximum)
  const stride = metric => (metric === 'reps' && p.perSide ? 2 : 1)
  const carried = []
  for (const op of phase.progression) {
    if (!passes(op.when) || (op.metric === 'load' && !loads)) break
    // A timed phase logs seconds: a reps step has nothing to read there, so it carries.
    if (op.metric === 'reps' && phase.parameters.durationSeconds) { carried.push(op); continue }
    if (op.metric === 'reps' && op.addedSetOnly) {
      const aims = p.rows.map(row => row.reps.min)
      const baseSets = phase.parameters.sets.min
      const active = aims.length > baseSets ? aims.length - 1 : null
      const top = phase.parameters.reps.max, bottom = phase.parameters.reps.min
      const got = active == null || !log.performance ? lowOf(p, a) : (log.performance?.sets || []).filter(r => r.status === 'completed' && r.role !== 'warmup' && r.setId === 'r' + active).reduce((n, row) => n + (row.observations?.find(o => o.metric === 'repetitions')?.value || 0), 0)
      if (v.success && got >= top) {
        carried.push(op)
        if (aims.length < phase.parameters.sets.max) {
          values.rowReps = [...aims.map(() => top), bottom]; values.sets = aims.length + 1; values.reps = aims[0]
          break
        }
        values.rowReps = null
        continue
      }
      const aim = Math.min(top, Math.max(bottom, Math.floor(got) + stride('reps')))
      values.rowReps = aims.map((r, i) => active == null || i === active ? aim : r)
      values.reps = values.rowReps[0]
      break
    }
    if (op.metric === 'load') {
      let expression = values.load
      // v1 readSession.weight: the next load is built from what was lifted, not from what was prescribed.
      const lifted = op.basis === 'last_actual' ? bestLoad(log, p.assisted) : null
      if (expression.mode === 'absolute' && lifted > 0) expression = { ...expression, value: lifted }
      const double = op.amrapDoubleAt && v.success && a.amrapReps >= op.amrapDoubleAt * phase.parameters.reps.min ? 2 : 1
      const allowed = p.ruleSnapshot.rounding.mode === 'allowed_values' ? p.ruleSnapshot.rounding.allowedValues.filter(x => p.assisted ? x < expression.value : x > expression.value).sort((a, b) => p.assisted ? b - a : a - b) : null
      values.load = allowed && expression.mode === 'absolute' ? { ...expression, value: allowed[Math.min(double, allowed.length) - 1] ?? expression.value } : applyIncrement(expression, { ...op.step, value: op.step.value * double }, { snapshot1RM: p.snapshot1RM, resolvedTarget: p.target.resolved?.value ?? null, assisted: p.assisted, grid: op.step.value })
    } else if (op.metric === 'durationSeconds') {
      values.durationSeconds = { min: values.durationSeconds.min + op.step, max: values.durationSeconds.max + op.step }
    } else {
      const bounds = { reps: phase.parameters.reps, sets: phase.parameters.sets }[op.metric] ?? {}
      const lo = op.min ?? bounds.min ?? 0, hi = op.max ?? bounds.max ?? Infinity
      const down = op.direction === 'down'
      const actual = op.metric === 'reps' ? lowOf(p, a) : op.metric === 'sets' ? a.sets : null
      const base = op.basis === 'last_actual' && actual != null ? Math.floor(actual) : values[op.metric] ?? startOf(phase, op)
      // A climb resumed below the range (a ladder re-entered at the reps a loaded session asked for,
      // v1 `last.goal`) goes on one step at a time; only what was done is held to the range.
      const floor = op.basis === 'last_actual' || down ? lo : Math.min(lo, base)
      const clamp = x => Math.min(hi, Math.max(floor, x))
      if (down ? base <= lo : base >= hi) { values[op.metric] = clamp(base); carried.push(op); continue }
      values[op.metric] = clamp(base + (down ? -1 : 1) * op.step * stride(op.metric))
    }
    // Back to the start of the range: null, read against the plan the next session is built from.
    for (const c of carried) if (c.resetOnCarry) values[c.metric] = null
    break
  }
  return values
}

/** The back-off a stalled run earned (deload.js), applied to the values; null when the phase has none to give. */
function backOff(phase, p, log, values, stalls) {
  const { method, factor } = phase.stall.recovery
  const loadOp = operatorFor(phase, 'load')
  if (operatorFor(phase, 'durationSeconds')) {
    const step = operatorFor(phase, 'durationSeconds').step
    const start = phase.parameters.durationSeconds.min
    const position = Math.round((values.durationSeconds.min - start) / (step || 1))
    const back = deloadedPosition({ startSeconds: start, step, position, factor })
    if (back >= position) return null
    const at = pos => start + step * pos
    values.durationSeconds = { min: phase.parameters.durationSeconds.min + step * back, max: phase.parameters.durationSeconds.max + step * back }
    return { stalls, from: at(position), to: at(back), method: 'seconds' }
  }
  const e = values.load
  if (e.mode === 'absolute') {
    // v1 backed off from what was lifted, toward the 1RM of what was prescribed.
    const out = deloadedLoad({
      method, rounding: p.ruleSnapshot.rounding, factor, prescribed: p.parameters.load.expression.value ?? e.value, lifted: bestLoad(log, p.assisted), reps: p.values?.reps ?? p.prefill?.reps ?? null,
      repsMin: phase.parameters.reps.min, perSide: !!p.perSide, restPause: !!p.restPause, bodyweight: !!p.bodyweight, assisted: p.assisted,
      step: loadOp.step.type === 'absolute' ? loadOp.step.value : null
    })
    values.load = { ...e, value: out.value }
    return { stalls, from: e.value, to: out.value, method: out.method, ...(out.reps != null ? { reps: out.reps } : {}) }
  }
  if (e.mode === 'percent_1rm' && !p.assisted) {
    const percent = deloadPercent(e.percent, factor)
    values.load = { ...e, percent }
    return { stalls, from: e.percent, to: percent, method: 'factor' }
  }
  return null
}

/** @param {{ state: Object|null, prescription: Object, log: { id: string, actual: Object, performance?: Object }, now: string }} input */
export function advanceProgression({ state, prescription: p, log, now }) {
  // The same finish twice (a retried save, a duplicated sync) earns nothing twice.
  if (state && state.lastCompletedLogId === log.id) return state
  // A session built from another plan (its sets, reps or phases were edited) starts the track over:
  // live and replayed history restart at the same log. An unstamped plan never restarts.
  const restart = !!state?.planFingerprint && !!p.planFingerprint && state.planFingerprint !== p.planFingerprint
  const base = state && !restart ? state : initialProgressionState(p.trackId)
  const next = { ...base, planRuleRevision: p.planRuleRevision, planFingerprint: p.planFingerprint ?? null, lastPrescriptionId: p.id, lastCompletedLogId: log.id, lastActual: log.actual }
  // Completed freezes automation only — the log above is still recorded. An edited rule reopens.
  if (base.status === 'completed' && base.planRuleRevision === p.planRuleRevision) return { ...next, values: valuesOfPrescription(p), deload: null }
  Object.assign(next, { status: 'active', terminalTarget: null, completedAt: null, deload: null })

  const program = p.ruleSnapshot.program
  const phase = phaseOf(p)
  const a = log.actual
  // 1. The session, judged against its own frozen rows.
  const v = verdictOf(p, a)
  const samePhase = base.phaseId === p.phaseId
  Object.assign(next, {
    phaseId: p.phaseId,
    phaseExposures: (samePhase ? base.phaseExposures : 0) + 1,
    phaseSuccesses: (samePhase ? base.phaseSuccesses : 0) + (v.success ? 1 : 0)
  })
  if (!samePhase) Object.assign(next, { stalls: 0, stallAt: null, stallBest: null })

  // 2. Whether it ends its phase — and the program's cycle, whose count and training max the
  // completion conditions read as they will stand once the cycle closes.
  const exit = phase.exit
  const reached = !!exit && (
    exit.type === 'exposures' ? next.phaseExposures >= exit.count
      : exit.type === 'successes' ? next.phaseSuccesses >= exit.count
        : exit.type === 'goal' ? v.success && ({ reps: a.reps, sets: a.sets, durationSeconds: a.durationSeconds }[exit.metric] ?? -Infinity) >= exit.target
          : exit.type === 'load_present' ? bestLoad(log, p.assisted) > 0 : !(bestLoad(log, p.assisted) > 0))
  const index = program.phases.indexOf(phase)
  const following = !reached ? null : exit.to ? phaseById(program, exit.to) : program.phases[index + 1] ?? null
  const boundary = reached && !following && program.end === 'repeat'
  let values = valuesOfPrescription(p)
  // v1 held a session at the weight it was lifted at (readSession.weight), and stepped or backed off
  // from there: the next load starts from what was done, not from what was prescribed.
  const held = operatorFor(phase, 'load')?.basis === 'last_actual' && values.load.mode === 'absolute' ? bestLoad(log, p.assisted) : null
  if (held > 0) values.load = { ...values.load, value: held }
  if (boundary) {
    next.cyclesCompleted = base.cyclesCompleted + 1
    // A cycle boundary: the training max grows once and the program starts over.
    if (p.trainingMax && program.cycleIncrement) values.trainingMax = { value: roundLoad(p.trainingMax.value + program.cycleIncrement.value, p.ruleSnapshot.rounding), unit: p.trainingMax.unit }
  }

  // 3. Terminal conditions: the flat AND of the completion list, or the last phase of a program
  // that ends there. A completing session earns no load step and no back-off.
  const completes = (reached && !following && program.end === 'complete')
    || (program.completion.length > 0 && program.completion.every(c => PASSES[c.metric](p, a, { ...next, values }, c, v)))

  // 4. A stall back-off, or the program's operators. A stall is a session short of even the
  // minimum prescribed (v1's "not ok"), counted where the phase steps load or seconds: a clean
  // session ends the run, and so does a change of the weight lifted (v1 stallCount) — the lighter
  // weight after a back-off is not judged by the misses that earned it. A hold's weight never
  // changes, so its run goes on past a back-off of its seconds, as v1's did.
  // A loaded lift logged with no weight (a quick-added exercise starts at 0): there is nothing to
  // progress from, so v1 held and asked for the weight. No step is earned and no miss is counted.
  const unweighted = unweightedLog(p, log)
  if (unweighted) Object.assign(next, { stalls: 0, stallAt: null, stallBest: null })
  let deload = null
  if (!unweighted && (operatorFor(phase, 'load') || operatorFor(phase, 'durationSeconds'))) {
    const missed = !v.hit
    const at = bestLoad(log, p.assisted) ?? p.parameters.load.resolved?.value ?? 0
    const added = operatorFor(phase, 'reps')?.addedSetOnly && p.rows.length > phase.parameters.sets.min
    const got = p.parameters.durationSeconds ? a.durationSeconds : added ? (log.performance?.sets || []).filter(r => r.status === 'completed' && r.role !== 'warmup' && r.setId === 'r' + (p.rows.length - 1)).reduce((n, row) => n + (row.observations?.find(o => o.metric === 'repetitions')?.value || 0), 0) : lowOf(p, a)
    // v1 stallCount: `stallAt` is the weight of the last session and `stallBest` the best any session
    // at that weight managed, clean ones included; a new weight starts both over.
    const sameWeight = next.stallAt === at
    // (!93) Beating the best of every earlier session at one weight is progress: the run starts over.
    const improved = phase.stall?.count === 'misses_without_improvement' && sameWeight && got != null && next.stallBest != null && got > next.stallBest
    next.stalls = !missed || improved ? 0 : sameWeight ? next.stalls + 1 : 1
    next.stallAt = at
    next.stallBest = sameWeight && next.stallBest != null ? Math.max(next.stallBest, got ?? -Infinity) : got ?? null
    if (missed && !completes && phase.stall && next.stalls >= phase.stall.after) deload = backOff(phase, p, log, values, next.stalls)
  }
  if (deload) {
    next.deload = deload
    // The back-off session opens a rep window from the bottom, or at the reps a load trade chose.
    if (operatorFor(phase, 'reps')) values.reps = null
    if (operatorFor(phase, 'reps')?.addedSetOnly) { values.sets = phase.parameters.sets.min; values.rowReps = null }
  } else if (unweighted) {
    // v1 asked for the weight: the plan's own (0 when it has none), at the plan's reps — a double's top.
    values.load = { ...phase.parameters.load }
    if (operatorFor(phase, 'reps')) values.reps = operatorFor(phase, 'reps').basis === 'last_actual' ? phase.parameters.reps.max : null
  } else {
    values = runOperators(phase, p, log, v, values, { loads: !completes })
  }

  // 5. The next phase is entered with its own values. A regime exit (bodyweight ↔ loaded) also
  // lets the session count for the regime it led to, as v1 did.
  const to = following ?? (boundary ? program.phases[0] : null)
  if (to) {
    values = entryValues(to, values, { load: bestLoadOf(log, p.assisted, p.parameters.load.resolved?.unit), reps: a.reps, previous: p.values?.reps ?? p.prefill?.reps })
    Object.assign(next, { phaseId: to.id, phaseExposures: 0, phaseSuccesses: 0, stalls: 0, stallAt: null, stallBest: null, deload: null })
    if (exit.type === 'load_present' || exit.type === 'load_absent') {
      const entered = { ...p, parameters: { ...p.parameters, sets: to.parameters.sets, reps: to.parameters.reps } }
      values = runOperators(to, entered, log, verdictIn(to, a, v), values, { loads: !completes })
    }
  }
  next.values = values
  if (completes) Object.assign(next, { status: 'completed', terminalTarget: p.target.resolved ? { ...p.target.resolved } : null, completedAt: now, deload: null })
  return next
}

// A session read against the regime it leads into: success as judged, the top of the new phase's range.
function verdictIn(phase, a, v) {
  return { ...v, maximum: v.success && a.reps != null && a.reps >= phase.parameters.reps.max }
}
