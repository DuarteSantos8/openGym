// The closed preset catalogue, the default rule for each preset, and save-time validation. Plan
// configuration is strict: an invalid rule cannot be saved or generated from. Athlete execution is
// never validated here — see audit.js.

export const INCREMENT_TYPES = ['absolute', 'current_load_percent', 'snapshot_1rm_percent', 'target_load_percent', 'percentage_points', 'seconds']
export const COMPLETION_METRICS = ['target_load', 'max_sets', 'max_reps', 'max_duration', 'cycle_count', 'training_max', 'difficulty_rung']
// The gates that advance the load expression. 'rung' advances a ladder position instead.
export const INCREMENTING_GATES = ['hit', 'max_reps', 'max_sets_reps']

const STRENGTH = ['target_load', 'max_sets', 'max_reps']
// ranges: per field, whether the plan may give it as a range — 'fixed' (one value, min === max),
// 'range' (always from/to) or 'either' (the planner's choice). `load` 'fixed' forbids loadTo.
const ranges = (sets, reps = sets, durationSeconds = sets, load = sets) => ({ sets, reps, durationSeconds, load })
// gate: what a finished session must show to earn the next automated step (advance.js).
// metrics: the completion conditions this preset accepts. completion: the default list.
export const PRESETS = {
  manual: { gate: null, metrics: [...STRENGTH, 'max_duration'], completion: [], ranges: ranges('either') },
  autoregulated: { gate: null, metrics: [...STRENGTH, 'max_duration'], completion: [], ranges: ranges('either') },
  linear: { gate: 'hit', metrics: ['target_load'], completion: ['target_load'], ranges: ranges('fixed') },
  greyskull: { gate: 'hit', metrics: ['target_load'], completion: ['target_load'], ranges: ranges('fixed') },
  double: { gate: 'max_reps', metrics: ['target_load', 'max_reps'], completion: ['max_reps', 'target_load'], ranges: ranges('fixed', 'range', 'range', 'fixed') },
  triple: { gate: 'max_sets_reps', metrics: STRENGTH, completion: ['max_sets', 'max_reps', 'target_load'], ranges: ranges('range', 'range', 'range', 'fixed') },
  duration: { gate: null, metrics: ['max_sets', 'max_duration'], completion: ['max_duration'], ranges: ranges('either', 'fixed', 'either', 'fixed') },
  hold_seconds: { gate: 'seconds', metrics: ['max_sets', 'max_duration'], completion: [], ranges: ranges('either', 'fixed', 'either', 'fixed') },
  bodyweight_ladder: { gate: 'rung', metrics: ['max_sets', 'max_reps', 'difficulty_rung'], completion: ['max_sets', 'max_reps'], ranges: ranges('range', 'range', 'fixed', 'fixed') },
  pyramid: { gate: 'hit', metrics: ['target_load'], completion: ['target_load'], ranges: ranges('either', 'fixed', 'fixed', 'fixed') },
  reverse_pyramid: { gate: 'hit', metrics: ['target_load'], completion: ['target_load'], ranges: ranges('either', 'fixed', 'fixed', 'fixed') },
  five_three_one: { gate: null, metrics: ['cycle_count', 'training_max'], completion: [], ranges: ranges('fixed') }
}
export const PRESET_IDS = Object.keys(PRESETS)

// The v1 policies each logging mode accepted and the preset that is their exact equivalent.
// Shared by the v1 → v2 migration and the Coach, which still speaks in v1 policies.
const POLICY_BY_MODE = { reps: ['linear', 'greyskull', 'double'], time: ['time'], cardio: [] }
export function presetForPolicy(prog, mode, bodyweight) {
  if (!POLICY_BY_MODE[mode]?.includes(prog)) return 'manual'
  if (prog === 'time') return 'duration'
  return prog === 'linear' && bodyweight ? 'bodyweight_ladder' : prog
}
const POLICY_OF = { linear: 'linear', greyskull: 'greyskull', double: 'double', bodyweight_ladder: 'linear', duration: 'time', manual: 'off' }
/** The v1 policy a preset reads as, or null when it has no v1 equivalent. */
export const policyOfPreset = preset => POLICY_OF[preset] ?? null

