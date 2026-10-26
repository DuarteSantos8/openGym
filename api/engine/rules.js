// The template catalogue, the program each template builds, its numbers read back, and save-time
// validation. A rule carries one `program` (phases of groups, operators, exits); `preset` only
// names the template it was built from. Plan configuration is strict: an invalid rule cannot be
// saved or generated from. Athlete execution is never validated here — see audit.js.

import { DELOAD_FACTOR_MAX, DELOAD_FACTOR_MIN, defaultDeload, isValidDeloadFactor } from './deload.js'
import { canonicalJSON } from './canonical.js'

export const INCREMENT_TYPES = ['absolute', 'current_load_percent', 'snapshot_1rm_percent', 'target_load_percent', 'percentage_points']
export const COMPLETION_METRICS = ['target_load', 'max_sets', 'max_reps', 'max_duration', 'cycle_count', 'training_max', 'difficulty_rung', 'rest_floor']
export const OPERATOR_METRICS = ['load', 'reps', 'sets', 'durationSeconds', 'restSeconds', 'difficulty']
export const RECOVERY_METHODS = ['factor', 'epley', 'epley_reps']
export const MAX_PHASES = 32
export const MAX_GROUPS = 50
export const MAX_ROWS = 50
export const MAX_OPERATORS = 8

const STRENGTH = ['target_load', 'max_sets', 'max_reps']
// ranges: per field, whether the editor offers it as a range — 'fixed' (one value), 'range'
// (always from/to) or 'either'. `steps`: what the template's own operator steps ('load' or
// 'seconds'). `stalls`: whether it can back off. Editor metadata only: the engine reads the program.
const ranges = (sets, reps = sets, durationSeconds = sets, load = sets) => ({ sets, reps, durationSeconds, load })
export const PRESETS = {
  autoregulated: { metrics: [...STRENGTH, 'max_duration'], ranges: ranges('either'), steps: null, stalls: false },
  linear: { metrics: ['target_load'], ranges: ranges('fixed'), steps: 'load', stalls: true },
  greyskull: { metrics: ['target_load'], ranges: ranges('fixed'), steps: 'load', stalls: true },
  double: { metrics: ['target_load', 'max_reps'], ranges: ranges('fixed', 'range', 'range', 'fixed'), steps: 'load', stalls: true },
  triple: { metrics: STRENGTH, ranges: ranges('range', 'range', 'range', 'fixed'), steps: 'load', stalls: true },
  hold_seconds: { metrics: ['max_sets', 'max_duration'], ranges: ranges('either', 'fixed', 'either', 'fixed'), steps: 'seconds', stalls: true },
  bodyweight_ladder: { metrics: ['max_sets', 'max_reps', 'difficulty_rung'], ranges: ranges('range', 'range', 'fixed', 'fixed'), steps: null, stalls: false },
  pyramid_reps: { metrics: [], ranges: ranges('fixed'), steps: null, stalls: false },
  pyramid: { metrics: ['target_load'], ranges: ranges('either', 'fixed', 'fixed', 'fixed'), steps: 'load', stalls: true },
  five_three_one: { metrics: ['cycle_count', 'training_max'], ranges: ranges('fixed'), steps: null, stalls: false },
  top_set_backoff: { metrics: ['target_load'], ranges: ranges('fixed'), steps: 'load', stalls: true },
  accumulation_intensification: { metrics: ['cycle_count', 'training_max'], ranges: ranges('fixed'), steps: null, stalls: false },
  density: { metrics: ['rest_floor'], ranges: ranges('fixed'), steps: null, stalls: false }
}
export const PRESET_IDS = Object.keys(PRESETS)

// The v1 policies each logging mode accepted and the preset that is their exact equivalent.
// Shared by the v1 → v2 migration and the Coach, which still speaks in v1 policies. v1's "Add
// time" grew the target seconds after a clean session, which is what hold_seconds does; `duration`
// is the v2 preset where you set the seconds yourself, i.e. v1's timed "no progression".
const POLICY_BY_MODE = { reps: ['linear', 'greyskull', 'double', 'triple'], time: ['time'], cardio: [] }
export function presetForPolicy(prog, mode, bodyweight) {
  if (!POLICY_BY_MODE[mode]?.includes(prog)) return 'autoregulated'
  if (prog === 'time') return 'hold_seconds'
  return prog === 'linear' && bodyweight ? 'bodyweight_ladder' : prog
}
const POLICY_OF = { linear: 'linear', greyskull: 'greyskull', double: 'double', triple: 'triple', bodyweight_ladder: 'linear', hold_seconds: 'time', autoregulated: 'off', pyramid_reps: 'off' }
/** The v1 policy a preset reads as, or null when it has no v1 equivalent. */
export const policyOfPreset = preset => POLICY_OF[preset] ?? null

// Pyramid reps (v1.3.10's "pyramid sets"): a rep target per set, in order, a whole number or 'max'.
export const SET_REPS_MAX = 10
export const REPS_MAX = 'max'

// Standard 5/3/1: one inner list per week of the cycle; the last set of weeks 1-3 is AMRAP.
export const WENDLER_CYCLE = [
  [[65, 5], [75, 5], [85, 5, true]],
  [[70, 3], [80, 3], [90, 3, true]],
  [[75, 5], [85, 3], [95, 1, true]],
  [[40, 5], [50, 5], [60, 5]]
].map(week => week.map(([percentOfTM, reps, amrap]) => ({ percentOfTM, reps, ...(amrap ? { amrap } : {}) })))

