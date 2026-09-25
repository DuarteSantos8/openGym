// One PlanRule plus its track's history in; one frozen Prescription out. Pure: the caller
// supplies ids, the clock, the track state, the newest log and the current 1RM. Every input a
// later reader needs to explain the numbers is copied in, so nothing is ever re-derived from a
// live rule or a live 1RM (spec "Prescription generation").
import { canonicalJSON, contentHash, deepFreeze } from './canonical.js'
import { applyIncrement, resolveLoad, roundLoad } from './load.js'
import { INCREMENTING_GATES, PRESETS, needsOneRm, validatePlanRule } from './rules.js'
import { planWarmupRows } from './warmup.js'

const copy = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
const same = (a, b) => canonicalJSON(a ?? null) === canonicalJSON(b ?? null)
// Presets whose rows carry their own loads: a single prefilled load would flatten them.
const PER_ROW_LOADS = ['pyramid', 'reverse_pyramid', 'five_three_one']

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
 */
export function generatePrescription({ id, now, trackId, rule, state = null, lastPrescription = null, lastLog = null, oneRm = null, warmup = null, equipment = null }) {
  const check = validatePlanRule(rule)
  if (!check.ok) throw new Error(`invalid plan rule ${rule?.id}: ${check.errors.join('; ')}`)
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
  let expression = carry ? copy(lastPrescription.parameters.load.expression) : copy(p.load)
  if (increments) expression = applyIncrement(expression, rule.increment, { snapshot1RM, resolvedTarget: target.resolved?.value ?? null })
  const resolve = e => resolveLoad(e, { snapshot1RM, rounding: rule.rounding, cap: target.resolved?.value ?? null })
  const load = { expression, resolved: resolve(expression) }
  // A load range's high end: only presets without automated load steps allow one, so it is
  // always the rule's own expression.
  const loadTo = p.loadTo ? { expression: copy(p.loadTo), resolved: resolve(p.loadTo) } : null

  const position = state?.position ?? 0
  // hold_seconds: the declared window slides up by the increment for every step earned.
  const duration = p.durationSeconds && rule.increment.type === 'seconds'
    ? { min: p.durationSeconds.min + rule.increment.value * position, max: p.durationSeconds.max + rule.increment.value * position }
    : p.durationSeconds
  const tmCarry = !!lastPrescription && same(lastPrescription.special.trainingMax, rule.special.trainingMax)
  const trainingMax = rule.preset !== 'five_three_one' ? null
    : tmCarry && state?.trainingMax ? copy(state.trainingMax) : trainingMaxFor(rule, snapshot1RM)

  // The prefill is the last raw actual, unless the plan just moved (an increment, a new rung or
  // week, a new start) — then the athlete starts from the range minima.
  const fresh = !lastLog || !carry || increments || lastPrescription.position !== position
  const last = lastLog?.actual || {}
  const prefill = {
    sets: fresh ? p.sets.min : (last.sets || p.sets.min),
    reps: fresh ? p.reps.min : (last.reps ?? p.reps.min),
    ...(duration ? { durationSeconds: fresh ? duration.min : (last.durationSeconds ?? duration.min) } : {}),
    ...(!fresh && last.rir != null ? { rir: last.rir } : {}),
    load: !fresh && !PER_ROW_LOADS.includes(rule.preset) && last.load ? copy(last.load) : null
  }

  const rows = rowsFor(rule, { load: load.resolved, loadTo, trainingMax, position, count: p.sets.min })
  // A timed hold logs seconds, not reps: a rep ramp in front of it has nothing to count.
  const warmupRows = duration ? [] : planWarmupRows({ rows, warmup, eq: equipment, rounding: rule.rounding })

  const body = {
    id, generatedAt: now, planRuleId: rule.id, planRuleRevision: rule.revision,
    exerciseId: rule.exerciseId, trackId, preset: rule.preset,
    statusAtGeneration: status,
    snapshot1RM,
    parameters: {
      sets: copy(p.sets), reps: copy(p.reps),
      ...(duration ? { durationSeconds: copy(duration) } : {}),
      load,
      ...(loadTo ? { loadTo } : {}),
      ...(p.rir ? { rir: copy(p.rir) } : {}),
      restSeconds: p.restSeconds
    },
    target,
    basis: copy(p.load),
    increment: copy(rule.increment), completion: copy(rule.completion), rounding: copy(rule.rounding), special: copy(rule.special),
    position, trainingMax,
    rows,
    ...(warmupRows.length ? { warmupRows } : {}),
    prefill,
    provenance: { derivedFromOutOfPlan: !!lastLog?.audit?.some(f => f.code !== 'completed_track'), sourceLogId: lastLog?.id ?? null }
  }
  return deepFreeze({ ...body, contentHash: contentHash(body) })
}

/** The rule a prescription was generated from — for an active-session entry with no saved occurrence. */
export function ruleOfPrescription(prescription, routineId = null) {
  const { sets, reps, durationSeconds, loadTo, rir, restSeconds } = prescription.parameters
  // A hold_seconds window is stored already slid; the rule declares where it started.
  const slide = prescription.increment.type === 'seconds' ? prescription.increment.value * prescription.position : 0
  return copy({
    id: prescription.planRuleId, revision: prescription.planRuleRevision, routineId,
    exerciseId: prescription.exerciseId, preset: prescription.preset,
    parameters: { sets, reps, ...(durationSeconds ? { durationSeconds: { min: durationSeconds.min - slide, max: durationSeconds.max - slide } } : {}), load: prescription.basis, ...(loadTo ? { loadTo: loadTo.expression } : {}), ...(rir ? { rir } : {}), restSeconds },
    target: prescription.target.expression || { mode: 'none' },
    increment: prescription.increment, completion: prescription.completion, rounding: prescription.rounding, special: prescription.special
  })
}