// Standard 5/3/1: one inner list per week of the cycle; the last set of weeks 1-3 is AMRAP.
export const WENDLER_CYCLE = [
  [[65, 5], [75, 5], [85, 5, true]],
  [[70, 3], [80, 3], [90, 3, true]],
  [[75, 5], [85, 3], [95, 1, true]],
  [[40, 5], [50, 5], [60, 5]]
].map(week => week.map(([percentOfTM, reps, amrap]) => ({ percentOfTM, reps, ...(amrap ? { amrap } : {}) })))

// Reverse-pyramid training in the RPT style: every set 10 % lighter and 2 reps higher than the one
// before, so each lands near the same effort. The anchor set has no `reps` of its own: it takes
// parameters.reps, so the editor has a single place to change it.
export const rptOffsets = (sets, anchorReps = 6) => Array.from({ length: sets }, (_, i) =>
  (i === 0 ? { percentOfAnchor: 100 } : { percentOfAnchor: Math.max(50, 100 - 10 * i), reps: anchorReps + 2 * i }))

const UNIT = { kg: { start: 20, step: 2.5, target: 100, tm: 100 }, lb: { start: 45, step: 5, target: 225, tm: 225 } }
const range = (min, max = min) => ({ min, max })

/** A valid rule for `preset` — what a fresh occurrence starts from. */
export function defaultPlanRule(preset, { id, exerciseId, routineId = null, unit = 'kg' }) {
  const u = UNIT[unit]
  const abs = value => ({ mode: 'absolute', value, unit })
  const loaded = INCREMENTING_GATES.includes(PRESETS[preset].gate)
  const rule = {
    id, revision: 1, routineId, exerciseId, preset,
    parameters: { sets: range(3), reps: range(8), load: loaded ? abs(u.start) : { mode: 'empty' }, restSeconds: 90 },
    target: loaded ? abs(u.target) : { mode: 'none' },
    increment: { type: 'absolute', value: u.step, unit },
    completion: PRESETS[preset].completion.map(metric => ({ metric, target: null })),
    rounding: { mode: 'nearest', step: u.step },
    special: {}
  }
  const p = rule.parameters
  if (preset === 'linear' || preset === 'greyskull') Object.assign(p, { reps: range(5), restSeconds: 180 })
  if (preset === 'autoregulated') Object.assign(p, { reps: range(8, 12), rir: range(1, 3) })
  if (preset === 'double') Object.assign(p, { reps: range(8, 12), restSeconds: 120 })
  if (preset === 'triple') Object.assign(p, { sets: range(3, 5), reps: range(8, 12), restSeconds: 120 })
  if (preset === 'duration') Object.assign(p, { reps: range(1), durationSeconds: range(30, 60), restSeconds: 60 })
  if (preset === 'hold_seconds') {
    Object.assign(p, { reps: range(1), durationSeconds: range(20, 30), restSeconds: 90 })
    rule.increment = { type: 'seconds', value: 5 }
    rule.completion = [{ metric: 'max_duration', target: 120 }]
  }
  if (preset === 'bodyweight_ladder') {
    Object.assign(p, { sets: range(3, 5), reps: range(5, 10) })
    rule.special = { rungs: [] }
  }
  if (preset === 'pyramid' || preset === 'reverse_pyramid') {
    const percents = preset === 'pyramid' ? [70, 85, 100] : [100, 90, 80]
    rule.special = { offsets: percents.map(percentOfAnchor => ({ percentOfAnchor })) }
    Object.assign(p, { reps: range(8), restSeconds: 150 })
  }
  if (preset === 'five_three_one') {
    Object.assign(p, { reps: range(5), restSeconds: 180 })
    rule.special = {
      trainingMax: { mode: 'ninety_percent_1rm' },
      cycleSets: WENDLER_CYCLE.map(week => week.map(set => ({ ...set }))),
      endOfCycleIncrement: { value: u.step, unit }
    }
    rule.completion = [{ metric: 'cycle_count', target: 4 }]
  }
  return rule
}

