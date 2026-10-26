import { describe, expect, it } from 'vitest'
import { contentHash } from '../../../../api/engine/canonical.js'
import { defaultPlanRule, editPlan, planPhase } from '../../../../api/engine/rules.js'
import { appendOneRm, currentOneRm } from '../../../../api/engine/one-rm.js'
import { generatePrescription, ruleOfPrescription } from '../../../../api/engine/generate.js'
import { advanceProgression } from '../../../../api/engine/advance.js'

const NOW = '2026-09-24T10:00:00.000Z'
const kg = value => ({ value, unit: 'kg' })
const abs = value => ({ mode: 'absolute', value, unit: 'kg' })
const oneRm = (value = 100, capturedAt = '2026-09-01T00:00:00.000Z') => ({ id: 'orm-' + value, exerciseId: 'ex1', value, unit: 'kg', source: 'manual', capturedAt })
const rule = (preset, options = {}) => defaultPlanRule(preset, { id: 'rule1', exerciseId: 'ex1', routineId: 'rt1', unit: 'kg', ...options })
const percentLinear = () => rule('linear', { load: { mode: 'percent_1rm', percent: 60 }, step: { type: 'percentage_points', value: 5 } })
const gen = (r, extra = {}) => generatePrescription({ id: 'p1', now: NOW, trackId: 't1', rule: r, ...extra })
const logOf = (actual, audit = []) => ({ id: 'log1', actual, audit })
// The next session after `p` finished with `actual`: the state its finish left, then generation.
const after = (r, p, actual, extra = {}, audit = []) => {
  const state = advanceProgression({ state: extra.state ?? null, prescription: p, log: { id: 'log-' + p.id, actual }, now: NOW })
  return gen(r, { id: p.id + '+', state, lastPrescription: p, lastLog: logOf(actual, audit), ...extra, ...(extra.state ? { state } : {}) })
}

describe('1RM records', () => {
  it('appends without rewriting and reads the newest', () => {
    const dict = appendOneRm(appendOneRm({}, oneRm(100)), oneRm(110, '2026-09-10T00:00:00.000Z'))
    expect(currentOneRm(dict, 'ex1').value).toBe(110)
    expect(currentOneRm(dict, 'other')).toBe(null)
    expect(() => appendOneRm(dict, oneRm(100))).toThrow(/already exists/)
  })
})

