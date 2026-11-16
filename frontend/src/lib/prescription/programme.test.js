// Programme definitions (docs/superpowers/specs/2026-11-04-programme-coach-effort-v2-design.md):
// a track's stages compile, one occurrence at a time, into ordinary plan rules, and a slot's saved
// work reads back as one outcome. Rounding is nearest 0.5 kg unless a test says otherwise.
import { describe, expect, it } from 'vitest'
import { OPTION_CLASSES, advanceProgression, cardioParameters, defaultPlanRule, generatePrescription, resolveProgressionContext, slotOutcome, stageRule, summarizeActual, validateProgramme, verdictOf, weeklyTemplate } from './index.js'
import { readFileSync } from 'node:fs'

const NOW = '2026-11-04T10:00:00.000Z'
const OID = 'rA:o0'
const ROUNDING = { mode: 'nearest', step: 0.5 }
const range = (min, max = min) => ({ min, max })
const counts = v => (typeof v === 'number' ? range(v) : v)
const abs = value => ({ mode: 'absolute', value, unit: 'kg' })
const kg = value => ({ value, unit: 'kg' })
const anchor = (percent = 100) => ({ basis: 'anchor', percent })
const plain = { id: 'sets', count: 'parameters', reps: 'parameters', load: anchor() }
const INHERIT = { own: 'inherit' }

// The occurrence the programme binds: bench, linear, already at 80 kg before the programme.
const occRule = (preset = 'linear', options = {}) => defaultPlanRule(preset, { id: 'occ', exerciseId: 'bench', routineId: 'rA', unit: 'kg', load: abs(80), rounding: ROUNDING, ...options })
// One authored week: fixed sets × reps at a load, no operator unless `more` gives one.
const week = ({ sets = 3, reps = 8, load = abs(60), restSeconds = 90, ...params } = {}, more = {}) => ({
  id: 'week', parameters: { sets: counts(sets), reps: counts(reps), load, restSeconds, ...params }, target: { mode: 'none' }, groups: [plain],
  success: { scope: 'all', load: 'ignore', effort: 'rir_floor' }, progression: [], exit: null, ...more
})
const stage = (id, target, more = {}) => ({ id, kind: 'work', ...more, targets: { [OID]: target } })
const set = (phase, more = {}) => ({ own: 'set', phase, ...more })
const trackOf = (stages, more = {}) => ({ id: 'bench', exerciseId: 'bench', slots: [{ rid: 'rA', oid: OID }], stages, refs: 'inherit', ...more })
const defOf = (tracks, more = {}) => ({
  id: 'pg', name: 'Block', at: 0, rev: 3, schedule: { mode: 'weeks', appts: [{ rid: 'rA', day: 1 }] }, duration: { n: 4, unit: 'weeks' },
  end: 'stop', refs: 'inherit', tracks, ...more
})
const occurrence = (rule = occRule(), more = {}) => ({ occurrenceId: OID, exerciseId: 'bench', mode: 'reps', rule, ...more })
const routinesOf = (...ex) => [{ id: 'rA', ex: ex.length ? ex : [occurrence()] }]
// What stageRule is called with for a stage of a one-track programme.
const ctxOf = (stages, { rule = occRule(), track = {} } = {}) => {
  const t = trackOf(stages, track)
  return { def: defOf([t]), track: t, oid: OID, occRule: rule, runId: 'run1' }
}
const compile = (target, options) => { const s = [stage('w1', target)]; return stageRule({ ...ctxOf(s, options), stage: s[0] }) }
const validate = (stages, { routines = routinesOf(), def = {}, track = {} } = {}) => validateProgramme(defOf([trackOf(stages, track)], def), { routines })
const gen = (rule, extra = {}) => generatePrescription({ id: 'p1', now: NOW, trackId: 't1', rule, ...extra })

// A saved exposure as finish-session writes it: the summary, and one performance row per set done.
const performanceRow = s => ({
  prescribed: true, setId: 'r' + s.row, role: 'work', status: 'completed',
  observations: [
    ...(s.reps != null ? [{ metric: 'repetitions', unit: 'reps', value: s.reps }] : []),
    ...(s.durationSeconds != null ? [{ metric: 'duration', unit: 's', value: s.durationSeconds }] : []),
    ...(s.speed != null ? [{ metric: 'speed', unit: 'kmh', value: s.speed }] : [])
  ],
  resistance: s.load ? { kind: 'external-load', ...s.load } : { kind: 'bodyweight' },
  ...(s.rir != null ? { rir: s.rir } : {}), ...(s.limb ? { side: s.limb } : {}), ...(s.failure ? { failure: true } : {}), ...(s.max ? { max: true } : {}),
  segments: []
})
const saved = (p, performed) => ({ actual: summarizeActual(p, performed), performance: { sets: performed.map(performanceRow) } })