// A pyramid climbs to its heaviest set (ascending) or starts on it and backs off (descending);
// the direction is only which offsets the template starts from and which end the editor grows.
const PYRAMID_OFFSETS = { ascending: [70, 85, 100], descending: [100, 90, 80] }
export const pyramidDirection = offsets => (offsets.length > 1 && offsets[0].percentOfAnchor > offsets.at(-1).percentOfAnchor ? 'descending' : 'ascending')

// Reverse-pyramid training in the RPT style: every set 10 % lighter and 2 reps higher than the one
// before. The anchor set has no `reps` of its own: it takes the plan's reps.
export const rptOffsets = (sets, anchorReps = 6) => Array.from({ length: sets }, (_, i) =>
  (i === 0 ? { percentOfAnchor: 100 } : { percentOfAnchor: Math.max(50, 100 - 10 * i), reps: anchorReps + 2 * i }))

/* ---------- templates: flat numbers in, a program out ---------- */
const UNIT = { kg: { start: 20, step: 2.5, target: 100, tm: 100 }, lb: { start: 45, step: 5, target: 225, tm: 225 } }
const range = (min, max = min) => ({ min, max })
const copy = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
const NONE = { mode: 'none' }
// v1's bodyweight climb stops adding sets here (progression.js MAX_BW_SETS).
const LADDER_SETS = 6

/** The numbers a template starts from — every key planOptions reads back. */
function templateDefaults(preset, unit, direction) {
  const u = UNIT[unit]
  const steps = PRESETS[preset].steps
  const o = {
    sets: range(3), reps: range(8), load: steps === 'load' ? { mode: 'absolute', value: u.start, unit } : { mode: 'empty' }, restSeconds: 90,
    target: ['linear', 'greyskull', 'double', 'triple', 'pyramid'].includes(preset) ? { mode: 'absolute', value: u.target, unit } : NONE,
    step: steps === 'seconds' ? { type: 'seconds', value: 5 } : { type: 'absolute', value: u.step, unit },
    completion: { linear: ['target_load'], greyskull: ['target_load'], double: ['max_reps', 'target_load'], triple: ['max_sets', 'max_reps', 'target_load'], bodyweight_ladder: ['max_sets', 'max_reps'], pyramid: ['target_load'], reverse_pyramid: ['target_load'] }[preset]?.map(metric => ({ metric, target: null })) ?? [],
    rounding: { mode: 'nearest', step: u.step },
    deload: defaultDeload(preset)
  }
  const more = {
    linear: { reps: range(5), restSeconds: 180 },
    greyskull: { reps: range(5), restSeconds: 180 },
    double: { reps: range(8, 12), restSeconds: 120 },
    triple: { sets: range(3, 5), reps: range(8, 12), restSeconds: 120 },
    hold_seconds: { reps: range(1), durationSeconds: range(20, 30), completion: [{ metric: 'max_duration', target: 120 }] },
    bodyweight_ladder: { sets: range(3, 5), reps: range(5, 10), rungs: [] },
    pyramid_reps: { sets: range(4), reps: range(12), setReps: [12, 10, 8, 6] },
    pyramid: { reps: range(8), restSeconds: 150, offsets: (PYRAMID_OFFSETS[direction] ?? PYRAMID_OFFSETS.ascending).map(percentOfAnchor => ({ percentOfAnchor })) },
    five_three_one: {
      reps: range(5), restSeconds: 180, trainingMax: { mode: 'ninety_percent_1rm' }, cycleSets: copy(WENDLER_CYCLE),
      cycleIncrement: { value: u.step, unit }, completion: [{ metric: 'cycle_count', target: 4 }]
    },
    top_set_backoff: { sets: range(4), reps: range(6), restSeconds: 180, scope: 'top', backoff: { sets: 3, reps: 8, percent: 90, restSeconds: 120 } },
    accumulation_intensification: {
      sets: range(3), reps: range(8, 12), restSeconds: 120, trainingMax: { mode: 'ninety_percent_1rm' }, cycleIncrement: { value: u.step, unit }, end: 'repeat',
      accumulation: { percent: 65 }, intensification: { sets: 3, reps: 4, percent: 80, successes: 4 }
    },
    density: { reps: range(10), restSeconds: 90, restStep: 5, restFloor: 45 }
  }[preset]
  return { ...o, ...more }
}

const params = o => ({
  sets: copy(o.sets), reps: copy(o.reps), ...(o.durationSeconds ? { durationSeconds: copy(o.durationSeconds) } : {}), ...(o.speed ? { speed: o.speed } : {}),
  load: copy(o.load), ...(o.loadTo ? { loadTo: copy(o.loadTo) } : {}), ...(o.rir ? { rir: copy(o.rir) } : {}), restSeconds: o.restSeconds
})
const anchor = (percent = 100) => ({ basis: 'anchor', percent })
const plain = (more = {}) => ({ id: 'sets', count: 'parameters', reps: 'parameters', load: anchor(), ...more })
// v1 judged a session by sets and reps (or seconds), never by the load it was lifted at.
const V1_SUCCESS = { scope: 'all', load: 'ignore', effort: 'rir_floor' }
const NEW_SUCCESS = { scope: 'all', load: 'prescribed', effort: 'rir_floor' }
const phase = (id, o, more = {}) => ({ id, parameters: params(o), target: copy(o.target ?? NONE), groups: [plain()], success: V1_SUCCESS, progression: [], exit: null, ...more })
// v1 readSession.weight: the next load is built from what was lifted (`last_actual`); a new
// template steps from what it prescribed (`current`) and needs the prescribed load to succeed.
const loadOp = (o, more = {}) => ({ id: 'load', metric: 'load', when: 'success', basis: 'last_actual', step: copy(o.step), ...more })
const stallOf = (o, method, count = 'misses') => (o.deload ? { stall: { after: o.deload.after, count, recovery: { method, factor: o.deload.factor } } } : {})
const program = (o, phases, more = {}) => ({ phases, end: 'complete', completion: copy(o.completion), ...more })