/** True when generating from this rule needs the exercise's 1RM. */
export const needsOneRm = rule =>
  rule.parameters.load.mode === 'percent_1rm' ||
  rule.target.mode === 'percent_1rm' ||
  (rule.increment.type === 'snapshot_1rm_percent' && INCREMENTING_GATES.includes(PRESETS[rule.preset].gate)) ||
  (rule.preset === 'five_three_one' && rule.special.trainingMax?.mode === 'ninety_percent_1rm')

const UNITS = ['kg', 'lb']
const finite = Number.isFinite
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)

function checkRange(errors, path, r, { min = 0, max = Infinity, integer = false } = {}) {
  if (!isObj(r) || !finite(r.min) || !finite(r.max)) { errors.push(`${path}: min and max must be finite numbers`); return }
  if (r.min > r.max) errors.push(`${path}: min is above max`)
  if (r.min < min) errors.push(`${path}: must be at least ${min}`)
  if (r.max > max) errors.push(`${path}: must be at most ${max}`)
  if (integer && !(Number.isInteger(r.min) && Number.isInteger(r.max))) errors.push(`${path}: must be whole numbers`)
}

function checkExpression(errors, path, e, allowed) {
  if (!isObj(e) || !allowed.includes(e.mode)) { errors.push(`${path}.mode must be one of ${allowed.join(', ')}`); return }
  if (e.mode === 'absolute') {
    if (!finite(e.value) || e.value < 0) errors.push(`${path}.value must be a finite number ≥ 0`)
    if (!UNITS.includes(e.unit)) errors.push(`${path}.unit must be kg or lb`)
  }
  if (e.mode === 'percent_1rm' && !(finite(e.percent) && e.percent > 0)) errors.push(`${path}.percent must be a finite number > 0`)
}

// A load range's high end: same mode (and unit) as its low end, never below it.
function checkLoadTo(errors, rule, def) {
  const { load, loadTo } = rule.parameters
  if (def.ranges.load === 'fixed') { errors.push(`parameters.loadTo is not allowed for ${rule.preset}`); return }
  const n = errors.length
  checkExpression(errors, 'parameters.loadTo', loadTo, ['absolute', 'percent_1rm'])
  if (errors.length > n) return
  if (load?.mode !== loadTo.mode) errors.push('parameters.loadTo needs a load of the same mode')
  else if (loadTo.mode === 'absolute' && loadTo.unit !== load.unit) errors.push('parameters.loadTo.unit must match parameters.load.unit')
  else if (loadTo.mode === 'absolute' ? loadTo.value < load.value : loadTo.percent < load.percent) errors.push('parameters.loadTo must not be below parameters.load')
}

function checkRounding(errors, r) {
  if (r?.mode === 'allowed_values') {
    const vs = r.allowedValues
    if (!Array.isArray(vs) || !vs.length || !vs.every(finite) || vs.some((v, i) => i > 0 && v <= vs[i - 1])) {
      errors.push('rounding.allowedValues must be finite, strictly ascending and non-empty')
    }
  } else if (!['nearest', 'up', 'down'].includes(r?.mode) || !(finite(r.step) && r.step > 0)) {
    errors.push('rounding needs mode nearest/up/down and a step > 0, or mode allowed_values')
  }
}