// Drives a rule session after session, every set done exactly at its aim, the way the app does.
function sessions(rule, n) {
  let state = null, last = null, log = null
  return Array.from({ length: n }, (_, k) => {
    const p = gen(rule, { id: 'p' + k, state, lastPrescription: last, lastLog: log })
    const aims = p.rows.map(r => r.reps.min)
    log = { id: 'x' + k, ...saved(p, p.rows.map((r, i) => ({ row: i, reps: r.reps.min, load: r.load }))) }
    state = advanceProgression({ state, prescription: p, log, now: NOW })
    last = p
    return `${aims.every(r => r === aims[0]) ? `${aims.length}x${aims[0]}` : aims.join('/')}@${p.rows[0].load.value}`
  })
}

// One programme track driven across its stages ([stage, sessions] pairs) the way the app drives a
// track: resolve the context, generate, every set done at its aim, advance. Each session's row loads.
function across(rule, plan) {
  const ctx = ctxOf(plan.map(([s]) => s), { rule })
  const workouts = [], prescriptions = {}, progression = {}, out = []
  for (const [s, n] of plan) {
    for (let k = 0; k < n; k++) {
      const i = out.length
      const r = stageRule({ ...ctx, stage: s })
      const c = resolveProgressionContext({ trackId: 't', exerciseId: 'bench', rule: r, workouts, prescriptions, progression })
      const p = gen(r, { id: 'p' + i, trackId: 't', state: c.state, lastPrescription: c.lastPrescription, lastLog: c.baseline && { ...c.baseline, id: c.baseline.exposureId }, reset: c.reset, heldLoad: c.heldLoad })
      const x = { exposureId: 'x' + i, exerciseId: 'bench', trackId: 't', prescriptionId: p.id, ...saved(p, p.rows.map((row, j) => ({ row: j, reps: row.reps.min, load: row.load }))) }
      prescriptions[p.id] = p
      progression.t = advanceProgression({ state: progression.t ?? null, prescription: p, log: { id: x.exposureId, actual: x.actual, performance: x.performance }, now: NOW })
      workouts.push({ id: 'w' + i, d: `2026-11-${String(i + 1).padStart(2, '0')}`, start: i, exposures: [x] })
      out.push(p.rows.map(row => row.load.value).join('/'))
    }
  }
  return out
}

