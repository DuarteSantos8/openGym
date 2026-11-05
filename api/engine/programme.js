// Programme definitions (profile `S.programmes`): a track's ordered stages compile, one bound
// occurrence at a time, into the ordinary PlanRule the engine already generates and advances from,
// and a planned slot's saved work reads back as one outcome. Pure like the rest of api/engine: the
// caller passes the routines, the run id and the prescription; nothing here reads a clock or storage.
import { canonicalJSON } from './canonical.js'
import { MAX_PHASES, defaultPlanRule, validateIntensifier, validatePlanRule } from './rules.js'
import { isValidDeloadFactor } from './deload.js'
import { validateWarmup } from './warmup.js'
import { groupIdOf, isWork, operatorFor, phaseOf } from './program.js'
import { verdictOf } from './advance.js'
import { normalizeEffort } from './audit.js'

const copy = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
const classed = (cls, keys) => keys.map(k => [k, cls])

/** What each occurrence key is (spec 5.1). A week's `options` may set execution keys only. */
export const OPTION_CLASSES = Object.fromEntries([
  ...classed('target', ['sets', 'reps', 'rule', 'restSec', 'cardio', 'excludeFromProgression']),
  ...classed('execution', ['incline', 'intensifier', 'warmup', 'warmupRestSec', 'warmupRestOff', 'failureSets', 'lastToFailure', 'backoff', 'side', 'sideRestOff',
    'sideRestSec', 'autoHold', 'restOff', 'restFromProfile', 'sg', 'sgName', 'sgRest', 'subs', 'bodyweight', 'assisted', 'mode', 'dbLoad']),
  ...classed('display', ['note', 'exerciseName'])
])

// A programme lasts at most 16 weeks or blocks, and a track has at most 16 stages.
const MAX_LENGTH = 16
const MAX_TRACKS = 50
// lib/incline.js: a grade from flat to 40 %.
const INCLINE_MAX = 40
const DURATION_UNIT = { weeks: 'weeks', rotation: 'blocks' }
const INHERIT = { own: 'inherit' }

const targetOf = (stage, oid) => stage.targets?.[oid] ?? INHERIT
/** The work stage before this one: what a new step is measured against and 'copy' reads. */
const before = (track, stage) => track.stages.slice(0, track.stages.findIndex(s => s.id === stage.id)).findLast(s => s.kind === 'work') ?? null
// A deload scales every group's load once: a share of the anchor or the training max, or its own kg/lb.
const deloaded = (l, f) => (l.basis === 'absolute' ? { ...l, value: l.value * f } : l.basis === 'anchor' || l.basis === 'training_max' ? { ...l, percent: l.percent * f } : l)
export const scalable = rule => rule.program.phases.some(ph => ph.groups.some(g => g.load.basis === 'training_max'
  || (g.load.basis === 'absolute' && g.load.value > 0) || (g.load.basis === 'anchor' && ph.parameters.load.mode !== 'empty')))
const opsOf = rule => rule.program.phases.flatMap(ph => ph.progression)

/**
 * The PlanRule one stage asks of one bound occurrence. `own: 'set'` is the authored phase alone,
 * fixed unless it keeps a step; `own: 'inherit'` is the occurrence's own rule. A deload week keeps
 * that rule's steps, so it opens from the track's progressed value, and scales every group's load
 * once; it and any recovery week are `adaptive: false`, logged without moving the track
 * (advance.js). Operational effort becomes a RIR floor; advisory effort leaves the rule alone (the
 * run carries it in the prescription's provenance). The week's execution options ride along as
 * `options`, so they are frozen into the prescription with the rest of the rule.
 */