function checkSpecial(errors, rule) {
  const s = rule.special || {}
  if (rule.preset === 'pyramid' || rule.preset === 'reverse_pyramid') {
    const percents = Array.isArray(s.offsets) ? s.offsets.map(o => o?.percentOfAnchor) : []
    if (!percents.length || !percents.every(v => finite(v) && v > 0 && v <= 100)) {
      errors.push('special.offsets: each percentOfAnchor must be > 0 and ≤ 100')
      return
    }
    const rising = rule.preset === 'pyramid'
    if (percents.some((v, i) => i > 0 && (rising ? v < percents[i - 1] : v > percents[i - 1]))) errors.push(`special.offsets must ${rising ? 'rise' : 'fall'} set by set`)
    if (percents[rising ? percents.length - 1 : 0] !== 100) errors.push(`special.offsets must ${rising ? 'end' : 'start'} at the anchor (100)`)
    const { sets } = rule.parameters
    if (sets?.min > percents.length || sets?.max < percents.length) errors.push('parameters.sets must include the number of offsets')
    s.offsets.forEach((o, i) => {
      if (o.reps === undefined) return
      if (!(Number.isInteger(o.reps) && o.reps >= 1)) errors.push(`special.offsets[${i}].reps must be a whole number ≥ 1`)
      else if (o.percentOfAnchor === 100) errors.push('special.offsets: the anchor set takes its reps from parameters.reps')
    })
  }
  if (rule.preset === 'five_three_one') {
    const tm = s.trainingMax
    const directOk = tm?.mode === 'direct' && finite(tm.value) && tm.value > 0 && UNITS.includes(tm.unit)
    if (!(tm?.mode === 'ninety_percent_1rm' || directOk)) errors.push('special.trainingMax must be direct {value, unit} or ninety_percent_1rm')
    const setOk = x => isObj(x) && finite(x.percentOfTM) && x.percentOfTM > 0 && Number.isInteger(x.reps) && x.reps >= 1 && (x.amrap === undefined || typeof x.amrap === 'boolean')
    if (!Array.isArray(s.cycleSets) || !s.cycleSets.length || !s.cycleSets.every(w => Array.isArray(w) && w.length && w.every(setOk))) {
      errors.push('special.cycleSets must be non-empty weeks of {percentOfTM, reps}')
    }
    const inc = s.endOfCycleIncrement
    if (!(isObj(inc) && finite(inc.value) && inc.value >= 0 && UNITS.includes(inc.unit))) errors.push('special.endOfCycleIncrement must be {value ≥ 0, unit}')
  }
  if (rule.preset === 'bodyweight_ladder' && s.rungs !== undefined && !(Array.isArray(s.rungs) && s.rungs.every(x => typeof x === 'string' && x.trim()))) {
    errors.push('special.rungs must be non-empty names')
  }
}