describe('stageRule', () => {
  it('explicit weeks resolve per group without hidden steps (spec 12.1)', () => {
    const weeks = [
      stage('w1', set(week({ sets: 3, reps: 10, load: abs(60), restSeconds: 90 }))),
      stage('w2', set(week({ sets: 4, reps: 8, load: abs(65), restSeconds: 120 }))),
      stage('w3', set(week({ sets: 4, load: abs(70) }, { groups: [{ id: 'top', count: range(1), reps: range(6), load: anchor() }, { id: 'back', count: range(3), reps: range(8), load: anchor(90) }] }))),
      stage('w4', set(week({ sets: 2, reps: 8, load: { mode: 'percent_1rm', percent: 60 } })), { kind: 'recovery' })
    ]
    const ctx = ctxOf(weeks)
    const [w1, w2, w3, w4] = weeks.map(s => stageRule({ ...ctx, stage: s }))
    expect(w3).toMatchObject({ id: 'occ~run1~w3', revision: 3, preset: 'linear', exerciseId: 'bench', rounding: ROUNDING })
    expect(gen(w1).rows.map(r => `${r.reps.min}@${r.load.value}`)).toEqual(['10@60', '10@60', '10@60'])
    expect(gen(w2).parameters.restSeconds).toBe(120)
    expect(gen(w3).rows.map(r => r.load.value)).toEqual([70, 63, 63, 63])
    expect(gen(w3).rows.map(r => r.reps.min)).toEqual([6, 8, 8, 8])
    for (const r of [w1, w2, w3, w4]) expect(r.program).toMatchObject({ end: 'complete', completion: [], phases: [{ progression: [], exit: null }] })
    expect(gen(w4, { oneRm: kg(100) }).rows.map(r => r.load.value)).toEqual([60, 60])
    // A clean week 3 earns nothing: the next session of it is the same 70/63.
    const p = gen(w3)
    const state = advanceProgression({ state: null, prescription: p, log: { id: 'l1', actual: { sets: 4, reps: 6, load: kg(70) } }, now: NOW })
    expect(gen(w3, { id: 'p2', state, lastPrescription: p }).rows.map(r => r.load.value)).toEqual([70, 63, 63, 63])
  })

  it('weekly 5/3/1 resolves against its training max (spec 12.3)', () => {
    const weeks = weeklyTemplate('five_three_one', { oid: OID, unit: 'kg', tm: kg(90), occRule: occRule() })
    const ctx = ctxOf(weeks, { track: { tm: { value: 90, unit: 'kg', increment: 2.5 } } })
    expect(weeks).toHaveLength(4)
    expect(weeks[3].cycleEnd).toBe(true)
    expect(weeks.slice(0, 3).some(w => w.cycleEnd)).toBe(false)
    expect(gen(stageRule({ ...ctx, stage: weeks[0] })).rows.map(r => r.load.value)).toEqual([58.5, 67.5, 76.5])
    expect(gen(stageRule({ ...ctx, stage: weeks[1] })).rows.map(r => r.reps.min)).toEqual([3, 3, 3])
    // Each week is a stage of its own: no session cursor inside it walks on to the next week.
    const w1 = stageRule({ ...ctx, stage: weeks[0] })
    expect(w1.program).toMatchObject({ trainingMax: { mode: 'direct', value: 90, unit: 'kg' }, phases: [{ id: 'w1', exit: null, progression: [] }] })
    expect(w1.program.cycleIncrement).toBeUndefined()
    expect(gen(w1).rows.at(-1).amrap).toBe(true)
  })

  it('triple keeps its session sequence as a standalone rule (spec 12.2)', () => {
    const triple = occRule('triple', { sets: range(3, 4), reps: range(8, 10), load: abs(60), step: { type: 'absolute', value: 2.5, unit: 'kg' } })
    const rule = compile(INHERIT, { rule: triple })
    expect(rule.program).toEqual(triple.program)
    expect(sessions(rule, 7)).toEqual(['3x8@60', '3x9@60', '3x10@60', '10/10/10/8@60', '10/10/10/9@60', '4x10@60', '3x8@62.5'])
  })

  it('converting triple to fixed weeks removes every operator unless kept', () => {
    const triple = occRule('triple', { sets: range(3, 4), reps: range(8, 10), load: abs(60), step: { type: 'absolute', value: 2.5, unit: 'kg' } })
    const copies = weeklyTemplate('copy', { oid: OID, occRule: triple, n: 4 })
    expect(copies.map(s => s.targets[OID].phase.progression)).toEqual([[], [], [], []])
    const loads = [60, 65, 70, 60]
    const weeks = copies.map((s, i) => {
      const ph = s.targets[OID].phase
      return stage(s.id, set({ ...ph, parameters: { ...ph.parameters, sets: range(3), reps: range(8), load: abs(loads[i]) } }))
    })
    const ctx = ctxOf(weeks, { rule: triple })
    weeks.forEach((s, i) => {
      const rule = stageRule({ ...ctx, stage: s })
      expect(rule.program.phases[0].progression).toEqual([])
      expect(gen(rule).rows.map(r => `${r.reps.min}@${r.load.value}`)).toEqual(Array(3).fill(`8@${loads[i]}`))
    })
    expect(validate(weeks, { routines: routinesOf(occurrence(triple)) })).toEqual({ ok: true, errors: [] })
    // Kept on purpose: the week lists the step it keeps, and only that one runs.
    const reps = triple.program.phases[0].progression.find(op => op.metric === 'reps')
    const kept = stage('k', set({ ...weeks[0].targets[OID].phase, progression: [reps] }))
    expect(stageRule({ ...ctx, stage: kept }).program.phases[0].progression).toEqual([reps])
  })

  it('operational RPE 8 is a floor of 2 RIR; advisory changes nothing', () => {
    const operational = compile({ own: 'inherit', effort: { mode: 'operational', rpe: 8 } })
    expect(operational.program.phases[0].parameters.rir).toEqual({ min: 2, max: 10 })
    expect(operational.program.phases[0].success.effort).toBe('rir_floor')
    expect(gen(operational).parameters.rir).toEqual({ min: 2, max: 10 })
    expect(compile({ own: 'inherit', effort: { mode: 'advisory', rpe: 8 } })).toEqual(compile(INHERIT))
    expect(validate([stage('w1', { own: 'inherit', effort: { mode: 'operational', rpe: 8 } })]).ok).toBe(true)
  })

  it('a seeded load carries on into the later stages that keep its step', () => {
    const plan = [[stage('w1', set(week({ load: abs(60) }))), 1], [stage('w2', { own: 'inherit', seed: { load: 'copy' } }), 2], [stage('w3', INHERIT), 1]]
    expect(validate(plan.map(([s]) => s))).toEqual({ ok: true, errors: [] })
    // Never the occurrence's own 80: week 3 goes on from where week 2 left the track.
    expect(across(occRule(), plan)).toEqual(['60/60/60', '60/60/60', '62.5/62.5/62.5', '65/65/65'])
  })

  it('a fixed-reps week that keeps the load step opens at its own load, or carries on in the same phase', () => {
    const step = occRule().program.phases[0].progression   // the occurrence's +2.5 kg
    const kept = id => [stage('w2', set(week({ sets: 3, reps: 5, load: abs(70) }, { id, progression: step }))), 1]
    const plan = id => [[stage('w1', INHERIT), 2], kept(id)]
    expect(validate(plan('week').map(([s]) => s))).toEqual({ ok: true, errors: [] })
    // Its own phase: the engine starts that phase over, at the week's visible 70, never the occurrence's 80.
    expect(across(occRule(), plan('week'))).toEqual(['80/80/80', '82.5/82.5/82.5', '70/70/70'])
    // The occurrence's phase: the same step carries the progressed 85 on.
    expect(across(occRule(), plan('plan'))).toEqual(['80/80/80', '82.5/82.5/82.5', '85/85/85'])
  })

  it('a deload or recovery week scales from the progressed value and the next week goes on from it', () => {
    const climb = [stage('w1', INHERIT), 2]
    const deload = [stage('d', { own: 'inherit', deload: { factor: 0.9 } }, { kind: 'recovery' }), 1]
    const fixed = [stage('r', set(week({ sets: 2, load: abs(60) })), { kind: 'recovery' }), 1]
    const next = [stage('w2', INHERIT), 1]
    // 0.9 × 85, not × the starting 80; the light week earns no step and loses none.
    expect(across(occRule(), [climb, deload, next])).toEqual(['80/80/80', '82.5/82.5/82.5', '76.5/76.5/76.5', '85/85/85'])
    expect(across(occRule(), [climb, fixed, next])).toEqual(['80/80/80', '82.5/82.5/82.5', '60/60', '85/85/85'])
  })

  it('a deload scales anchor, training-max and absolute loads once; nothing to scale is rejected', () => {
    const deload = factor => ({ own: 'inherit', deload: { factor } })
    const linear = compile(deload(0.9))
    expect(linear.program.adaptive).toBe(false)
    expect(linear.program.phases[0].progression).toEqual(occRule().program.phases[0].progression)
    expect(gen(linear).rows.map(r => r.load.value)).toEqual([72, 72, 72])
    const wendler = occRule('five_three_one', { trainingMax: { mode: 'direct', value: 100, unit: 'kg' } })
    const half = gen(compile(deload(0.5), { rule: wendler }))
    expect(half.rows.map(r => r.load.value)).toEqual([32.5, 37.5, 42.5])
    expect(half.trainingMax).toEqual(kg(100))
    const pyramid = occRule('pyramid_reps', { setReps: [10, 8], setWeights: [100, 80] })
    expect(gen(compile(deload(0.9), { rule: pyramid })).rows.map(r => r.load.value)).toEqual([90, 72])
    const recovery = rule => validate([stage('d', deload(0.5), { kind: 'recovery' })], { routines: routinesOf(occurrence(rule)) })
    expect(recovery(wendler)).toEqual({ ok: true, errors: [] })
    expect(recovery(pyramid)).toEqual({ ok: true, errors: [] })
    expect(recovery(occRule('bodyweight_ladder')).errors).toEqual([expect.stringMatching(/deload needs a load to scale/)])
  })

  it('a fixed week is used exactly: the occurrence goal caps nothing (spec 9)', () => {
    const [copied] = weeklyTemplate('copy', { oid: OID, occRule: occRule(), n: 1 })   // linear: a 100 kg goal
    const ph = copied.targets[OID].phase
    const heavy = [stage('w1', set({ ...ph, parameters: { ...ph.parameters, load: abs(110) } }))]
    expect(validate(heavy)).toEqual({ ok: true, errors: [] })
    expect(gen(stageRule({ ...ctxOf(heavy), stage: heavy[0] })).rows.map(r => r.load.value)).toEqual([110, 110, 110])
    expect(gen(compile(set(week({ load: abs(110) }, { target: abs(100) })))).rows.map(r => r.load.value)).toEqual([110, 110, 110])
  })

  it('explicit zero rest and a 0% incline survive compile; absent values inherit', () => {
    const run = occRule('manual', { ...cardioParameters({ sets: 3, min: 5, speed: 8 }), load: { mode: 'empty' }, restSeconds: 90 })
    const flat = week({ sets: 3, reps: 1, load: { mode: 'empty' }, restSeconds: 0, durationSeconds: range(300), speed: 8 })
    const zero = compile(set(flat, { options: { incline: 0 } }), { rule: run })
    expect(zero.program.phases[0].parameters.restSeconds).toBe(0)
    expect(gen(zero).parameters.restSeconds).toBe(0)
    expect(zero.options).toEqual({ incline: 0 })
    expect(validate([stage('w1', set(flat, { options: { incline: 0 } }))], { routines: routinesOf(occurrence(run, { mode: 'cardio' })) })).toEqual({ ok: true, errors: [] })
    const absent = compile(set({ ...flat, parameters: { ...flat.parameters, restSeconds: undefined } }), { rule: run })
    expect(absent.program.phases[0].parameters.restSeconds).toBe(90)
    expect(absent).not.toHaveProperty('options')
  })

  it('a rule with no preset compiles as the plain no-operator one', () => {
    const { preset, ...bare } = occRule()
    const rule = compile(set(week()), { rule: bare })
    expect(preset).toBe('linear')
    expect(rule.preset).toBe('manual')
    expect(gen(rule).rows).toHaveLength(3)
  })
})