export function stageRule({ def, track, stage, oid, occRule, runId }) {
  const t = targetOf(stage, oid)
  let program
  if (t.own === 'set') {
    const ph = { ...copy(t.phase), exit: null }
    // Absent rest inherits the occurrence's; an explicit 0 is kept.
    ph.parameters.restSeconds = ph.parameters.restSeconds ?? occRule.program.phases[0].parameters.restSeconds
    // A fixed load is used exactly (spec 9): with no load step, a goal would only cap it.
    if (!operatorFor(ph, 'load')) ph.target = { mode: 'none' }
    const tm = ph.groups.some(g => g.load?.basis === 'training_max') && track.tm
    program = { phases: [ph], end: 'complete', completion: [], ...(tm ? { trainingMax: { mode: 'direct', value: tm.value, unit: tm.unit } } : {}) }
  } else {
    program = copy(occRule.program)
    // ponytail: an anchor group's load range (loadTo) is dropped at a scaled percent; the deload is one load.
    if (t.deload) program.phases = program.phases.map(ph => ({ ...ph, groups: ph.groups.map(g => ({ ...g, load: deloaded(g.load, t.deload.factor) })) }))
  }
  if (stage.kind === 'recovery' || t.deload) program.adaptive = false
  // Stage entry for the load (spec 6): a declared seed; on 'copy', the previous work stage's fixed
  // load; and an unchanged load step in the same phase keeps the start it entered with, so the
  // engine carries the track's progressed value on (program.js sameStart) instead of reopening at
  // the occurrence's. In another phase the engine starts over, so the week's own load stands.
  const phase = program.phases[0], seed = t.seed?.load
  const prev = before(track, stage)
  const prevPhase = prev && stageRule({ def, track, stage: prev, oid, occRule, runId }).program.phases[0]
  const prevOp = prevPhase && operatorFor(prevPhase, 'load')
  const carried = !!prevOp && prevPhase.id === phase.id && canonicalJSON(prevOp) === canonicalJSON(operatorFor(phase, 'load'))
  const load = phase.parameters.load
  if (typeof seed === 'number') phase.parameters.load = load.mode === 'percent_1rm' ? { ...load, percent: seed } : { ...load, value: seed }
  else if (seed === 'copy' ? prevPhase && (!prevOp || carried) : carried) phase.parameters.load = copy(prevPhase.parameters.load)
  // ponytail: 'copy' after a different adaptive load, and seeds of other metrics, are run state: the run's replay applies them.
  if (t.effort?.mode === 'operational') {
    program.phases = program.phases.map(ph => ({ ...ph, parameters: { ...ph.parameters, rir: { min: 10 - t.effort.rpe, max: 10 } }, success: { ...ph.success, effort: 'rir_floor' } }))
  }
  // pr3 renames the no-operator preset 'manual'.
  return {
    ...copy(occRule), id: `${occRule.id}~${runId}~${stage.id}`, revision: def.rev, preset: occRule.preset ?? 'autoregulated', program,
    ...(t.options ? { options: copy(t.options) } : {})
  }
}

/** A programme's stages as a weekly template: 'five_three_one' (4 weeks, the cycle ends on the
 *  4th) or 'copy' (n weeks of the occurrence's own phase, its steps removed). */
export function weeklyTemplate(name, { oid, occRule, n = 1 }) {
  const stage = (id, phase, more = {}) => ({ id, kind: 'work', ...more, targets: { [oid]: { own: 'set', phase } } })
  if (name === 'five_three_one') {
    return defaultPlanRule('five_three_one', {}).program.phases
      .map((ph, i) => stage(ph.id, { ...ph, exit: null }, i === 3 ? { kind: 'recovery', cycleEnd: true } : {}))
  }
  if (name === 'copy') {
    const { stall, ...ph } = occRule.program.phases[0]
    return Array.from({ length: n }, (_, i) => stage(`w${i + 1}`, copy({ ...ph, target: { mode: 'none' }, progression: [], exit: null })))
  }
  throw new Error(`unknown weekly template "${name}"`)
}

// The deciding rows of a phase that an effort floor can read: not AMRAP, Max or to failure.
function effortRows(ph, cfg) {
  const failure = cfg.failureSets ?? (cfg.lastToFailure === true ? 'last' : null)
  const rows = ph.groups.flatMap(g => Array.from({ length: g.count === 'parameters' ? ph.parameters.sets.min : g.count.min }, () => g))
  const toFailure = i => failure === 'all' || (failure === 'last' && i === rows.length - 1) || (Array.isArray(failure) && failure.includes(i + 1))
  return rows.filter((g, i) => (ph.success.scope !== 'groups' || ph.success.groupIds.includes(g.id)) && !g.amrap && !g.max && !toFailure(i))
}

// Where a phase gives a metric to its groups, a step on that metric would write a fixed value.
const FIXED = {
  reps: g => g.reps !== 'parameters',
  sets: g => g.count !== 'parameters',
  load: g => g.load.basis === 'training_max' || (g.load.basis === 'absolute' && g.load.value > 0)
}

function targetErrors(t, at, hasPrevious) {
  const out = []
  if (!isObj(t) || !['inherit', 'set'].includes(t.own)) return [`${at}.own must be inherit or set`]
  if (t.own === 'set' && !(isObj(t.phase) && isObj(t.phase.parameters) && Array.isArray(t.phase.groups) && Array.isArray(t.phase.progression))) out.push(`${at}.phase is required for own set`)
  if (t.own === 'inherit' && t.phase !== undefined) out.push(`${at}.phase is for own set only`)
  if (t.effort !== undefined && !(isObj(t.effort) && ['advisory', 'operational'].includes(t.effort.mode) && Number.isFinite(t.effort.rpe) && t.effort.rpe >= 6 && t.effort.rpe <= 10)) out.push(`${at}.effort needs mode advisory or operational and rpe 6 to 10`)
  if (t.deload !== undefined && !(t.own === 'inherit' && isValidDeloadFactor(t.deload?.factor))) out.push(`${at}.deload needs an inherited week and a valid factor`)
  for (const [metric, v] of Object.entries(t.seed ?? {})) {
    if (v === 'copy' ? !hasPrevious : !(Number.isFinite(v) && v >= 0)) out.push(`${at}.seed.${metric} must be a number ≥ 0, or copy after an earlier work stage`)
  }
  if (t.options !== undefined && !isObj(t.options)) out.push(`${at}.options must be an object`)
  return out
}