// The unloaded rep ladder: after a clean session reps climb to the top of the range, then a set is
// added to the sets asked for (v1 bodyweight, `reached`), each climb one over the target asked for,
// never over what was done (v1 `goal`); named rungs then move to the next, harder
// variation and start over. Extra sets logged on top never move it (v1 #233).
function ladderPhase(o, id = 'ladder') {
  const climb = [
    { id: 'reps', metric: 'reps', when: 'success', basis: 'current', step: 1, resetOnCarry: true },
    { id: 'sets', metric: 'sets', when: 'success', step: 1, resetOnCarry: true },
    ...(o.rungs?.length ? [{ id: 'rung', metric: 'difficulty', when: 'success', step: 1, min: 0, max: o.rungs.length - 1, rungs: copy(o.rungs) }] : [])
  ]
  return phase(id, { ...o, load: { mode: 'empty' }, target: NONE }, { progression: climb })
}

// One load policy as a phase: the 13 v1-shaped templates and the regimes of a ladder share it.
function policyPhase(policy, o, id = 'plan') {
  if (policy === 'greyskull') {
    const n = o.sets.min
    return phase(id, o, {
      groups: [plain({ count: range(n - 1) }), plain({ id: 'amrap', count: range(1), amrap: true })],
      success: { ...V1_SUCCESS, effort: 'ignore' }, progression: [loadOp(o, { amrapDoubleAt: 2 })], ...stallOf(o, 'factor')
    })
  }
  if (policy === 'double') {
    return phase(id, o, {
      progression: [{ id: 'reps', metric: 'reps', when: 'worked', basis: 'last_actual', step: 1, resetOnCarry: true }, loadOp(o, { when: 'maximum' })],
      ...stallOf(o, 'epley_reps', 'misses_without_improvement')
    })
  }
  // Triple progression: a rep more after every clean session, then a set more, then the load.
  if (policy === 'triple') {
    return phase(id, o, {
      progression: [{ id: 'reps', metric: 'reps', when: 'success', step: 1, resetOnCarry: true, addedSetOnly: true }, { id: 'sets', metric: 'sets', when: 'success', step: 1, resetOnCarry: true }, loadOp(o)],
      ...stallOf(o, 'factor', 'misses_without_improvement')
    })
  }
  return phase(id, o, { progression: [loadOp(o)], ...stallOf(o, 'epley') })
}

// A load policy and the ladder it falls back to when nothing is loaded (v1 bodyweight on a
// loaded policy), or a ladder that turns into its policy once weight is added. The load logged
// decides the regime; entering the loaded one starts from what was lifted.
function regimes(o, policy, ladderFirst) {
  const ladder = ladderPhase({
    ...o, rungs: [],
    sets: range(o.sets.min, Math.max(o.sets.min, ladderFirst ? o.sets.max : LADDER_SETS)),
    reps: ladderFirst ? o.reps : range(o.reps.min, Math.max(o.reps.min, o.repCeiling ?? 20))
  })
  const loadedReps = policy === 'double' ? copy(o.loadedReps ?? o.reps) : range(o.reps.min)
  const loaded = policyPhase(policy, ladderFirst ? { ...o, sets: range(o.sets.min), reps: loadedReps, load: { mode: 'absolute', value: 0, unit: o.step.unit ?? 'kg' }, target: NONE, deload: defaultDeload(policy) } : o, policy)
  loaded.entry = { load: 'previous', reps: 'declared' }
  // Back on the ladder, the climb goes on from the reps the loaded session asked for (v1 `last.goal`).
  ladder.entry = { load: 'declared', reps: 'previous' }
  ladder.exit = { type: 'load_present', to: policy }
  loaded.exit = { type: 'load_absent', to: 'ladder' }
  return ladderFirst ? [ladder, loaded] : [loaded, ladder]
}