describe('generatePrescription', () => {
  it('starts a new track from the rule and its range minima', () => {
    const p = gen(rule('linear'))
    expect(p).toMatchObject({ statusAtGeneration: 'active', preset: 'linear', planRuleRevision: 1, snapshot1RM: null, phaseId: 'plan', values: { sets: 3, reps: 5 } })
    expect(p.parameters.load.resolved).toEqual(kg(20))
    expect(p.parameters.restSeconds).toBe(180)
    expect(p.rows).toEqual([0, 1, 2].map(() => ({ reps: { min: 5, max: 5 }, load: kg(20) })))
    expect(p.prefill).toEqual({ sets: 3, reps: 5, load: null })
    expect(p.provenance).toEqual({ derivedFromOutOfPlan: false, sourceLogId: null })
  })

  it('freezes the 1RM and the rule it was generated from', () => {
    const orm = oneRm(100)
    const r = percentLinear()
    const p = gen(r, { oneRm: orm })
    orm.value = 200
    planPhase(r).parameters.load.percent = 90
    expect(p.snapshot1RM.value).toBe(100)
    expect(p.parameters.load.resolved).toEqual(kg(60))
    expect(planPhase(p.ruleSnapshot).parameters.load.percent).toBe(60)
    expect(Object.isFrozen(p) && Object.isFrozen(p.rows[0].load)).toBe(true)
    expect(() => { p.parameters.load.resolved.value = 1 }).toThrow(TypeError)
    const { contentHash: hash, ...body } = p
    expect(contentHash(body)).toBe(hash)
  })

  it('leaves percent loads null and manually fillable when the 1RM prompt is cancelled', () => {
    const p = gen(percentLinear(), { oneRm: null })
    expect(p.snapshot1RM).toBe(null)
    expect(p.parameters.load).toEqual({ expression: { mode: 'percent_1rm', percent: 60 }, resolved: null })
    expect(p.rows.every(row => row.load === null)).toBe(true)
  })

  it('advances 60 → 65 → 70 percentage points from the frozen 1RM', () => {
    const first = gen(percentLinear(), { oneRm: oneRm(100) })
    const second = after(percentLinear(), first, { sets: 3, reps: 5, load: kg(60) }, { oneRm: oneRm(100) })
    const third = after(percentLinear(), second, { sets: 3, reps: 5, load: kg(65) }, { oneRm: oneRm(100) })
    expect([first, second, third].map(p => p.parameters.load.expression.percent)).toEqual([60, 65, 70])
    expect(third.parameters.load.resolved).toEqual(kg(70))
  })

  it('generating twice from the same state gives the same prescription: the step was earned at the finish', () => {
    const first = gen(rule('linear'))
    const state = advanceProgression({ state: null, prescription: first, log: { id: 'l', actual: { sets: 3, reps: 5, load: kg(20) } }, now: NOW })
    const again = () => gen(rule('linear'), { id: 'p2', state, lastPrescription: first, lastLog: logOf({ sets: 3, reps: 5, load: kg(20) }) })
    expect(again()).toEqual(again())
    expect(again().parameters.load.resolved).toEqual(kg(22.5))
  })

  it('holds, prefills the last raw actual and carries out-of-plan provenance', () => {
    const first = gen(rule('double'))
    const finding = { code: 'above_range', field: 'load', expected: { min: 20, max: 20 }, actual: 22.5, severity: 'warning', row: 0 }
    const next = after(rule('double'), first, { sets: 3, reps: 10, load: kg(22.5) }, {}, [finding])
    // v1 held the session at the weight lifted (readSession.weight): the rows open there.
    expect(next.parameters.load.resolved).toEqual(kg(22.5))
    expect(next.prefill).toEqual({ sets: 3, reps: 11, load: null })   // v1: the aim is the last result + 1
    expect(next.provenance).toEqual({ derivedFromOutOfPlan: true, sourceLogId: 'log1' })
  })

  it('keeps rows and sets on the plan while the reps follow the log on a hold (extra sets never move the plan, v1 #233)', () => {
    const next = after(rule('double'), gen(rule('double')), { sets: 5, reps: 10, load: kg(20) })
    expect(next.prefill.sets).toBe(3)
    expect(next.rows).toHaveLength(3)
  })

  it('restarts the prefill from range minima after a step', () => {
    const next = after(rule('double'), gen(rule('double')), { sets: 3, reps: 12, load: kg(20) })
    expect(next.parameters.load.resolved).toEqual(kg(22.5))
    expect(next.prefill).toEqual({ sets: 3, reps: 8, load: null })
  })

  it('caps the automated suggestion at the rounded target without capping the expression', () => {
    const r = rule('linear', { load: abs(97.5), step: { type: 'absolute', value: 5, unit: 'kg' } })
    const next = after(r, gen(r), { sets: 3, reps: 5, load: kg(97.5) })
    expect(next.parameters.load.expression.value).toBe(102.5)
    expect(next.parameters.load.resolved).toEqual(kg(100))
  })

  it('holds a completed track at its terminal target until the rule is edited', () => {
    const r = rule('linear', { load: abs(100) })
    const first = gen(r)
    const done = advanceProgression({ state: null, prescription: first, log: { id: 'l', actual: { sets: 3, reps: 5, load: kg(100) } }, now: NOW })
    expect(done.status).toBe('completed')
    const log = logOf({ sets: 3, reps: 5, load: kg(100) })
    const held = gen(r, { id: 'p2', state: done, lastPrescription: first, lastLog: log })
    expect(held.statusAtGeneration).toBe('completed')
    expect(held.parameters.load.resolved).toEqual(kg(100))
    expect(held.target.resolved).toEqual(kg(100))
    expect(gen({ ...r, revision: 2 }, { id: 'p3', state: done, lastPrescription: first, lastLog: log }).statusAtGeneration).toBe('active')
  })

  it('does not treat a completed_track finding as out-of-plan provenance', () => {
    const next = audit => after(rule('linear'), gen(rule('linear')), { sets: 3, reps: 5, load: kg(20) }, {}, audit)
    expect(next([{ code: 'completed_track' }]).provenance.derivedFromOutOfPlan).toBe(false)
    expect(next([{ code: 'completed_track' }, { code: 'above_cap' }]).provenance.derivedFromOutOfPlan).toBe(true)
  })

  it('carries progress across an edit unless the declared start load or step kind changed', () => {
    const first = gen(rule('linear'))
    const clean = { sets: 3, reps: 5, load: kg(20) }
    expect(after({ ...editPlan(rule('linear'), { restSeconds: 240 }), revision: 2 }, first, clean).parameters.load.resolved).toEqual(kg(22.5))
    expect(after({ ...editPlan(rule('linear'), { load: abs(40) }), revision: 2 }, first, clean).parameters.load.resolved).toEqual(kg(40))
    expect(after({ ...editPlan(rule('linear'), { step: { type: 'current_load_percent', value: 5 } }), revision: 2 }, first, clean).parameters.load.resolved).toEqual(kg(20))
  })

  it('resolves pyramid offsets from the rounded anchor, the anchor sets deciding', () => {
    const r = rule('pyramid', { load: abs(100), target: abs(150) })
    const p = gen(r)
    expect(p.rows.map(row => [row.load.value, row.groupId])).toEqual([[70, 's1'], [85, 's2'], [100, 's3']])
    expect(planPhase(p.ruleSnapshot).success.groupIds).toEqual(['s3'])
    expect(after(r, p, { sets: 3, reps: 8, load: kg(100) }).rows.map(row => row.load.value)).toEqual([72.5, 87.5, 102.5])
  })

  it('slides a hold_seconds window by the earned steps and restarts it when the declared window is edited', () => {
    const r = rule('hold_seconds')
    const held = { sets: 3, reps: null, durationSeconds: 30 }
    const p1 = after(r, gen(r), held)
    const p2 = after(r, p1, { ...held, durationSeconds: 35 })
    expect(p2.parameters.durationSeconds).toEqual({ min: 30, max: 40 })
    expect(p2.prefill.durationSeconds).toBe(30)
    expect(ruleOfPrescription(p2, 'rt1')).toEqual(r)
    const edited = { ...editPlan(r, { durationSeconds: { min: 30, max: 40 } }), revision: 2 }
    const q = gen(edited, { id: 'p3', reset: 'plan_changed', lastPrescription: p2 })
    expect(q.parameters.durationSeconds).toEqual({ min: 30, max: 40 })
  })

  it('gives each pyramid row its own reps when the offsets carry them, else the plan\'s reps', () => {
    const rpt = rule('pyramid', { load: abs(100), reps: { min: 6, max: 6 }, offsets: [{ percentOfAnchor: 100 }, { percentOfAnchor: 90, reps: 8 }, { percentOfAnchor: 80, reps: 10 }] })
    expect(gen(rpt).rows.map(row => [row.load.value, row.reps.min, row.reps.max])).toEqual([[100, 6, 6], [90, 8, 8], [80, 10, 10]])
    expect(gen(rule('pyramid', { load: abs(100), direction: 'descending' })).rows.map(row => row.reps)).toEqual([{ min: 8, max: 8 }, { min: 8, max: 8 }, { min: 8, max: 8 }])
  })

  it('builds 5/3/1 weeks from the training max', () => {
    const direct = rule('five_three_one', { trainingMax: { mode: 'direct', value: 100, unit: 'kg' } })
    const week1 = gen(direct)
    expect(week1.rows.map(row => [row.load.value, row.reps.min, !!row.amrap])).toEqual([[65, 5, false], [75, 5, false], [85, 5, true]])
    const week2 = after(direct, week1, { sets: 3, reps: 5, load: kg(85) })
    const week3 = after(direct, week2, { sets: 3, reps: 3, load: kg(90) })
    expect([week2.phaseId, week3.phaseId]).toEqual(['w2', 'w3'])
    expect(week3.rows.map(row => row.load.value)).toEqual([75, 85, 95])
    expect(gen(rule('five_three_one'), { oneRm: oneRm(100) }).trainingMax).toEqual(kg(90))
    expect(gen(rule('five_three_one')).rows.every(row => row.load === null)).toBe(true)
  })

  it('refuses an invalid rule', () => {
    expect(() => gen({ ...rule('linear'), preset: 'nope' })).toThrow(/invalid plan rule/)
  })

  it('recovers the rule a prescription was generated from', () => {
    const r = rule('pyramid')
    expect(ruleOfPrescription(gen(r), 'rt1')).toEqual(r)
    const ranged = rule('autoregulated', { load: abs(60), loadTo: abs(80) })
    expect(ruleOfPrescription(gen(ranged), 'rt1')).toEqual(ranged)
  })

  it('resolves a load range and puts it on every row', () => {
    const r = rule('autoregulated', { load: abs(60), loadTo: abs(81) })
    const p = gen(r)
    expect(p.parameters.load).toEqual({ expression: abs(60), resolved: kg(60) })
    expect(p.parameters.loadTo).toEqual({ expression: abs(81), resolved: kg(80) })
    expect(p.rows.map(row => [row.load, row.loadTo])).toEqual([0, 1, 2].map(() => [kg(60), kg(80)]))
    expect(Object.isFrozen(p.rows[0].loadTo)).toBe(true)
  })

  it('resolves a % 1RM load range from the frozen 1RM, or leaves both ends null without one', () => {
    const r = rule('autoregulated', { load: { mode: 'percent_1rm', percent: 60 }, loadTo: { mode: 'percent_1rm', percent: 75 } })
    expect(gen(r, { oneRm: oneRm(100) }).rows[0]).toMatchObject({ load: kg(60), loadTo: kg(75) })
    expect(gen(r).rows[0]).toMatchObject({ load: null, loadTo: null })
  })

  it('adds no loadTo to a fixed-load prescription', () => {
    const p = gen(rule('linear'))
    expect('loadTo' in p.parameters).toBe(false)
    expect(p.rows.some(row => 'loadTo' in row)).toBe(false)
  })

  it('writes a row\'s group and rest only where they say something new', () => {
    expect(Object.keys(gen(rule('linear')).rows[0])).toEqual(['reps', 'load'])
    expect(gen(rule('top_set_backoff')).rows.map(r => [r.groupId, r.restSeconds])).toEqual([['top', undefined], ['backoff', 120], ['backoff', 120], ['backoff', 120]])
  })
})