/**
 * Save- and activation-time check of a programme definition against the routines it binds
 * (`routines`: the profile's list of `{ id, ex: [occurrence] }`). Every compiled stage rule must
 * pass validatePlanRule, and the stage rules of spec 6 and 11 hold on top of it.
 */
export function validateProgramme(def, { routines = [] } = {}) {
  const errors = []
  const s = def?.schedule
  const planned = s?.mode === 'weeks' ? (s.appts || []).map(a => a?.rid) : s?.mode === 'rotation' ? (s.sequence || []).filter(x => x !== 'rest') : []
  if (!planned.length) errors.push('schedule needs at least one appointment')
  if (def?.duration?.unit !== DURATION_UNIT[s?.mode]) errors.push(`duration.unit must be ${DURATION_UNIT[s?.mode] ?? 'weeks or blocks'} for this schedule`)
  if (!(Number.isInteger(def?.duration?.n) && def.duration.n >= 1 && def.duration.n <= MAX_LENGTH)) errors.push(`duration.n must be 1 to ${MAX_LENGTH}`)
  const tracks = Array.isArray(def?.tracks) ? def.tracks : []
  if (!tracks.length || tracks.length > MAX_TRACKS) errors.push(`tracks must hold 1 to ${MAX_TRACKS} tracks`)
  tracks.forEach((track, ti) => {
    const at = `tracks[${ti}]`
    const stages = Array.isArray(track?.stages) ? track.stages : []
    if (!stages.length || stages.length > MAX_LENGTH) errors.push(`${at}.stages must hold 1 to ${MAX_LENGTH} stages`)
    if (!track?.slots?.length) errors.push(`${at}.slots must bind at least one occurrence`)
    const bound = (track?.slots || []).flatMap((slot, si) => {
      if (!planned.includes(slot?.rid)) { errors.push(`${at}.slots[${si}]: routine ${slot?.rid} is not in the schedule`); return [] }
      const occ = routines.find(r => r?.id === slot.rid)?.ex?.find(o => o?.occurrenceId === slot.oid)
      if (!occ) { errors.push(`${at}.slots[${si}]: occurrence ${slot.oid} is not in routine ${slot.rid}`); return [] }
      if (!validatePlanRule(occ.rule).ok) { errors.push(`${at}.slots[${si}]: occurrence ${slot.oid} has no valid rule`); return [] }
      return [{ slot, occ }]
    })
    if (bound.some(x => x.occ.exerciseId !== track.exerciseId)) errors.push(`${at}: linked slots must all be ${track.exerciseId}`)
    const units = new Set(bound.map(({ occ }) => occ.rule.program.phases[0].parameters.load.unit).filter(Boolean))
    if (units.size > 1 || new Set(bound.map(({ occ }) => occ.dbLoad ?? 'as')).size > 1) errors.push(`${at}: linked slots must share one load unit and meaning`)
    const authored = stages.reduce((n, st) => n + (track.slots || []).filter(slot => st?.targets?.[slot?.oid]?.own === 'set').length, 0)
    if (authored > MAX_PHASES) errors.push(`${at}: at most ${MAX_PHASES} authored phases`)
    for (const { slot, occ } of bound) {
      let prev = null, malformed = false
      stages.forEach((stage, i) => {
        // A later stage compiles from the ones before it (stageRule's entry), so a malformed one ends the slot's checks.
        if (malformed || stage?.kind === 'rest') return
        const sat = `${at}.stages[${i}].targets.${slot.oid}`
        const t = targetOf(stage, slot.oid)
        const bad = targetErrors(t, sat, !!prev)
        if (bad.length) { errors.push(...bad); malformed = true; return }
        const rule = stageRule({ def, track, stage, oid: slot.oid, occRule: occ.rule, runId: 'check' })
        const check = validatePlanRule(rule)
        if (!check.ok) { errors.push(...check.errors.map(e => `${sat}: ${e}`)); return }
        if (t.deload && !scalable(rule)) errors.push(`${sat}.deload needs a load to scale`)
        const ph = rule.program.phases[0]
        if (t.own === 'set') {
          for (const op of ph.progression) {
            if (FIXED[op.metric] && ph.groups.some(FIXED[op.metric])) errors.push(`${sat}: ${op.metric} is fixed per group, so no step may move it`)
            // Spec 6: with the load fixed, a kept reps/sets chain says what happens at its top.
            if (!operatorFor(ph, 'load') && ['reps', 'sets'].includes(op.metric) && typeof op.resetOnCarry !== 'boolean') errors.push(`${sat}: with the load fixed, the ${op.metric} step must say hold or reset (resetOnCarry)`)
          }
        }
        if (prev) {
          const carried = new Set(opsOf(prev).map(op => canonicalJSON(op)))
          for (const op of opsOf(rule)) if (!carried.has(canonicalJSON(op)) && t.seed?.[op.metric] === undefined) errors.push(`${sat}: the ${op.metric} step is new in this stage and needs seed.${op.metric}`)
        }
        if (t.effort?.mode === 'operational') {
          if (ph.parameters.durationSeconds) errors.push(`${sat}: operational effort is for repetition work`)
          else if (!effortRows(ph, { ...occ, ...t.options }).length) errors.push(`${sat}: operational effort needs a deciding set that is not AMRAP, Max or to failure`)
        }
        const o = t.options ?? {}
        for (const k of Object.keys(o)) if (OPTION_CLASSES[k] !== 'execution') errors.push(`${sat}.options.${k} is not an execution option`)
        if (!validateIntensifier(o.intensifier, rule)) errors.push(`${sat}.options.intensifier does not fit this week's rule`)
        if (!validateWarmup(o.warmup)) errors.push(`${sat}.options.warmup is invalid`)
        if (o.incline !== undefined && !(Number.isFinite(o.incline) && o.incline >= 0 && o.incline <= INCLINE_MAX)) errors.push(`${sat}.options.incline must be 0 to ${INCLINE_MAX}`)
        // ponytail: the other execution options are stored as given; the session start that applies them guards their values.
        if (stage.kind === 'work') prev = rule
      })
    }
  })
  return { ok: errors.length === 0, errors }
}