const BUILD = {
  autoregulated: o => program(o, [phase('plan', o)]),
  linear: o => program(o, o.unloadedLadder ? regimes(o, 'linear', false) : [policyPhase('linear', o)]),
  greyskull: o => program(o, o.unloadedLadder ? regimes(o, 'greyskull', false) : [policyPhase('greyskull', o)]),
  double: o => program(o, o.unloadedLadder ? regimes(o, 'double', false) : [policyPhase('double', o)]),
  triple: o => program(o, [policyPhase('triple', o)]),
  hold_seconds: o => program(o, [phase('plan', o, {
    progression: [{ id: 'seconds', metric: 'durationSeconds', when: 'maximum', step: o.step.value }], ...stallOf(o, 'factor')
  })]),
  bodyweight_ladder: o => program(o, o.loadedPreset ? regimes(o, o.loadedPreset, true) : [ladderPhase(o)]),
  pyramid_reps: o => program(o, [phase('plan', o, {
    groups: o.setReps.map((n, i) => ({
      id: `s${i + 1}`, count: range(1), reps: n === REPS_MAX ? range(0) : range(n), load: o.setWeights ? { basis: 'absolute', value: o.setWeights[i] || 0, unit: o.load.unit || o.step.unit || 'kg' } : anchor(),
      ...(n === REPS_MAX ? { max: true } : {}), ...(o.setRest?.[i] > 0 ? { restSeconds: o.setRest[i] } : {})
    }))
  })]),
  pyramid: o => offsetsProgram(o),
  five_three_one: o => program(o, o.cycleSets.map((week, w) => ({
    ...phase(`w${w + 1}`, { ...o, sets: range(week.length), target: NONE }),
    groups: week.map((s, i) => ({ id: `s${i + 1}`, count: range(1), reps: range(s.reps), load: { basis: 'training_max', percent: s.percentOfTM }, ...(s.amrap ? { amrap: true } : {}) })),
    exit: { type: 'exposures', count: 1 }
  })), { end: 'repeat', trainingMax: copy(o.trainingMax), cycleIncrement: copy(o.cycleIncrement) }),
  top_set_backoff: o => program(o, [phase('plan', { ...o, sets: range(1 + o.backoff.sets) }, {
    groups: [
      { id: 'top', count: range(1), reps: 'parameters', load: anchor(), restSeconds: o.restSeconds },
      { id: 'backoff', count: range(o.backoff.sets), reps: range(o.backoff.reps), load: anchor(o.backoff.percent), restSeconds: o.backoff.restSeconds }
    ],
    success: o.scope === 'top' ? { ...NEW_SUCCESS, scope: 'groups', groupIds: ['top'] } : NEW_SUCCESS,
    progression: [loadOp(o, { basis: 'current' })], ...stallOf(o, 'factor')
  })]),
  density: o => program(o, [phase('plan', o, {
    success: NEW_SUCCESS,
    progression: [{ id: 'rest', metric: 'restSeconds', when: 'success', step: o.restStep, direction: 'down', min: o.restFloor, max: o.restSeconds }]
  })]),
  accumulation_intensification: o => {
    const tmPhase = (id, sets, reps, percent, more) => ({
      ...phase(id, { ...o, sets: range(sets), reps, load: { mode: 'empty' }, target: NONE }, { success: NEW_SUCCESS }),
      groups: [{ id: 'sets', count: 'parameters', reps: 'parameters', load: { basis: 'training_max', percent } }], ...more
    })
    const i = o.intensification
    return program(o, [
      tmPhase('accumulation', o.sets.min, o.reps, o.accumulation.percent, { progression: [{ id: 'reps', metric: 'reps', when: 'success', step: 1 }], exit: { type: 'goal', metric: 'reps', target: o.reps.max } }),
      tmPhase('intensification', i.sets, range(i.reps), i.percent, { exit: { type: 'successes', count: i.successes } })
    ], { end: o.end, trainingMax: copy(o.trainingMax), cycleIncrement: copy(o.cycleIncrement) })
  }
}

function offsetsProgram(o) {
  const groups = o.offsets.map((x, i) => ({ id: `s${i + 1}`, count: range(1), reps: x.reps ? range(x.reps) : 'parameters', load: anchor(x.percentOfAnchor) }))
  return program(o, [phase('plan', o, {
    groups,
    // The anchor sets (100 %) decide the session; the lighter ones ride along.
    success: { ...V1_SUCCESS, scope: 'groups', groupIds: groups.filter(g => g.load.percent === 100).map(g => g.id) },
    progression: [loadOp(o)], ...stallOf(o, 'factor')
  })])
}

const defined = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

/** A valid rule for `preset`, from its defaults overridden by any template numbers given. */
export function defaultPlanRule(preset, { id, exerciseId, routineId = null, unit = 'kg', ...options } = {}) {
  const o = { ...templateDefaults(preset, unit, options.direction), ...defined(options) }
  return { id, revision: 1, routineId, exerciseId, preset, rounding: copy(o.rounding), program: BUILD[preset](o) }
}

/* ---------- reading a rule back as its template numbers ---------- */
const op = (ph, metric) => ph.progression.find(x => x.metric === metric) ?? null

/** The template numbers a rule was built from: defaultPlanRule(rule.preset, planOptions(rule)) is the rule again. */
export function planOptions(rule) {
  const pr = rule.program
  const regime = pr.phases.length === 2 && pr.phases.some(ph => ph.exit?.type === 'load_present')
  const ladderFirst = regime && pr.phases[0].exit.type === 'load_present'
  const main = pr.phases[0]
  const p = main.parameters
  // Optional numbers read back as null when absent, so a template default the planner removed stays removed.
  const o = { durationSeconds: null, speed: null, loadTo: null, rir: null, ...copy(p), target: copy(main.target), completion: copy(pr.completion), rounding: copy(rule.rounding) }
  const loadStep = op(main, 'load') ?? (regime ? op(pr.phases[1], 'load') : null)
  if (loadStep) o.step = copy(loadStep.step)
  if (op(main, 'durationSeconds')) o.step = { type: 'seconds', value: op(main, 'durationSeconds').step }
  o.deload = main.stall ? { after: main.stall.after, factor: main.stall.recovery.factor } : null
  const preset = rule.preset
  if (preset === 'bodyweight_ladder') {
    o.rungs = copy(op(main, 'difficulty')?.rungs ?? [])
    if (regime) {
      const loaded = pr.phases[1]
      o.loadedPreset = loaded.id
      if (loaded.id === 'double' && canonicalJSON(loaded.parameters.reps) !== canonicalJSON(p.reps)) o.loadedReps = copy(loaded.parameters.reps)
      o.step = copy(op(loaded, 'load').step)
    }
  }
  if (regime && !ladderFirst) { o.unloadedLadder = true; o.repCeiling = pr.phases[1].parameters.reps.max }
  if (preset === 'pyramid_reps') {
    o.setReps = main.groups.map(g => (g.max ? REPS_MAX : g.reps.min))
    if (main.groups.some(g => g.load.basis === 'absolute')) o.setWeights = main.groups.map(g => g.load.value || 0)
    if (main.groups.some(g => g.restSeconds > 0)) o.setRest = main.groups.map(g => g.restSeconds ?? 0)
  }
  if (preset === 'pyramid') o.offsets = main.groups.map(g => ({ percentOfAnchor: g.load.percent, ...(g.reps !== 'parameters' ? { reps: g.reps.min } : {}) }))
  if (preset === 'five_three_one') {
    o.cycleSets = pr.phases.map(ph => ph.groups.map(g => ({ percentOfTM: g.load.percent, reps: g.reps.min, ...(g.amrap ? { amrap: true } : {}) })))
  }
  if (pr.trainingMax) { o.trainingMax = copy(pr.trainingMax); o.cycleIncrement = copy(pr.cycleIncrement) }
  if (preset === 'top_set_backoff') {
    const [top, back] = main.groups
    o.scope = main.success.scope === 'groups' ? 'top' : 'all'
    o.restSeconds = top.restSeconds
    o.backoff = { sets: back.count.min, reps: back.reps.min, percent: back.load.percent, restSeconds: back.restSeconds }
  }
  if (preset === 'density') { const r = op(main, 'restSeconds'); o.restStep = r.step; o.restFloor = r.min; o.restSeconds = r.max }
  if (preset === 'accumulation_intensification') {
    const [a, i] = pr.phases
    Object.assign(o, { sets: copy(a.parameters.sets), reps: copy(a.parameters.reps), end: pr.end, accumulation: { percent: a.groups[0].load.percent } })
    o.intensification = { sets: i.parameters.sets.min, reps: i.parameters.reps.min, percent: i.groups[0].load.percent, successes: i.exit.count }
  }
  return defined(o)
}

