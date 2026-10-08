// One PlanRule plus its track's history in; one frozen Prescription out. Pure: the caller
// supplies ids, the clock, the track state, the newest log and the current 1RM. Every input a
// later reader needs to explain the numbers is copied in, so nothing is ever re-derived from a
// live rule or a live 1RM. Generation only reads the state: the values it opens at were decided
// when the last session finished (advance.js), so generating twice gives the same prescription.
import { canonicalJSON, contentHash, deepFreeze } from './canonical.js'
import { resolveLoad, roundLoad } from './load.js'
import { needsOneRm, validatePlanRule } from './rules.js'
import { planWarmupRows } from './warmup.js'
import { planFingerprint } from './context.js'
import { bestLoad, bestLoadOf, entryValues, frozenValues, initialValues, operatorFor, perRowLoads, phaseById, regimeExit, rowsFor, sameStart, unweightedLog, valueOf } from './program.js'

const copy = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
const same = (a, b) => canonicalJSON(a ?? null) === canonicalJSON(b ?? null)

function trainingMaxFor(program, snapshot1RM, rounding) {
  const tm = program.trainingMax
  if (tm.mode === 'direct') return { value: tm.value, unit: tm.unit }
  return snapshot1RM ? { value: roundLoad(snapshot1RM.value * 0.9, rounding), unit: snapshot1RM.unit } : null
}

/**
 * @param {Object} input
 * @param {string} input.id                      prescription id
 * @param {string} input.now                     ISO-8601 UTC
 * @param {string} input.trackId
 * @param {Object} input.rule                    the PlanRule; validated here
 * @param {Object|null} [input.state]            the track's ProgressionState
 * @param {Object|null} [input.lastPrescription] the prescription the newest log was made against
 * @param {Object|null} [input.lastLog]          the newest completed log on the track
 * @param {Object|null} [input.oneRm]            the current Snapshot1RM; null when absent or the prompt was cancelled
 * @param {Object|null} [input.warmup]           the occurrence's warm-up recipe; null/missing = off
 * @param {string|null} [input.equipment]        the exercise's `eq`, for the smart recipe class
 * @param {string|null} [input.reset]            'plan_changed' | 'first_in_routine' (resolveProgressionContext)
 * @param {Object|null} [input.heldLoad]         the baseline's lifted load, held on a reset
 * @param {string} [input.startFrom]             'plan' (default) | 'last': where sets and reps open
 * @param {string|null} [input.fingerprint]      the plan this log was built from; default: this rule's
 * @param {boolean} [input.perSide]              unilateral work: reps climb and deload per limb
 * @param {boolean} [input.restPause]            rest-pause rows: a deload takes the plain factor, not a rep trade
 * @param {boolean} [input.bodyweight]           bodyweight work with load added: a deload takes the plain factor (v1 isBw)
 * @param {boolean} [input.assisted]             an assistance machine: the load is the help given, so every automated step runs the other way (issue #232)
 * @param {Object|null} [input.at]               { phaseId, values }: the point of the program a session recorded elsewhere was
 *                                               prescribed at (a migrated v1 session), instead of the track's state
 */