describe('validateProgramme', () => {
  it('fixed load with kept reps/sets needs the hold-or-reset choice', () => {
    const chain = flag => [{ id: 'reps', metric: 'reps', when: 'success', step: 1, ...flag }, { id: 'sets', metric: 'sets', when: 'success', step: 1, ...flag }]
    const climb = flag => [stage('w1', set(week({ sets: range(3, 4), reps: range(8, 10) }, { progression: chain(flag) })))]
    const missing = validate(climb({}))
    expect(missing.ok).toBe(false)
    expect(missing.errors).toHaveLength(2)
    expect(missing.errors.join('\n')).toMatch(/reps step must say hold or reset/)
    expect(validate(climb({ resetOnCarry: true }))).toEqual({ ok: true, errors: [] })
    expect(validate(climb({ resetOnCarry: false }))).toEqual({ ok: true, errors: [] })
  })

  it('a newly adaptive load needs a seed, never the pre-programme 80 kg', () => {
    const weeks = seed => [stage('w1', set(week({ load: abs(60) }))), stage('w2', { own: 'inherit', ...(seed ? { seed } : {}) })]
    expect(validate(weeks()).errors).toEqual([expect.stringMatching(/load step is new in this stage and needs seed\.load/)])
    const copied = weeks({ load: 'copy' })
    expect(validate(copied)).toEqual({ ok: true, errors: [] })
    const rule = stageRule({ ...ctxOf(copied), stage: copied[1] })
    expect(rule.program.phases[0].progression.map(op => op.metric)).toEqual(['load'])
    expect(gen(rule).rows.map(r => r.load.value)).toEqual([60, 60, 60])
    const declared = weeks({ load: 62.5 })
    expect(gen(stageRule({ ...ctxOf(declared), stage: declared[1] })).rows[0].load.value).toBe(62.5)
    // The same step carries on into the next week with no seed; a first week has nothing to copy.
    expect(validate([...copied, stage('w3', INHERIT)]).ok).toBe(true)
    expect(validate([stage('w1', { own: 'inherit', seed: { load: 'copy' } })]).errors.join()).toMatch(/seed\.load/)
  })

  it('accepts a plain fixed week', () => {
    expect(validate([stage('w1', set(week()))])).toEqual({ ok: true, errors: [] })
  })

  const base = [stage('w1', set(week()))]
  const linked = other => validate(base, {
    track: { slots: [{ rid: 'rA', oid: OID }, { rid: 'rA', oid: 'rA:o1' }] },
    routines: routinesOf(occurrence(), occurrence(occRule(), { occurrenceId: 'rA:o1', ...other }))
  })
  const effort = { mode: 'operational', rpe: 8 }
  const threeSlots = () => {
    const oids = ['rA:o0', 'rA:o1', 'rA:o2']
    const stages = Array.from({ length: 11 }, (_, i) => ({ id: 'w' + i, kind: 'work', targets: Object.fromEntries(oids.map(oid => [oid, set(week())])) }))
    return validate(stages, { track: { slots: oids.map(oid => ({ rid: 'rA', oid })) }, routines: routinesOf(...oids.map(oid => occurrence(occRule(), { occurrenceId: oid }))) })
  }
  it.each([
    ['a schedule without appointments', () => validate(base, { def: { schedule: { mode: 'weeks', appts: [] } } }), /schedule needs at least one appointment/],
    ['a rotation of rest only', () => validate(base, { def: { schedule: { mode: 'rotation', sequence: ['rest'] }, duration: { n: 4, unit: 'blocks' } } }), /schedule needs at least one appointment/],
    ['a duration unit that does not match the mode', () => validate(base, { def: { duration: { n: 4, unit: 'blocks' } } }), /duration\.unit must be weeks/],
    ['more than 16 stages', () => validate(Array.from({ length: 17 }, (_, i) => stage('w' + i, set(week())))), /1 to 16 stages/],
    ['more than 50 tracks', () => validateProgramme(defOf(Array.from({ length: 51 }, () => trackOf(base))), { routines: routinesOf() }), /1 to 50 tracks/],
    ['two stages with one id', () => validate([stage('w1', set(week())), stage('w1', set(week()))]), /stages must have distinct ids/],
    ['a stage without an id', () => validate([stage('', set(week()))]), /stages must have distinct ids/],
    ['a track without an id', () => validateProgramme(defOf([trackOf(base, { id: undefined })]), { routines: routinesOf() }), /tracks must have distinct ids/],
    ['two tracks with one id', () => validateProgramme(defOf([trackOf(base), trackOf(base)]), { routines: routinesOf() }), /tracks must have distinct ids/],
    ['more than 32 phases', threeSlots, /at most 32 authored phases/],
    ['a slot on a routine the schedule never plans', () => validate(base, { track: { slots: [{ rid: 'rB', oid: OID }] } }), /routine rB is not in the schedule/],
    ['a slot whose occurrence is not in that routine', () => validate(base, { track: { slots: [{ rid: 'rA', oid: 'rA:o9' }] } }), /rA:o9 is not in routine rA/],
    ['linked slots of different exercises', () => linked({ exerciseId: 'squat', rule: occRule('linear', { exerciseId: 'squat' }) }), /linked slots must all be bench/],
    ['linked slots in different load units', () => linked({ rule: occRule('linear', { unit: 'lb', load: { mode: 'absolute', value: 180, unit: 'lb' } }) }), /one load unit and meaning/],
    ['a week whose compiled rule is invalid', () => validate([stage('w1', set(week({ sets: range(0) })))]), /parameters\.sets: must be at least 1/],
    ['a step on a metric its groups fix', () => validate([stage('w1', set(week({ sets: 4, reps: range(6, 10) }, {
      groups: [{ id: 'top', count: range(1), reps: range(6), load: anchor() }, { id: 'back', count: range(3), reps: range(8), load: anchor(90) }],
      progression: [{ id: 'reps', metric: 'reps', when: 'success', step: 1, resetOnCarry: true }]
    })))]), /reps is fixed per group/],
    ['kept reps and sets without the hold-or-reset choice', () => validate([stage('w1', set(week({ reps: range(8, 10) }, { progression: [{ id: 'reps', metric: 'reps', when: 'success', step: 1 }] })))]), /hold or reset/],
    ['a new step without a seed', () => validate([...base, stage('w2', INHERIT)]), /needs seed\.load/],
    ['operational effort on AMRAP sets only', () => validate([stage('w1', set(week({}, { groups: [{ ...plain, amrap: true }] }), { effort }))]), /operational effort needs a deciding set/],
    ['operational effort with every set to failure', () => validate([stage('w1', set(week(), { effort, options: { failureSets: 'all' } }))]), /operational effort needs a deciding set/],
    ['operational effort on a timed hold', () => validate([stage('w1', set(week({ reps: 1, load: { mode: 'empty' }, durationSeconds: range(30) }), { effort }))]), /operational effort is for repetition work/]
  ])('rejects %s', (_, run, error) => {
    const out = run()
    expect(out.ok).toBe(false)
    expect(out.errors.join('\n')).toMatch(error)
  })

  it('week options: an incline of 1 then 2 % and a dropset survive validation; an option the rule cannot take is rejected', () => {
    const RUN = 'rA:o1'
    const run = occRule('manual', { exerciseId: 'run', ...cardioParameters({ sets: 3, min: 5, speed: 8 }), load: { mode: 'empty' } })
    const routines = routinesOf(occurrence(), occurrence(run, { occurrenceId: RUN, exerciseId: 'run', mode: 'cardio' }))
    const dropset = { type: 'dropset', count: 2, pct: 20 }
    const bench = trackOf([stage('w1', { own: 'inherit', options: { intensifier: dropset } }), stage('w2', INHERIT)])
    const treadmill = { id: 'run', exerciseId: 'run', slots: [{ rid: 'rA', oid: RUN }], refs: 'inherit', stages: [1, 2].map(n => ({ id: 'w' + n, kind: 'work', targets: { [RUN]: { own: 'inherit', options: { incline: n } } } })) }
    const def = defOf([bench, treadmill])
    expect(validateProgramme(def, { routines })).toEqual({ ok: true, errors: [] })
    expect(treadmill.stages.map(s => stageRule({ def, track: treadmill, stage: s, oid: RUN, occRule: run, runId: 'run1' }).options)).toEqual([{ incline: 1 }, { incline: 2 }])
    expect(stageRule({ def, track: bench, stage: bench.stages[0], oid: OID, occRule: occRule(), runId: 'run1' }).options).toEqual({ intensifier: dropset })
    // A drop needs a load to drop from, which timed intervals do not have; a note is not an execution option.
    const wrong = { ...treadmill, stages: [{ id: 'w1', kind: 'work', targets: { [RUN]: { own: 'inherit', options: { intensifier: dropset, note: 'easy', incline: 41 } } } }] }
    const { errors } = validateProgramme(defOf([bench, wrong]), { routines })
    expect(errors).toHaveLength(3)
    expect(errors.join('\n')).toMatch(/options\.intensifier does not fit/)
    expect(errors.join('\n')).toMatch(/options\.note is not an execution option/)
    expect(errors.join('\n')).toMatch(/options\.incline must be 0 to 40/)
  })
})