/** True when the rule is exactly what its template builds from its own numbers (the editor can change it). */
export const isTemplateRule = rule => {
  try { return canonicalJSON({ ...defaultPlanRule(rule.preset, { id: rule.id, exerciseId: rule.exerciseId, routineId: rule.routineId, ...planOptions(rule) }), revision: rule.revision }) === canonicalJSON(rule) }
  catch { return false }
}

/** The rule with some template numbers changed, rebuilt by its template; its revision is the caller's to bump. */
export const editPlan = (rule, patch) => ({ ...defaultPlanRule(rule.preset, { id: rule.id, exerciseId: rule.exerciseId, routineId: rule.routineId, ...planOptions(rule), ...patch }), revision: rule.revision })

/** The rest every phase asks for, its groups' own rests and a progressed rest untouched (restFromProfile, Update routine). */
export const withRest = (rule, restSeconds) => ({ ...rule, program: { ...rule.program, phases: rule.program.phases.map(ph => ({ ...ph, parameters: { ...ph.parameters, restSeconds } })) } })

/** The phase a routine shows and edits: the first. */
export const planPhase = rule => rule.program.phases[0]

/** A cardio plan — v1's `{ sets, min, speed }`: intervals of `min` minutes, at `speed` km/h when given. */
export const cardioParameters = ({ sets, min, speed }) => ({
  sets: range(sets), reps: range(1), durationSeconds: range(min * 60), ...(speed > 0 ? { speed } : {})
})

/** True when generating from this rule needs the exercise's 1RM. */
export const needsOneRm = rule => rule.program.trainingMax?.mode === 'ninety_percent_1rm' || rule.program.phases.some(ph =>
  ph.parameters.load.mode === 'percent_1rm' || ph.target.mode === 'percent_1rm' || op(ph, 'load')?.step.type === 'snapshot_1rm_percent')

/* ---------- validation ---------- */
const UNITS = ['kg', 'lb']
const finite = Number.isFinite
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
const isRange = v => isObj(v) && finite(v.min) && finite(v.max)