describe('warm-up rows', () => {
  const smart = { mode: 'smart', count: 3 }
  it('snapshots rounded rows into the hashed body without touching the rule revision', () => {
    const r = rule('linear', { load: abs(100), target: { mode: 'none' }, completion: [] })
    const plain = gen(r)
    const warm = gen(r, { warmup: smart, equipment: 'barbell' })
    expect(plain.warmupRows).toBeUndefined()
    expect(warm.warmupRows.map(x => x.load.value)).toEqual([60, 75, 85])
    expect(warm.planRuleRevision).toBe(plain.planRuleRevision)
    expect(warm.rows).toEqual(plain.rows)
    expect(warm.contentHash).not.toBe(plain.contentHash)
    expect(Object.isFrozen(warm.warmupRows[0])).toBe(true)
  })
  it('omits the field when nothing can be generated', () => {
    expect(gen(rule('autoregulated'), { warmup: smart, equipment: 'barbell' }).warmupRows).toBeUndefined()      // empty load
    expect(gen(percentLinear(), { warmup: smart, equipment: 'barbell' }).warmupRows).toBeUndefined()     // no 1RM
  })
  it('never warms up a timed hold, even a loaded one', () => {
    expect(gen(rule('autoregulated', { load: abs(20), durationSeconds: { min: 30, max: 60 }, reps: { min: 1, max: 1 } }), { warmup: smart, equipment: 'body weight' }).warmupRows).toBeUndefined()
  })
})