const observed = (row, metric) => row.observations?.find(o => o.metric === metric)?.value

// A saved exposure against its own frozen prescription: confirmed misses fail it, missing
// measurements leave it unknown, and both kinds of reason are kept.
function savedOutcome(p, exposure) {
  const a = exposure.actual
  const failed = new Set(), missing = new Set()
  if (a.sets < p.rows.length) failed.add('incomplete')
  if (a.short || a.light || (!verdictOf(p, a).hit && !a.incomplete && a.sets >= p.rows.length)) failed.add('work')
  if (a.incomplete) missing.add('measurement')
  const phase = phaseOf(p)
  const planned = row => p.rows[Number(row.setId?.slice(1))]
  const deciding = (exposure.performance?.sets || []).filter(row => isWork(row) && planned(row)
    && (phase.success.scope !== 'groups' || phase.success.groupIds.includes(groupIdOf(p, planned(row)))))
  if (p.parameters.speed) {
    for (const row of deciding) {
      const speed = observed(row, 'speed')
      if (speed == null) missing.add('speed')
      else if (speed < p.parameters.speed) failed.add('work')
    }
  }
  // Operational effort (spec 11): a RIR floor on every rated deciding set; AMRAP, Max and
  // failure sets are not ordinary sets, so they neither pass nor fail it.
  if (phase.success.effort === 'rir_floor' && p.parameters.rir) {
    for (const row of deciding) {
      if (planned(row).amrap || planned(row).max || row.max || row.failure) continue
      const { rir } = normalizeEffort(row)
      if (rir == null) missing.add('effort')
      else if (rir < p.parameters.rir.min) failed.add('effort')
    }
  }
  return { outcome: failed.size ? 'failed' : missing.size ? 'unknown' : 'succeeded', reasons: [...failed, ...[...missing].map(m => `missing_${m}`)] }
}

/**
 * One planned slot's outcome (spec 8.2): pending while its session is open; else what its saved
 * exposure shows; else what the programme event that disposed of it says — skip, close or bypass
 * (skipped), discard { worked } (skipped, or failed as abandoned once a work row was done), or
 * resolve { as }, which settles unknown or pending evidence only. Reads the actuals, never edits them.
 */
export function slotOutcome({ prescription, exposure = null, disposition = null, active = false }) {
  if (active) return { outcome: 'pending', reasons: ['active'] }
  const read = exposure ? savedOutcome(prescription, exposure) : { outcome: 'pending', reasons: [] }
  const d = disposition
  if (d?.type === 'resolve' && ['unknown', 'pending'].includes(read.outcome)) return { outcome: d.as, reasons: [...read.reasons, 'resolved'] }
  if (exposure || !d || d.type === 'resolve') return read
  return d.type === 'discard' && d.worked ? { outcome: 'failed', reasons: ['abandoned'] } : { outcome: 'skipped', reasons: [d.type] }
}