function checkRange(errors, path, r, { min = 0, max = Infinity, integer = false } = {}) {
  if (!isRange(r)) { errors.push(`${path}: min and max must be finite numbers`); return }
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

function checkRounding(errors, r) {
  if (r?.mode === 'allowed_values') {
    const vs = r.allowedValues
    if (!Array.isArray(vs) || !vs.length || !vs.every(finite) || vs.some((v, i) => i > 0 && v <= vs[i - 1])) errors.push('rounding.allowedValues must be finite, strictly ascending and non-empty')
  } else if (!['nearest', 'up', 'down'].includes(r?.mode) || !(finite(r.step) && r.step > 0)) {
    errors.push('rounding needs mode nearest/up/down and a step > 0, or mode allowed_values')
  }
}

const amount = v => isObj(v) && finite(v.value) && v.value >= 0 && UNITS.includes(v.unit)

function checkParameters(errors, at, p) {
  if (!isObj(p)) { errors.push(`${at}.parameters is required`); return }
  checkRange(errors, `${at}.parameters.sets`, p.sets, { min: 1, integer: true })
  checkRange(errors, `${at}.parameters.reps`, p.reps, { integer: true })
  if (p.durationSeconds !== undefined) checkRange(errors, `${at}.parameters.durationSeconds`, p.durationSeconds)
  if (p.rir !== undefined) checkRange(errors, `${at}.parameters.rir`, p.rir, { max: 10 })
  if (!(finite(p.restSeconds) && p.restSeconds >= 0)) errors.push(`${at}.parameters.restSeconds is required and must be ≥ 0`)
  checkExpression(errors, `${at}.parameters.load`, p.load, ['absolute', 'percent_1rm', 'empty'])
  if (p.loadTo !== undefined) {
    const n = errors.length
    checkExpression(errors, `${at}.parameters.loadTo`, p.loadTo, ['absolute', 'percent_1rm'])
    if (errors.length === n) {
      if (p.load?.mode !== p.loadTo.mode) errors.push(`${at}.parameters.loadTo needs a load of the same mode`)
      else if (p.loadTo.mode === 'absolute' && p.loadTo.unit !== p.load.unit) errors.push(`${at}.parameters.loadTo.unit must match parameters.load.unit`)
      else if (p.loadTo.mode === 'absolute' ? p.loadTo.value < p.load.value : p.loadTo.percent < p.load.percent) errors.push(`${at}.parameters.loadTo must not be below parameters.load`)
    }
  }
  if (p.speed !== undefined) {
    if (!(finite(p.speed) && p.speed > 0)) errors.push(`${at}.parameters.speed must be a number > 0`)
    else if (!p.durationSeconds) errors.push(`${at}.parameters.speed needs parameters.durationSeconds`)
  }
}

function checkGroups(errors, at, ph, hasTM) {
  const groups = ph.groups
  if (!Array.isArray(groups) || !groups.length || groups.length > MAX_GROUPS) { errors.push(`${at}.groups must hold 1 to ${MAX_GROUPS} groups`); return }
  const ids = new Set()
  let rows = 0
  groups.forEach((g, i) => {
    const gat = `${at}.groups[${i}]`
    if (!isObj(g) || typeof g.id !== 'string' || !g.id) { errors.push(`${gat}.id is required`); return }
    if (ids.has(g.id)) errors.push(`${gat}.id "${g.id}" is duplicated`)
    ids.add(g.id)
    if (g.count !== 'parameters') checkRange(errors, `${gat}.count`, g.count, { integer: true })
    if (g.reps !== 'parameters') checkRange(errors, `${gat}.reps`, g.reps, { integer: true, max: 1000 })
    rows += g.count === 'parameters' ? (isRange(ph.parameters?.sets) ? ph.parameters.sets.max : 0) : (isRange(g.count) ? g.count.max : 0)
    const l = g.load
    const okLoad = isObj(l) && (l.basis === 'empty' || (l.basis === 'absolute' && finite(l.value) && l.value >= 0 && UNITS.includes(l.unit)) || (['anchor', 'training_max'].includes(l.basis) && finite(l.percent) && l.percent > 0 && l.percent <= 1000))
    if (!okLoad) errors.push(`${gat}.load must be anchor/training_max with percent > 0, absolute with value ≥ 0 and unit, or empty`)
    else if (l.basis === 'training_max' && !hasTM) errors.push(`${gat}.load needs program.trainingMax`)
    if (g.restSeconds !== undefined && !(Number.isInteger(g.restSeconds) && g.restSeconds >= 0 && g.restSeconds <= 3600)) errors.push(`${gat}.restSeconds must be 0 to 3600 seconds`)
    for (const k of ['amrap', 'max']) if (g[k] !== undefined && typeof g[k] !== 'boolean') errors.push(`${gat}.${k} must be boolean`)
    // A set's own rep target (a pyramid set, a 5/3/1 set) asks for at least one rep, and only in reps work.
    if (g.reps !== 'parameters' || g.max) {
      if (ph.parameters?.durationSeconds) errors.push(`${gat}: reps of its own are for reps work, not timed work`)
      else if (!g.max && isRange(g.reps) && g.reps.min < 1) errors.push(`${gat}.reps must ask for at least one rep`)
    }
  })
  if (rows < 1 || rows > MAX_ROWS) errors.push(`${at}.groups must resolve to 1 to ${MAX_ROWS} rows`)
  const s = ph.success
  if (!isObj(s) || !['all', 'groups'].includes(s.scope) || !['ignore', 'prescribed'].includes(s.load) || !['ignore', 'rir_floor'].includes(s.effort)) {
    errors.push(`${at}.success needs scope all|groups, load ignore|prescribed and effort ignore|rir_floor`)
  } else if (s.scope === 'groups' && !(Array.isArray(s.groupIds) && s.groupIds.length && s.groupIds.every(id => ids.has(id)))) {
    errors.push(`${at}.success.groupIds must name groups of this phase`)
  }
}

function checkOperators(errors, at, ph) {
  const ops = ph.progression
  if (!Array.isArray(ops) || ops.length > MAX_OPERATORS) { errors.push(`${at}.progression must hold at most ${MAX_OPERATORS} operators`); return }
  const p = ph.parameters || {}
  const metrics = new Set()
  ops.forEach((o, i) => {
    const oat = `${at}.progression[${i}]`
    if (!isObj(o) || !OPERATOR_METRICS.includes(o.metric)) { errors.push(`${oat}.metric must be one of ${OPERATOR_METRICS.join(', ')}`); return }
    if (metrics.has(o.metric)) errors.push(`${oat}: ${o.metric} is progressed twice`)
    metrics.add(o.metric)
    if (!['success', 'maximum', 'worked'].includes(o.when)) errors.push(`${oat}.when must be success, maximum or worked`)
    if (o.basis !== undefined && !['current', 'last_actual'].includes(o.basis)) errors.push(`${oat}.basis must be current or last_actual`)
    if (o.direction !== undefined && !['up', 'down'].includes(o.direction)) errors.push(`${oat}.direction must be up or down`)
    if (o.addedSetOnly !== undefined && (o.metric !== 'reps' || typeof o.addedSetOnly !== 'boolean')) errors.push(`${oat}.addedSetOnly is a boolean for a reps step`)
    if (o.resetOnCarry !== undefined && typeof o.resetOnCarry !== 'boolean') errors.push(`${oat}.resetOnCarry must be boolean`)
    for (const k of ['min', 'max']) if (o[k] !== undefined && !(finite(o[k]) && o[k] >= 0)) errors.push(`${oat}.${k} must be a finite number ≥ 0`)
    if (finite(o.min) && finite(o.max) && o.min > o.max) errors.push(`${oat}: min is above max`)
    if (o.metric === 'load') {
      const inc = o.step
      if (!isObj(inc) || !INCREMENT_TYPES.includes(inc.type)) errors.push(`${oat}.step.type is not supported`)
      else {
        if (!(finite(inc.value) && inc.value >= 0)) errors.push(`${oat}.step.value must be a finite number ≥ 0`)
        if (inc.type === 'absolute' && !UNITS.includes(inc.unit)) errors.push(`${oat}.step.unit must be kg or lb`)
        if ((inc.type === 'percentage_points') !== (p.load?.mode === 'percent_1rm')) errors.push('a percent_1rm load progresses in percentage_points, and only it')
        if (inc.type === 'target_load_percent' && ph.target?.mode === 'none') errors.push('target_load_percent needs a target')
      }
      if (p.load?.mode === 'empty') errors.push(`${at}: a load step needs a starting load`)
      if (p.loadTo !== undefined) errors.push(`${at}.parameters.loadTo: a load range cannot be stepped automatically`)
      if (o.amrapDoubleAt !== undefined && !(finite(o.amrapDoubleAt) && o.amrapDoubleAt > 1)) errors.push(`${oat}.amrapDoubleAt must be a number > 1`)
    } else {
      if (!(finite(o.step) && o.step >= 0)) errors.push(`${oat}.step must be a finite number ≥ 0`)
      if (o.amrapDoubleAt !== undefined) errors.push(`${oat}.amrapDoubleAt is for a load step`)
    }
    if (o.metric === 'durationSeconds' && !p.durationSeconds) errors.push(`${oat}: seconds need parameters.durationSeconds`)
    if ((o.metric === 'restSeconds' || o.metric === 'difficulty') && !(finite(o.min) && finite(o.max))) errors.push(`${oat}: ${o.metric} needs min and max`)
    if (o.metric === 'difficulty') {
      if (!(Array.isArray(o.rungs) && o.rungs.length && o.rungs.every(x => typeof x === 'string' && x.trim()))) errors.push(`${oat}.rungs must be non-empty names`)
      else if (o.max !== o.rungs.length - 1) errors.push(`${oat}.max must be the last rung`)
    } else if (o.rungs !== undefined) errors.push(`${oat}.rungs belong to a difficulty step`)
  })
}

function checkPhase(errors, at, ph, hasTM) {
  if (!isObj(ph)) { errors.push(`${at} must be an object`); return }
  if (typeof ph.id !== 'string' || !ph.id) errors.push(`${at}.id is required`)
  checkParameters(errors, at, ph.parameters)
  checkExpression(errors, `${at}.target`, ph.target, ['absolute', 'percent_1rm', 'none'])
  if (ph.parameters?.load?.mode === 'absolute' && ph.target?.mode === 'absolute' && ph.parameters.load.unit !== ph.target.unit) errors.push(`${at}.target.unit must match parameters.load.unit`)
  checkGroups(errors, at, ph, hasTM)
  checkOperators(errors, at, ph)
  if (ph.prefill !== undefined && !['plan', 'last'].includes(ph.prefill)) errors.push(`${at}.prefill must be plan or last`)
  if (ph.entry !== undefined && !(isObj(ph.entry) && ['declared', 'previous'].includes(ph.entry.load) && ['declared', 'last_actual', 'previous'].includes(ph.entry.reps))) errors.push(`${at}.entry needs load declared|previous and reps declared|last_actual|previous`)
  const s = ph.stall
  if (s !== undefined) {
    if (!isObj(s) || !isObj(s.recovery)) errors.push(`${at}.stall must be { after, count, recovery }`)
    else {
      if (!(Number.isInteger(s.after) && s.after >= 1 && s.after <= 10)) errors.push(`${at}.stall.after must be a whole number of sessions from 1 to 10`)
      if (!['misses', 'misses_without_improvement'].includes(s.count)) errors.push(`${at}.stall.count must be misses or misses_without_improvement`)
      if (!RECOVERY_METHODS.includes(s.recovery.method)) errors.push(`${at}.stall.recovery.method must be one of ${RECOVERY_METHODS.join(', ')}`)
      if (!isValidDeloadFactor(s.recovery.factor)) errors.push(`${at}.stall.recovery.factor must be between ${DELOAD_FACTOR_MIN} and ${DELOAD_FACTOR_MAX}`)
      if (!ph.progression?.some(o => o.metric === 'load' || o.metric === 'durationSeconds')) errors.push(`${at}: only a phase that steps load or seconds can back off`)
    }
  }
}

function checkExit(errors, at, exit, ids, last) {
  if (exit == null) { if (!last) errors.push(`${at}.exit is required: a phase before the last must end`); return }
  const types = ['exposures', 'successes', 'goal', 'load_present', 'load_absent']
  if (!isObj(exit) || !types.includes(exit.type)) { errors.push(`${at}.exit.type must be one of ${types.join(', ')}`); return }
  if (['exposures', 'successes'].includes(exit.type) && !(Number.isInteger(exit.count) && exit.count >= 1)) errors.push(`${at}.exit.count must be a whole number ≥ 1`)
  if (exit.type === 'goal' && !(['reps', 'sets', 'durationSeconds'].includes(exit.metric) && finite(exit.target) && exit.target >= 0)) errors.push(`${at}.exit goal needs metric reps|sets|durationSeconds and a target ≥ 0`)
  if (exit.to !== undefined && !ids.includes(exit.to)) errors.push(`${at}.exit.to must name a phase`)
}

export function validatePlanRule(rule) {
  if (!isObj(rule) || !PRESETS[rule.preset]) return { ok: false, errors: [`preset "${rule?.preset}" is not a preset`] }
  const errors = []
  if (typeof rule.id !== 'string' || !rule.id) errors.push('id is required')
  if (!Number.isInteger(rule.revision) || rule.revision < 1) errors.push('revision must be a positive integer')
  if (typeof rule.exerciseId !== 'string' || !rule.exerciseId) errors.push('exerciseId is required')
  checkRounding(errors, rule.rounding)
  const pr = rule.program
  if (!isObj(pr) || !Array.isArray(pr.phases) || !pr.phases.length || pr.phases.length > MAX_PHASES) {
    errors.push(`program.phases must hold 1 to ${MAX_PHASES} phases`)
    return { ok: false, errors }
  }
  if (!['complete', 'repeat'].includes(pr.end)) errors.push('program.end must be complete or repeat')
  const tm = pr.trainingMax
  if (tm !== undefined && !(tm?.mode === 'ninety_percent_1rm' || (tm?.mode === 'direct' && finite(tm.value) && tm.value > 0 && UNITS.includes(tm.unit)))) errors.push('program.trainingMax must be direct {value, unit} or ninety_percent_1rm')
  if (pr.cycleIncrement !== undefined && !amount(pr.cycleIncrement)) errors.push('program.cycleIncrement must be {value ≥ 0, unit}')
  const ids = pr.phases.map(ph => ph?.id)
  ids.forEach((id, i) => { if (ids.indexOf(id) !== i) errors.push(`program.phases[${i}].id "${id}" is duplicated`) })
  pr.phases.forEach((ph, i) => {
    checkPhase(errors, `program.phases[${i}]`, ph, !!tm)
    if (isObj(ph)) checkExit(errors, `program.phases[${i}]`, ph.exit, ids, i === pr.phases.length - 1)
  })
  if (!Array.isArray(pr.completion)) errors.push('program.completion must be a list')
  const completion = Array.isArray(pr.completion) ? pr.completion : []
  const metrics = completion.map(c => c?.metric)
  metrics.filter((m, i) => metrics.indexOf(m) !== i).forEach(m => errors.push(`completion metric "${m}" is listed twice`))
  const phases = pr.phases.filter(isObj)
  completion.forEach(c => {
    if (!COMPLETION_METRICS.includes(c?.metric)) { errors.push(`completion metric "${c?.metric}" is not supported`); return }
    if (c.metric === 'target_load' && phases.every(ph => ph.target?.mode === 'none')) errors.push('target_load needs a target')
    if (c.metric === 'max_duration' && !phases.some(ph => ph.parameters?.durationSeconds)) errors.push('max_duration needs parameters.durationSeconds')
    // A sliding seconds window has no fixed top, so stopping there needs a number.
    const slides = phases.some(ph => ph.progression?.some(o => o.metric === 'durationSeconds'))
    if (c.metric === 'max_duration' && (c.target != null || slides) && !(finite(c.target) && c.target > 0)) errors.push('max_duration target must be a number > 0')
    if (c.metric === 'cycle_count' && !(Number.isInteger(c.target) && c.target >= 1)) errors.push('cycle_count needs a whole target ≥ 1')
    if (c.metric === 'training_max' && !(finite(c.target) && c.target > 0 && tm)) errors.push('training_max needs a target > 0 and a training max')
    if (c.metric === 'difficulty_rung' && !phases.some(ph => ph.progression?.some(o => o.metric === 'difficulty'))) errors.push('difficulty_rung needs named rungs')
    if (c.metric === 'rest_floor' && !(finite(c.target) && c.target >= 0 && phases.some(ph => ph.progression?.some(o => o.metric === 'restSeconds')))) errors.push('rest_floor needs a rest step and a target ≥ 0')
  })
  return { ok: errors.length === 0, errors }
}

/** What an occurrence's optional extras can attach to. A ramp or a drop needs a load to scale
 *  and reps to count, so timed and unloaded rules have none; rest-pause replaces the whole set
 *  list, so a program that shapes its own rows (percentages, AMRAP, a ladder) cannot take it. */
export function supports(rule) {
  const pr = rule.program, ph = pr.phases[0]
  const usable = !ph.parameters.durationSeconds && (ph.parameters.load.mode !== 'empty' || !!pr.trainingMax || ph.groups.some(g => g.load.basis === 'absolute' && g.load.value > 0))
  const ladder = pr.phases.some(x => x.progression.some(o => o.metric === 'sets' || o.metric === 'difficulty') || x.exit?.type === 'load_present')
  // Pyramid sets already give every set its own target: a drop or a rest-pause would reshape them again.
  const perSet = ph.groups.length > 1 && ph.groups.every(g => (g.load.basis === 'anchor' && g.load.percent === 100) || g.load.basis === 'absolute') && ph.groups.some(g => g.reps !== 'parameters' || g.max)
  const single = ph.groups.length === 1 && pr.phases.length === 1 && ph.groups[0].count === 'parameters' && !ph.groups[0].amrap && ph.groups[0].load.basis === 'anchor' && ph.groups[0].load.percent === 100
  return { warmup: usable, dropset: usable && !perSet && !ladder, restpause: usable && single && !ladder }
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