describe('session semantics (v1.3.9)', () => {
  const plan = (sets, reps, weight) => rule('linear', { target: { mode: 'none' }, completion: [], sets: { min: sets, max: sets }, reps: { min: reps, max: reps }, load: abs(weight) })

  it('opens at the plan\'s reps by default, and at the last logged ones under startFrom: last', () => {
    const r = plan(3, 10, 60)
    const first = gen(r)
    const missed = { sets: 3, reps: 7, load: kg(60) }
    // The rows hold at 60 through the load itself (v1 hold), not a prefill on top of it.
    expect(after(r, first, missed).prefill).toEqual({ sets: 3, reps: 10, load: null })
    expect(after(r, first, missed, { startFrom: 'last' }).prefill).toEqual({ sets: 3, reps: 7, load: null, carried: true })
  })

  it('restarts an edited plan at its new reps with the load held at what was lifted, even under startFrom: last', () => {
    const first = gen(plan(3, 5, 100))
    const next = gen(plan(3, 10, 100), { id: 'p2', lastPrescription: first, lastLog: logOf({ sets: 3, reps: 5, load: kg(97.5) }), reset: 'plan_changed', heldLoad: kg(97.5), startFrom: 'last' })
    expect(next.parameters.load.resolved).toEqual(kg(97.5))
    expect(next.prefill).toEqual({ sets: 3, reps: 10, load: null })
    expect(next).toMatchObject({ phaseId: 'plan', statusAtGeneration: 'active' })
  })

  it('opens at the plan\'s new weight when the edit changed it too', () => {
    const first = gen(plan(3, 5, 100))
    expect(gen(plan(3, 10, 70), { id: 'p2', lastPrescription: first, lastLog: logOf({ sets: 3, reps: 5, load: kg(100) }), reset: 'plan_changed', heldLoad: kg(100) }).parameters.load.resolved).toEqual(kg(70))
  })

  it('holds the lifted load from borrowed history that has no prescription, or the plan\'s when nothing was lifted', () => {
    expect(gen(plan(3, 10, 60), { reset: 'first_in_routine', heldLoad: kg(80), lastLog: { id: 'legacy', audit: [] } }).parameters.load.resolved).toEqual(kg(80))
    expect(gen(plan(3, 10, 60), { reset: 'first_in_routine', heldLoad: null, lastLog: { id: 'legacy', audit: [] } }).parameters.load.resolved).toEqual(kg(60))
  })

  it('opens a reset at the plan\'s load, not a progressed lastPrescription\'s, when nothing was lifted', () => {
    const first = gen(plan(3, 10, 100))
    const second = after(plan(3, 10, 100), first, { sets: 3, reps: 10, load: kg(100) })
    expect(second.parameters.load.resolved).toEqual(kg(102.5))
    expect(gen(plan(3, 12, 100), { id: 'p3', lastPrescription: second, lastLog: logOf({ sets: 3, reps: 10, load: kg(102.5) }), reset: 'plan_changed', heldLoad: null }).parameters.load.resolved).toEqual(kg(100))
  })

  it('keeps a percent rule\'s expression on reset, without the step', () => {
    const first = gen(percentLinear(), { oneRm: oneRm(100) })
    const edited = editPlan(percentLinear(), { reps: { min: 3, max: 3 } })
    const next = gen(edited, { id: 'p2', oneRm: oneRm(100), lastPrescription: first, lastLog: logOf({ sets: 3, reps: 5, load: kg(60) }), reset: 'plan_changed', heldLoad: kg(60) })
    expect(next.parameters.load.expression).toEqual({ mode: 'percent_1rm', percent: 60 })
  })
})
