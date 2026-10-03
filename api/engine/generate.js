// One PlanRule plus its track's history in; one frozen Prescription out. Pure: the caller
// supplies ids, the clock, the track state, the newest log and the current 1RM. Every input a
// later reader needs to explain the numbers is copied in, so nothing is ever re-derived from a
// live rule or a live 1RM.
import { canonicalJSON, contentHash, deepFreeze } from './canonical.js'
import { applyIncrement, resolveLoad, roundLoad } from './load.js'
import { deloadPercent, deloadedLoad, deloadedPosition } from './deload.js'
import { DELOAD_GATES, INCREMENTING_GATES, PRESETS, needsOneRm, validatePlanRule } from './rules.js'
import { planWarmupRows } from './warmup.js'
import { bestLoad, planFingerprint } from './context.js'
import { unweightedLog } from './advance.js'

const copy = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
const same = (a, b) => canonicalJSON(a ?? null) === canonicalJSON(b ?? null)
// Presets whose rows carry their own loads: a single prefilled load would flatten them.
const PER_ROW_LOADS = ['pyramid', 'reverse_pyramid', 'five_three_one']

// Presets that climb sets or reps from what was managed: they own them over the plan.
const CLIMBING_GATES = ['max_reps', 'max_sets_reps', 'rung']

function trainingMaxFor(rule, snapshot1RM) {
  const tm = rule.special.trainingMax
  if (tm.mode === 'direct') return { value: tm.value, unit: tm.unit }
  return snapshot1RM ? { value: roundLoad(snapshot1RM.value * 0.9, rule.rounding), unit: snapshot1RM.unit } : null
}