export function generatePrescription({ id, now, trackId, rule, state = null, lastPrescription = null, lastLog = null, oneRm = null, warmup = null, equipment = null, reset = null, heldLoad = null, startFrom = 'plan', fingerprint, perSide = false, restPause = false, restPauseReps = null, bodyweight = false, assisted = undefined, at = null, backoff = false, warmupFloor = 0 }) {
  // A log keeps reps as typed (5.5 from a hand-edited or imported record); a plan only deals in whole ones.
  if (Number.isFinite(lastLog?.actual?.reps) && !Number.isInteger(lastLog.actual.reps)) lastLog = { ...lastLog, actual: { ...lastLog.actual, reps: Math.floor(lastLog.actual.reps) } }
  const check = validatePlanRule(rule)
  if (!check.ok) throw new Error(`invalid plan rule ${rule?.id}: ${check.errors.join('; ')}`)
  // A restarted plan is a fresh track: no earned step, no phase, no completed status.
  if (reset) state = null
  const program = rule.program
  // An edited rule (a new revision) reopens a completed track; nothing else does.
  const reopened = state?.status === 'completed' && state.planRuleRevision !== rule.revision
  const status = state && !reopened ? state.status : 'active'
  const snapshot1RM = needsOneRm(rule) && oneRm ? copy(oneRm) : null
  const before = lastPrescription?.ruleSnapshot ?? null
  // The values the last finish decided carry while the plan keeps its declared starts; an edited
  // start is where the track opens instead.
  const carry = !!state?.values && !!before && sameStart(before, rule)
  let phase = (carry && phaseById(program, state.phaseId)) || program.phases[0]
  let values = carry ? copy(state.values) : initialValues(phase)
  if (at) { phase = phaseById(program, at.phaseId) || phase; values = { ...initialValues(phase), ...copy(at.values) } }
  // On a reset the weight holds at what was last lifted, unless the edit changed the plan's own
  // load too — then the new plan's load is where it opens (v1.3.9 #275).
  if (reset && heldLoad && phase.parameters.load.mode === 'absolute' && (!before || sameStart(before, rule))) values.load = { mode: 'absolute', value: heldLoad.value, unit: heldLoad.unit }
  // A track that starts over opens in the regime its last load calls for (bodyweight ↔ loaded).
  if (!carry && !at) {
    const opening = bestLoad(lastLog, assisted) ?? (values.load.mode === 'absolute' ? values.load.value : 0)
    const to = regimeExit(program, phase, opening)
    if (to) { values = entryValues(to, values, { load: bestLoadOf(lastLog, assisted, values.load.unit) ?? heldLoad, reps: lastLog?.actual?.reps, previous: lastPrescription?.values?.reps ?? lastPrescription?.prefill?.reps }); phase = to }
  }
  const p = phase.parameters
  const trainingMax = !program.trainingMax ? null
    : carry && values.trainingMax && same(before.program.trainingMax, program.trainingMax) ? copy(values.trainingMax) : trainingMaxFor(program, snapshot1RM, rule.rounding)
  values.trainingMax = trainingMax

  const targetExpression = phase.target.mode === 'none' ? null : copy(phase.target)
  const target = status === 'completed'
    ? { expression: targetExpression, resolved: copy(state.terminalTarget) }
    : { expression: targetExpression, resolved: targetExpression ? resolveLoad(targetExpression, { snapshot1RM, rounding: rule.rounding }) : null }
  const resolve = e => resolveLoad(e, { snapshot1RM, rounding: rule.rounding, cap: target.resolved?.value ?? null, assisted })
  const load = { expression: copy(values.load), resolved: resolve(values.load) }
  // A load range's high end: only phases without a load step allow one, so it is the rule's own expression.
  const loadTo = p.loadTo ? { expression: copy(p.loadTo), resolved: resolve(p.loadTo) } : null
  const duration = valueOf(phase, values, 'durationSeconds')
  const rest = valueOf(phase, values, 'restSeconds')
  const deload = carry ? state.deload ?? null : null

  // The last session of a loaded lift carried no weight: v1 held the plan.
  const unweighted = !!lastLog && !reset && !!before && lastPrescription.phaseId === phase.id && unweightedLog(lastPrescription, lastLog)
  // Something the last finish moved (the load, the phase, the window, the rung) opens from the plan;
  // otherwise the rows may open at what was done last time.
  const moved = !carry || lastPrescription.phaseId !== phase.id || !same(lastPrescription.parameters.load.expression, values.load)
    || !same(lastPrescription.values.durationSeconds, duration) || (lastPrescription.values.difficulty ?? 0) !== (values.difficulty ?? 0)
  const fresh = !!reset || !lastLog || moved || unweighted
  // The plan owns sets, reps and a hold's seconds (v1.3.9), unless the phase lets the athlete climb
  // them from their last session. An operator's own value always wins.
  const fromLast = !fresh && phase.prefill === 'last'
  const last = lastLog?.actual || {}
  const owns = metric => !!operatorFor(phase, metric)
  const pinned = phase.entry?.reps === 'last_actual'
  const sets = valueOf(phase, values, 'sets')
  // A back-off that traded reps for load (deload.js) aims at those reps, and is judged by them (v1 target.reps).
  const reps = deload?.reps ?? valueOf(phase, values, 'reps')
  // The reps each work row of the last session logged, in order: where a Max set opens. A per-side
  // set is saved as a left and a right row; it is one set of both sides' reps.
  const lastWork = (lastLog?.performance?.sets || []).filter(r => r.status === 'completed' && r.role !== 'warmup')
    .map(r => ({ side: r.side, r: r.observations?.find(o => o.metric === 'repetitions')?.value }))
    .flatMap((x, i, xs) => (x.side === 'R' && xs[i - 1]?.side === 'L' ? [] : x.side === 'L' && xs[i + 1]?.side === 'R' ? [(x.r ?? 0) + (xs[i + 1].r ?? 0)] : [x.r]))
  // v1 "Planned sessions start from: your last session": a progressed exercise whose policy names
  // no reps (or asks for the weight that was missing) reopens each row at what that row did last
  // time. One that is not progressed always opens at the plan.
  const seeds = lastWork.some(r => r > 0) ? lastWork : last.reps > 0 ? [last.reps] : []   // a log with no rows has its summary
  const lastRows = startFrom === 'last' && !reset && phase.progression.length > 0 && (!owns('reps') || unweighted) && seeds.length
    ? Array.from({ length: sets }, (_, i) => { const r = seeds[i] ?? seeds.at(-1); return r > 0 ? r : reps }) : null
  const prefill = {
    sets: owns('sets') ? sets : fromLast ? (last.sets || sets) : sets,
    // A deload under a rep window may trade reps for load (deload.js): those reps open the session.
    reps: deload?.reps ?? (lastRows ? lastRows[0] : owns('reps') || pinned ? reps : fromLast ? (last.reps ?? reps) : reps),
    ...(lastRows && deload?.reps == null && lastRows.some(r => r !== lastRows[0]) ? { rowReps: lastRows } : {}),
    ...(duration ? { durationSeconds: fromLast ? (last.durationSeconds ?? duration.min) : duration.min } : {}),
    ...(p.speed ? { speed: fromLast ? (last.speed ?? p.speed) : p.speed } : {}),
    ...(!fresh && last.rir != null ? { rir: last.rir } : {}),
    // A v1 policy that steps the load is already where its last finish left it (advance.js holds
    // what was lifted). One that names no weight (a timed hold) opens at what was lifted last time;
    // a bodyweight climb at none. A phase with no progression opens at its own declared load, or at
    // what was lifted when it declares none (v1 'off'); any other at what was done last time.
    load: perRowLoads(phase) || reset || !lastLog || (p.load.mode === 'empty' && phase.progression.length) ? null
      : owns('load') ? (fresh || operatorFor(phase, 'load').basis === 'last_actual' || !last.load ? null : copy(last.load))
      : owns('durationSeconds') || !(p.load.mode === 'absolute' && p.load.value > 0) ? bestLoadOf(lastLog, assisted, values.load.unit) : null
  }
  if (duration && p.speed && lastLog?.performance?.sets?.length) {
    const observed = (row, metric) => row.observations?.find(o => o.metric === metric)?.value
    const prior = lastLog.performance.sets.filter(row => row.status === 'completed' && row.role !== 'warmup')
    if (prior.length) prefill.cardioRows = Array.from({ length: sets }, (_, i) => {
      const row = prior[i] || prior.at(-1), incline = observed(row, 'incline')
      return { min: (observed(row, 'duration') ?? duration.min) / 60, speed: observed(row, 'speed') ?? p.speed, ...(incline != null ? { incline } : {}) }
    })
  }
  // Rows open at last session's reps rather than the plan's: the workout card says so.
  if (lastRows && (prefill.rowReps || prefill.reps !== reps)) prefill.carried = true
  if (restPause) { prefill.sets = 1; prefill.reps = restPauseReps ?? prefill.reps; delete prefill.rowReps }

  const lastLoads = (lastLog?.performance?.sets || []).filter(r => r.status === 'completed' && r.role !== 'warmup' && r.side !== 'R').map(r => r.resistance?.kind === 'external-load' ? { value: r.resistance.value, unit: r.resistance.unit || values.load.unit || 'kg' } : null)
  const rows = rowsFor(phase, {
    // A rest-pause row aims at its burst total (the prefill) but is judged, as v1 did, against the plan's reps.
    sets: restPause ? 1 : sets, reps, repsMax: pinned ? reps : Math.max(reps, p.reps.max),
    anchor: load.resolved, loadTo: loadTo ? loadTo.resolved : undefined, trainingMax, rounding: rule.rounding, rest, lastWork, lastLoads
  })
  if (operatorFor(phase, 'reps')?.addedSetOnly) {
    const aims = values.rowReps || Array(sets).fill(reps)
    rows.forEach((row, i) => { row.reps = { min: aims[i] ?? reps, max: p.reps.max } })
    prefill.rowReps = rows.map(row => row.reps.min)
  }
  const backoffStep = backoff && !assisted && !duration && !restPause && !perRowLoads(phase) && phase.groups.length === 1 ? operatorFor(phase, 'load')?.step.value ?? rule.rounding.step : 0
  if (backoffStep > 0 && rows[0]?.load) {
    const top = prefill.load?.value ?? rows[0].load.value
    rows.forEach((row, i) => { row.load = { ...row.load, value: Math.max(Math.min(top, backoffStep), Number((top - i * backoffStep).toFixed(6))) } })
    prefill.load = null
  }
  // A timed hold logs seconds, not reps: a rep ramp in front of it has nothing to count.
  // The ramp lands on the load increment's grid, as v1's rerampWarmups did.
  const stepOp = operatorFor(phase, 'load')?.step
  const warmupRows = duration ? [] : planWarmupRows({ rows, warmup, eq: equipment, floor: warmupFloor, rounding: stepOp?.type === 'absolute' && rule.rounding.mode !== 'allowed_values' ? { mode: 'nearest', step: stepOp.value } : rule.rounding })

  const body = {
    id, generatedAt: now, planRuleId: rule.id, planRuleRevision: rule.revision,
    planFingerprint: fingerprint === undefined ? planFingerprint(rule) : fingerprint,
    exerciseId: rule.exerciseId, trackId, preset: rule.preset,
    // Frozen with the prescription: finishing it (advance.js, audit.js) reads the movement the same way.
    ...(typeof assisted === 'boolean' ? { assisted } : {}),
    ...(perSide ? { perSide: true } : {}),
    ...(restPause ? { restPause: true } : {}),
    ...(bodyweight ? { bodyweight: true } : {}),
    ...(backoffStep > 0 ? { backoffStep } : {}),
    statusAtGeneration: status,
    snapshot1RM,
    ruleSnapshot: copy(rule), phaseId: phase.id, values: frozenValues(phase, values, { sets, reps, durationSeconds: duration, restSeconds: rest }),
    parameters: {
      sets: restPause ? { min: 1, max: 1 } : copy(p.sets), reps: copy(p.reps),
      ...(duration ? { durationSeconds: copy(duration) } : {}),
      ...(p.speed ? { speed: p.speed } : {}),
      load,
      ...(loadTo ? { loadTo } : {}),
      ...(p.rir ? { rir: copy(p.rir) } : {}),
      restSeconds: rest
    },
    target, trainingMax,
    rows,
    ...(warmupRows.length ? { warmupRows } : {}),
    prefill,
    provenance: { derivedFromOutOfPlan: !!lastLog?.audit?.some(f => f.code !== 'completed_track'), sourceLogId: lastLog?.id ?? null, ...(deload ? { deload: copy(deload) } : {}) }
  }
  return deepFreeze({ ...body, contentHash: contentHash(body) })
}

/** The rule a prescription was generated from — for an active-session entry with no saved occurrence. */
export const ruleOfPrescription = (prescription, routineId = null) => ({ ...copy(prescription.ruleSnapshot), routineId })