describe('slotOutcome', () => {
  // Bench as the occurrence plans it: linear, 3 × 5 at 80 kg.
  const lifts = (over = {}, at = 2) => [0, 1, 2].map(row => ({ row, reps: 5, load: kg(80), rir: 2, ...(row === at ? over : {}) }))

  it('slot outcome: a hold side at 18 s against 20 s fails (spec 12.4)', () => {
    const p = gen(compile(set(week({ sets: 3, reps: 1, load: { mode: 'empty' }, restSeconds: 30, durationSeconds: range(20) }))))
    const holds = last => [0, 1, 2].flatMap(row => ['L', 'R'].map(limb => ({ row, limb, reps: null, durationSeconds: row === 2 && limb === 'R' ? last : 20, load: null })))
    expect(slotOutcome({ prescription: p, exposure: saved(p, holds(18)) })).toEqual({ outcome: 'failed', reasons: ['work'] })
    expect(slotOutcome({ prescription: p, exposure: saved(p, holds(20)) })).toEqual({ outcome: 'succeeded', reasons: [] })
  })

  it('slot outcome: 3 of 4 minutes fails; missing speed is unknown (spec 12.5)', () => {
    const p = gen(compile(set(week({ sets: 4, reps: 1, load: { mode: 'empty' }, restSeconds: 120, durationSeconds: range(240), speed: 9 }))))
    const intervals = over => [0, 1, 2, 3].map(row => ({ row, reps: null, durationSeconds: 240, speed: 9, load: null, ...(row === 3 ? over : {}) }))
    const read = over => slotOutcome({ prescription: p, exposure: saved(p, intervals(over)) })
    expect(read({ durationSeconds: 180 })).toEqual({ outcome: 'failed', reasons: ['work'] })
    expect(read({ speed: null })).toEqual({ outcome: 'unknown', reasons: ['missing_speed'] })
    expect(read({ durationSeconds: 180, speed: null })).toEqual({ outcome: 'failed', reasons: ['work', 'missing_speed'] })
    expect(read({ speed: 8.5 })).toEqual({ outcome: 'failed', reasons: ['work'] })
    expect(read({})).toEqual({ outcome: 'succeeded', reasons: [] })
  })

  it('slot outcome: missing RIR is unknown, a confirmed RIR miss is failed, both reasons kept', () => {
    const p = gen(compile({ own: 'inherit', effort: { mode: 'operational', rpe: 8 } }))
    const read = performed => slotOutcome({ prescription: p, exposure: saved(p, performed) })
    expect(read(lifts())).toEqual({ outcome: 'succeeded', reasons: [] })
    expect(read(lifts({ rir: null }))).toEqual({ outcome: 'unknown', reasons: ['missing_effort'] })
    expect(read(lifts({ rir: 1 }))).toEqual({ outcome: 'failed', reasons: ['effort'] })
    expect(read(lifts({ rir: 1, reps: 4 }))).toEqual({ outcome: 'failed', reasons: ['work', 'effort'] })
    // A confirmed miss stays a miss beside an unrated set, and the unrated set is still named.
    expect(read([...lifts({ rir: 1 }, 0).slice(0, 2), lifts({ rir: null })[2]])).toEqual({ outcome: 'failed', reasons: ['effort', 'missing_effort'] })
    // Advisory effort decides nothing: an unrated or easy set does not change the outcome.
    const advisory = gen(compile({ own: 'inherit', effort: { mode: 'advisory', rpe: 8 } }))
    expect(slotOutcome({ prescription: advisory, exposure: saved(advisory, lifts({ rir: 0 })) })).toEqual({ outcome: 'succeeded', reasons: [] })
  })

  it('slot outcome: AMRAP, Max and to-failure rows are left out of the effort check', () => {
    const groups = [{ id: 'sets', count: range(2), reps: range(5), load: anchor() }, { id: 'amrap', count: range(1), reps: range(5), amrap: true, load: anchor() }, { id: 'max', count: range(1), reps: range(0), max: true, load: anchor() }]
    const p = gen(compile(set(week({ sets: 4, reps: 5, load: abs(60) }, { groups }), { effort: { mode: 'operational', rpe: 8 } })))
    const row = (i, more) => ({ row: i, reps: 5, load: kg(60), rir: 2, ...more })
    const performed = [row(0), row(1, { rir: 0, failure: true }), row(2, { reps: 9, rir: 0 }), row(3, { reps: 7, rir: 0, max: true })]
    expect(slotOutcome({ prescription: p, exposure: saved(p, performed) })).toEqual({ outcome: 'succeeded', reasons: [] })
    expect(verdictOf(p, summarizeActual(p, performed)).success).toBe(true)
    expect(slotOutcome({ prescription: p, exposure: saved(p, [row(0, { rir: 0 }), ...performed.slice(1)]) })).toEqual({ outcome: 'failed', reasons: ['effort'] })
  })

  it('a set taken to failure is left out of the effort the engine itself judges (spec 11)', () => {
    const p = gen(compile({ own: 'inherit', effort: { mode: 'operational', rpe: 8 } }))
    const next = performed => advanceProgression({ state: null, prescription: p, log: { id: 'l1', actual: summarizeActual(p, performed) }, now: NOW }).values.load.value
    expect(next(lifts({ rir: 0, failure: true }))).toBe(82.5)
    expect(slotOutcome({ prescription: p, exposure: saved(p, lifts({ rir: 0, failure: true })) })).toEqual({ outcome: 'succeeded', reasons: [] })
    // The same RIR 0 on an ordinary set is an effort miss for both readers.
    expect(next(lifts({ rir: 0 }))).toBe(80)
    expect(slotOutcome({ prescription: p, exposure: saved(p, lifts({ rir: 0 })) }).outcome).toBe('failed')
  })

  it('slot outcome: saved with incomplete required rows is failed; zero-work save is failed', () => {
    const p = gen(compile(INHERIT))
    expect(slotOutcome({ prescription: p, exposure: saved(p, lifts().slice(0, 2)) })).toEqual({ outcome: 'failed', reasons: ['incomplete'] })
    expect(slotOutcome({ prescription: p, exposure: saved(p, []) })).toEqual({ outcome: 'failed', reasons: ['incomplete'] })
    // Complete work with a weight never typed is a missing measurement, not a miss.
    expect(slotOutcome({ prescription: p, exposure: saved(p, lifts({ load: null })) })).toEqual({ outcome: 'unknown', reasons: ['missing_measurement'] })
  })

  it('slot outcome: discard unworked is skipped, discard after a work row is failed (abandoned)', () => {
    const p = gen(compile(INHERIT))
    expect(slotOutcome({ prescription: p, disposition: { type: 'discard', worked: false } })).toEqual({ outcome: 'skipped', reasons: ['discard'] })
    expect(slotOutcome({ prescription: p, disposition: { type: 'discard', worked: true } })).toEqual({ outcome: 'failed', reasons: ['abandoned'] })
    expect(slotOutcome({ prescription: p, disposition: { type: 'close' } })).toEqual({ outcome: 'skipped', reasons: ['close'] })
    // A recorded resolve settles unknown work, never a confirmed miss.
    const unknown = saved(p, lifts({ load: null }))
    expect(slotOutcome({ prescription: p, exposure: unknown, disposition: { type: 'resolve', as: 'failed' } })).toEqual({ outcome: 'failed', reasons: ['missing_measurement', 'resolved'] })
    expect(slotOutcome({ prescription: p, exposure: saved(p, []), disposition: { type: 'resolve', as: 'skipped' } }).outcome).toBe('failed')
  })

  it('slot outcome: an active session is pending', () => {
    const p = gen(compile(INHERIT))
    expect(slotOutcome({ prescription: p, active: true })).toEqual({ outcome: 'pending', reasons: ['active'] })
    // Not even a closing week skips work that is still open.
    expect(slotOutcome({ prescription: p, active: true, disposition: { type: 'close' } }).outcome).toBe('pending')
    expect(slotOutcome({ prescription: p })).toEqual({ outcome: 'pending', reasons: [] })
  })
})