function rowsFor(rule, { load, loadTo, trainingMax, position, count }) {
  const percentOf = (base, percent) => (base ? { value: roundLoad(base.value * percent / 100, rule.rounding), unit: base.unit } : null)
  const reps = rule.parameters.reps
  if (rule.preset === 'pyramid' || rule.preset === 'reverse_pyramid') {
    return rule.special.offsets.map(o => ({
      reps: o.reps ? { min: o.reps, max: o.reps } : copy(reps), load: percentOf(load, o.percentOfAnchor), ...(o.percentOfAnchor === 100 ? { anchor: true } : {})
    }))
  }
  if (rule.preset === 'five_three_one') {
    const week = rule.special.cycleSets[position % rule.special.cycleSets.length]
    return week.map(s => ({ reps: { min: s.reps, max: s.reps }, load: percentOf(trainingMax, s.percentOfTM), ...(s.amrap ? { amrap: true } : {}) }))
  }
  return Array.from({ length: count }, (_, i) => ({
    reps: copy(reps), load: copy(load), ...(loadTo ? { loadTo: copy(loadTo.resolved) } : {}), ...(rule.preset === 'greyskull' && i === count - 1 ? { amrap: true } : {})
  }))
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
 * @param {boolean} [input.perSide]              unilateral work: a deload counts reps per limb
 * @param {boolean} [input.restPause]            rest-pause rows: a deload takes the plain factor, not a rep trade
 * @param {boolean} [input.assisted]             an assistance machine: the load is the help given, so every automated step runs the other way (issue #232)
 */
export function generatePrescription({ id, now, trackId, rule, state = null, lastPrescription = null, lastLog = null, oneRm = null, warmup = null, equipment = null, reset = null, heldLoad = null, startFrom = 'plan', fingerprint, perSide = false, restPause = false, restPauseReps = null, assisted = undefined }) {
  // A log keeps reps as typed (5.5 from a hand-edited or imported record); a plan only deals in whole ones.
  if (Number.isFinite(lastLog?.actual?.reps) && !Number.isInteger(lastLog.actual.reps)) lastLog = { ...lastLog, actual: { ...lastLog.actual, reps: Math.floor(lastLog.actual.reps) } }
  // Migrated unloaded work climbs repetitions; adding load restores its original policy.
  const declaredLoad = rule.parameters.load.mode === 'absolute' ? rule.parameters.load.value : 0
  const loadEdited = !!lastPrescription && !same(lastPrescription.basis, rule.parameters.load)
  const effectiveLoad = loadEdited ? declaredLoad : lastLog?.actual?.load?.value ?? declaredLoad
  const loadTransition = rule.preset === 'bodyweight_ladder' && rule.special.loadedPreset && effectiveLoad > 0
  const unloadedTransition = rule.special.unloadedLadder && rule.preset !== 'bodyweight_ladder' && effectiveLoad === 0
  if ((loadTransition || unloadedTransition) && fingerprint === undefined) fingerprint = planFingerprint(rule)
  if (loadTransition) {
    const preset = rule.special.loadedPreset
    rule = { ...rule, preset, parameters: { ...rule.parameters, sets: { min: rule.parameters.sets.min, max: rule.parameters.sets.min }, reps: preset === 'double' ? rule.special.loadedReps ?? rule.parameters.reps : { min: lastLog?.actual?.reps ?? rule.parameters.reps.min, max: lastLog?.actual?.reps ?? rule.parameters.reps.min }, load: { mode: 'absolute', value: effectiveLoad, unit: lastLog?.actual?.load?.unit ?? rule.increment.unit } }, completion: [], target: { mode: 'none' } }
    if (lastPrescription) lastPrescription = { ...lastPrescription, basis: rule.parameters.load, parameters: { ...lastPrescription.parameters, load: { expression: rule.parameters.load } } }
    if (state) state = { ...state, readyToIncrement: !!state.clean && lastLog?.actual?.load?.value === effectiveLoad && (preset !== 'double' || lastLog?.actual?.reps >= rule.parameters.reps.max) }
  } else if (unloadedTransition) {
    rule = { ...rule, preset: 'bodyweight_ladder', parameters: { ...rule.parameters, sets: { min: rule.parameters.sets.min, max: Math.max(rule.parameters.sets.min, 6) }, reps: { min: rule.parameters.reps.min, max: Math.max(rule.parameters.reps.min, rule.special.repCeiling ?? 20) }, load: { mode: 'empty' } }, special: { ...rule.special, rungs: [], loadedPreset: rule.preset }, completion: [], target: { mode: 'none' } }
    delete rule.deload
    if (lastPrescription) lastPrescription = { ...lastPrescription, basis: rule.parameters.load }
    if (state) state = { ...state, readyToIncrement: false }
  }
  const check = validatePlanRule(rule)
  if (!check.ok) throw new Error(`invalid plan rule ${rule?.id}: ${check.errors.join('; ')}`)
  // A restarted plan is a fresh track: no earned step, no rung or week, no completed status.
  if (reset) state = null
  const p = rule.parameters
  // An edited rule (a new revision) reopens a completed track; nothing else does.
  const reopened = state?.status === 'completed' && state.planRuleRevision !== rule.revision
  const status = state && !reopened ? state.status : 'active'
  const snapshot1RM = needsOneRm(rule) && oneRm ? copy(oneRm) : null
  // Progress carries across revisions unless the planner changed the declared start or the
  // increment basis — then the new declaration is the new start.
  const carry = !!lastPrescription && same(lastPrescription.basis, p.load) && lastPrescription.increment.type === rule.increment.type

  const targetExpression = rule.target.mode === 'none' ? null : copy(rule.target)
  const target = status === 'completed'
    ? { expression: targetExpression, resolved: copy(state.terminalTarget) }
    : { expression: targetExpression, resolved: targetExpression ? resolveLoad(targetExpression, { snapshot1RM, rounding: rule.rounding }) : null }

  const increments = status === 'active' && carry && !!state?.readyToIncrement && INCREMENTING_GATES.includes(PRESETS[rule.preset].gate)
  // On a reset the weight holds at what was last lifted, unless the edit changed the plan's own
  // load too — then the new plan's load is where it opens (v1.3.9 #275).
  const hold = !!reset && !!heldLoad && p.load.mode === 'absolute' && (!lastPrescription || same(lastPrescription.basis, p.load))
  let expression = hold ? { mode: 'absolute', value: heldLoad.value, unit: heldLoad.unit }
    : (!reset && carry) ? copy(lastPrescription.parameters.load.expression) : copy(p.load)
  if (increments) {
    // v1 readSession.weight: the next load is built from what was lifted, not from what was prescribed.
    const lifted = bestLoad(lastLog, assisted)
    if (expression.mode === 'absolute' && lifted > 0) expression = { ...expression, value: lifted }
    expression = applyIncrement(expression, { ...rule.increment, value: rule.increment.value * (state?.incrementMultiplier ?? 1) }, { snapshot1RM, resolvedTarget: target.resolved?.value ?? null, assisted })
  }

  // A stalled track backs off (v1 deload, deload.js): the load for a loaded preset, the sliding
  // window for a timed hold. Only a carried track can — a restart already holds what was lifted.
  const gate = PRESETS[rule.preset].gate
  const backsOff = status === 'active' && !reset && carry && !increments && !!state?.readyToDeload && !!rule.deload && DELOAD_GATES.includes(gate)
  let deload = null
  if (backsOff && gate !== 'seconds' && expression.mode === 'absolute') {
    const out = deloadedLoad({
      preset: rule.preset, rounding: rule.rounding, factor: rule.deload.factor, prescribed: expression.value,
      lifted: lastLog?.actual?.load?.value ?? null, reps: lastPrescription.prefill?.reps ?? null, repsMin: p.reps.min, perSide, restPause,
      assisted, step: rule.increment.type === 'absolute' ? rule.increment.value : null
    })
    deload = { stalls: state.stalls, from: expression.value, to: out.value, method: out.method, ...(out.reps != null ? { reps: out.reps } : {}) }
    expression = { ...expression, value: out.value }
  } else if (backsOff && gate !== 'seconds' && expression.mode === 'percent_1rm' && !assisted) {
    const percent = deloadPercent(expression.percent, rule.deload.factor)
    deload = { stalls: state.stalls, from: expression.percent, to: percent, method: 'factor' }
    expression = { ...expression, percent }
  }
  const resolve = e => resolveLoad(e, { snapshot1RM, rounding: rule.rounding, cap: target.resolved?.value ?? null, assisted })
  const load = { expression, resolved: resolve(expression) }
  // A load range's high end: only presets without automated load steps allow one, so it is
  // always the rule's own expression.
  const loadTo = p.loadTo ? { expression: copy(p.loadTo), resolved: resolve(p.loadTo) } : null

  const durationOrigin = carry && (!lastPrescription.planFingerprint || lastPrescription.planFingerprint === (fingerprint === undefined ? planFingerprint(rule) : fingerprint)) && lastPrescription.parameters.durationSeconds && rule.increment.type === 'seconds'
    ? { min: lastPrescription.parameters.durationSeconds.min - rule.increment.value * lastPrescription.position, max: lastPrescription.parameters.durationSeconds.max - rule.increment.value * lastPrescription.position } : p.durationSeconds
  let position = state?.position ?? 0
  if (backsOff && gate === 'seconds' && p.durationSeconds && rule.increment.type === 'seconds') {
    const back = deloadedPosition({ startSeconds: durationOrigin.min, step: rule.increment.value, position, factor: rule.deload.factor })
    if (back < position) {
      const at = pos => durationOrigin.min + rule.increment.value * pos
      deload = { stalls: state.stalls, from: at(position), to: at(back), method: 'seconds' }
      position = back
    }
  }
  // hold_seconds: the declared window slides up by the increment for every step earned.

  const duration = p.durationSeconds && rule.increment.type === 'seconds'
    ? { min: durationOrigin.min + rule.increment.value * position, max: durationOrigin.max + rule.increment.value * position }
    : p.durationSeconds
  const tmCarry = !!lastPrescription && same(lastPrescription.special.trainingMax, rule.special.trainingMax)
  const trainingMax = rule.preset !== 'five_three_one' ? null
    : tmCarry && state?.trainingMax ? copy(state.trainingMax) : trainingMaxFor(rule, snapshot1RM)

  // The last session of a loaded lift carried no weight: v1 held the plan (rows open as planned, no rep climb).
  const unweighted = !!lastLog && !reset && !!lastPrescription && unweightedLog({ preset: rule.preset, assisted, parameters: lastPrescription.parameters }, lastLog.actual)
  const fresh = !!reset || !lastLog || !carry || increments || !!deload || lastPrescription.position !== position || unweighted
  // The plan owns sets, reps and a hold's seconds (v1.3.9), unless the athlete chose their last
  // session or the preset climbs them. History decides the weight.
  const fromLast = !fresh && (startFrom === 'last' || CLIMBING_GATES.includes(PRESETS[rule.preset].gate))
  const last = lastLog?.actual || {}
  const unnamedLadder = rule.preset === 'bodyweight_ladder' && !rule.special.rungs?.length
  // A double climbs from its last result after any session (v1: low + 1); a ladder only after a clean one.
  const climb = !reset && carry && !deload && !increments && !unweighted && !!state && (rule.preset === 'double' || (unnamedLadder && state.clean))
  let climbedReps = Math.max(p.reps.min, Math.min(p.reps.max, (last.reps ?? p.reps.min) + (perSide ? 2 : 1)))
  let climbedSets = Math.min(p.sets.max, last.sets || p.sets.min)
  if (climb && unnamedLadder && last.reps >= p.reps.max && climbedSets < p.sets.max) { climbedSets++; climbedReps = p.reps.min }
  // An unclean ladder session asks for the same thing again (v1 `reached`): sets and reps are what was
  // prescribed, not the weakest set that was managed. The athlete's own `startFrom: 'last'` still wins.
  const asked = rule.preset === 'bodyweight_ladder' && fromLast && !climb && startFrom !== 'last' ? lastPrescription?.prefill : null
  const prefill = {
    sets: climb ? climbedSets : asked?.sets ?? (fromLast ? (last.sets || p.sets.min) : p.sets.min),
    // A deload under a rep window may trade reps for load (deload.js): those reps open the session.
    // v1 held a double's plan reps (its top) while the weight was missing, rather than starting the range over.
    reps: climb ? climbedReps : deload?.reps ?? asked?.reps ?? (unweighted && rule.preset === 'double' ? p.reps.max : fromLast ? (last.reps ?? p.reps.min) : p.reps.min),
    ...(duration ? { durationSeconds: fromLast ? (last.durationSeconds ?? duration.min) : duration.min } : {}),
    ...(p.speed ? { speed: fromLast ? (last.speed ?? p.speed) : p.speed } : {}),
    ...(!fresh && last.rir != null ? { rir: last.rir } : {}),
    load: !fresh && !PER_ROW_LOADS.includes(rule.preset) && last.load ? copy(last.load) : null
  }
  // Rows open at last session's reps rather than the plan's: the workout card says so.
  if (startFrom === 'last' && fromLast && prefill.reps !== p.reps.min) prefill.carried = true

  if (restPause) { prefill.sets = 1; prefill.reps = restPauseReps ?? prefill.reps }
  const rows = rowsFor(rule, { load: load.resolved, loadTo, trainingMax, position, count: unnamedLadder ? prefill.sets : restPause ? 1 : p.sets.min })
  if (restPause) rows.forEach(row => { row.reps = { min: prefill.reps, max: prefill.reps } })
  if (climb) rows.forEach(row => { row.reps = { min: prefill.reps, max: p.reps.max } })
  // A timed hold logs seconds, not reps: a rep ramp in front of it has nothing to count.
  const warmupRows = duration ? [] : planWarmupRows({ rows, warmup, eq: equipment, rounding: rule.rounding })

  const body = {
    id, generatedAt: now, planRuleId: rule.id, planRuleRevision: rule.revision,
    planFingerprint: fingerprint === undefined ? planFingerprint(rule) : fingerprint,
    exerciseId: rule.exerciseId, trackId, preset: rule.preset,
    // Frozen with the prescription: finishing it (advance.js, audit.js) reads the load the same way.
    ...(typeof assisted === 'boolean' ? { assisted } : {}),
    statusAtGeneration: status,
    snapshot1RM,
    parameters: {
      sets: restPause ? { min: 1, max: 1 } : copy(p.sets), reps: restPause ? { min: prefill.reps, max: prefill.reps } : copy(p.reps),
      ...(duration ? { durationSeconds: copy(duration) } : {}),
      ...(p.speed ? { speed: p.speed } : {}),
      load,
      ...(loadTo ? { loadTo } : {}),
      ...(p.rir ? { rir: copy(p.rir) } : {}),
      restSeconds: p.restSeconds
    },
    target,
    basis: copy(p.load),
    increment: copy(rule.increment), completion: copy(rule.completion), rounding: copy(rule.rounding), special: copy(rule.special),
    // Only a rule that backs off carries the setting; older prescriptions and their hashes stay as they were.
    ...(rule.deload ? { deload: copy(rule.deload) } : {}),
    position, trainingMax,
    rows,
    ...(warmupRows.length ? { warmupRows } : {}),
    prefill,
    provenance: { derivedFromOutOfPlan: !!lastLog?.audit?.some(f => f.code !== 'completed_track'), sourceLogId: lastLog?.id ?? null, ...(deload ? { deload } : {}) }
  }
  return deepFreeze({ ...body, contentHash: contentHash(body) })
}

/** The rule a prescription was generated from — for an active-session entry with no saved occurrence. */
export function ruleOfPrescription(prescription, routineId = null) {
  const { sets, reps, durationSeconds, speed, loadTo, rir, restSeconds } = prescription.parameters
  // A hold_seconds window is stored already slid; the rule declares where it started.
  const slide = prescription.increment.type === 'seconds' ? prescription.increment.value * prescription.position : 0
  let declaredDuration = null
  try { declaredDuration = JSON.parse(prescription.planFingerprint)?.durationSeconds ?? null } catch {}
  return copy({
    id: prescription.planRuleId, revision: prescription.planRuleRevision, routineId,
    exerciseId: prescription.exerciseId, preset: prescription.preset,
    parameters: { sets, reps, ...(durationSeconds ? { durationSeconds: declaredDuration ?? { min: durationSeconds.min - slide, max: durationSeconds.max - slide } } : {}), ...(speed ? { speed } : {}), load: prescription.basis, ...(loadTo ? { loadTo: loadTo.expression } : {}), ...(rir ? { rir } : {}), restSeconds },
    target: prescription.target.expression || { mode: 'none' },
    increment: prescription.increment, completion: prescription.completion, rounding: prescription.rounding, special: prescription.special,
    ...(prescription.deload ? { deload: prescription.deload } : {})
  })
}