export function validatePlanRule(rule) {
  const def = PRESETS[rule?.preset]
  if (!def) return { ok: false, errors: [`preset "${rule?.preset}" is not a preset`] }
  const errors = []
  if (typeof rule.id !== 'string' || !rule.id) errors.push('id is required')
  if (!Number.isInteger(rule.revision) || rule.revision < 1) errors.push('revision must be a positive integer')
  if (typeof rule.exerciseId !== 'string' || !rule.exerciseId) errors.push('exerciseId is required')

  const p = rule.parameters || {}
  checkRange(errors, 'parameters.sets', p.sets, { min: 1, integer: true })
  checkRange(errors, 'parameters.reps', p.reps, { integer: true })
  if (p.durationSeconds !== undefined) checkRange(errors, 'parameters.durationSeconds', p.durationSeconds)
  if (p.rir !== undefined) checkRange(errors, 'parameters.rir', p.rir, { max: 10 })
  if (!(finite(p.restSeconds) && p.restSeconds >= 0)) errors.push('parameters.restSeconds is required and must be ≥ 0')
  for (const field of ['sets', 'reps', 'durationSeconds']) {
    const r = p[field]
    if (def.ranges[field] === 'fixed' && isObj(r) && r.min < r.max) errors.push(`parameters.${field} must be a fixed value for ${rule.preset}`)
  }
  checkExpression(errors, 'parameters.load', p.load, ['absolute', 'percent_1rm', 'empty'])
  if (p.loadTo !== undefined) checkLoadTo(errors, rule, def)
  checkExpression(errors, 'target', rule.target, ['absolute', 'percent_1rm', 'none'])
  if (p.load?.mode === 'absolute' && rule.target?.mode === 'absolute' && p.load.unit !== rule.target.unit) errors.push('target.unit must match parameters.load.unit')

  const inc = rule.increment
  if (!isObj(inc) || !INCREMENT_TYPES.includes(inc.type)) errors.push('increment.type is not supported')
  else {
    if (!(finite(inc.value) && inc.value >= 0)) errors.push('increment.value must be a finite number ≥ 0')
    if (inc.type === 'absolute' && !UNITS.includes(inc.unit)) errors.push('increment.unit must be kg or lb')
    if (inc.type === 'percentage_points' && p.load?.mode !== 'percent_1rm') errors.push('percentage_points pairs only with a percent_1rm load')
    if ((inc.type === 'seconds') !== (rule.preset === 'hold_seconds')) errors.push('seconds increments pair only with hold_seconds, and hold_seconds needs them')
    if (INCREMENTING_GATES.includes(def.gate)) {
      if (p.load?.mode === 'empty') errors.push(`${rule.preset} needs a starting load`)
      if (p.load?.mode === 'percent_1rm' && inc.type !== 'percentage_points') errors.push('a percent_1rm load progresses in percentage_points')
      if (inc.type === 'target_load_percent' && rule.target?.mode === 'none') errors.push('target_load_percent needs a target')
    }
  }

  if (!Array.isArray(rule.completion)) errors.push('completion must be a list')
  const completion = Array.isArray(rule.completion) ? rule.completion : []
  const metrics = completion.map(c => c?.metric)
  metrics.filter((m, i) => metrics.indexOf(m) !== i).forEach(m => errors.push(`completion metric "${m}" is listed twice`))
  completion.forEach(c => {
    if (!def.metrics.includes(c?.metric)) { errors.push(`completion metric "${c?.metric}" is not supported by ${rule.preset}`); return }
    if (c.metric === 'target_load' && rule.target?.mode === 'none') errors.push('target_load needs a target')
    if (c.metric === 'max_duration' && !p.durationSeconds) errors.push('max_duration needs parameters.durationSeconds')
    // hold_seconds' window slides, so "the top of the window" is no stop time: it needs a number.
    if (c.metric === 'max_duration' && (c.target != null || rule.preset === 'hold_seconds') && !(finite(c.target) && c.target > 0)) errors.push('max_duration target must be a number > 0')
    if (c.metric === 'cycle_count' && !(Number.isInteger(c.target) && c.target >= 1)) errors.push('cycle_count needs a whole target ≥ 1')
    if (c.metric === 'training_max' && !(finite(c.target) && c.target > 0)) errors.push('training_max needs a target > 0')
    if (c.metric === 'difficulty_rung' && !rule.special?.rungs?.length) errors.push('difficulty_rung needs special.rungs')
  })

  checkRounding(errors, rule.rounding)
  if (['duration', 'hold_seconds'].includes(rule.preset) && !p.durationSeconds) errors.push(`${rule.preset} needs parameters.durationSeconds`)
  checkSpecial(errors, rule)
  return { ok: errors.length === 0, errors }
}

const NO_RESTPAUSE = ['pyramid', 'reverse_pyramid', 'five_three_one', 'greyskull']
/** What an occurrence's optional extras can attach to. A ramp or a drop needs a load to scale
 *  and reps to count, so timed and unloaded rules have none; rest-pause replaces the whole set
 *  list, so presets that shape their own rows (percentages, AMRAP) cannot take it. */
export function supports(rule) {
  const usable = !rule.parameters.durationSeconds && (rule.parameters.load.mode !== 'empty' || rule.preset === 'five_three_one')
  return {
    warmup: usable,
    dropset: usable && rule.preset !== 'bodyweight_ladder',
    restpause: usable && rule.preset !== 'bodyweight_ladder' && !NO_RESTPAUSE.includes(rule.preset)
  }
}

/** Trust-boundary check for an occurrence's intensifier; missing = none. */
export function validateIntensifier(i, rule) {
  if (i === undefined) return true
  if (!isObj(i)) return false
  const okInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi
  const keys = Object.keys(i).sort().join()
  const ok = i.type === 'dropset' ? keys === 'count,pct,type' && okInt(i.count, 1, 5) && finite(i.pct) && i.pct > 0 && i.pct < 100
    : i.type === 'restpause' ? keys === 'restSec,totalReps,type' && okInt(i.totalReps, 1, 100) && okInt(i.restSec, 5, 120)
    : false
  return ok && (!rule || supports(rule)[i.type])
}