describe('OPTION_CLASSES', () => {
  it('every occurrence key session-start.js reads or copies onto an exposure has an OPTION_CLASSES entry', () => {
    // The session builder is where an occurrence's keys take effect: read its source, so a key it
    // starts to use without a class (and so without a rule for a week's options) fails here.
    const src = readFileSync(new URL('../session-start.js', import.meta.url), 'utf8')
    const copied = /\[((?:'\w+',?\s*)+)\]\.filter\(k => occ\[k\]/.exec(src)[1].match(/\w+/g)
    const keys = new Set([...src.matchAll(/\b(?:occ|base|original)\.(\w+)/g)].map(m => m[1]).concat(copied))
    for (const id of ['occurrenceId', 'exerciseId']) keys.delete(id)   // identity, not options
    expect(keys.size).toBeGreaterThan(20)
    for (const k of ['repeatLast', 'legacyWarmupSets', 'ref', 'restFromProfile', 'sgRest']) expect(keys).toContain(k)
    expect([...keys].filter(k => !OPTION_CLASSES[k])).toEqual([])
    expect(OPTION_CLASSES).toMatchObject({ rule: 'target', sets: 'target', repeatLast: 'target', ref: 'target', incline: 'execution', intensifier: 'execution', warmup: 'execution', legacyWarmupSets: 'execution', sgRest: 'execution', note: 'display', exerciseName: 'display' })
  })
})
