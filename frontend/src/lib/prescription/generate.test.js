import { describe, expect, it } from 'vitest'
import { contentHash } from '../../../../api/engine/canonical.js'
import { defaultPlanRule } from '../../../../api/engine/rules.js'
import { appendOneRm, currentOneRm } from '../../../../api/engine/one-rm.js'
import { generatePrescription, ruleOfPrescription } from '../../../../api/engine/generate.js'

const NOW = '2026-09-24T10:00:00.000Z'
const kg = value => ({ value, unit: 'kg' })
const oneRm = (value = 100, capturedAt = '2026-09-01T00:00:00.000Z') => ({ id: 'orm-' + value, exerciseId: 'ex1', value, unit: 'kg', source: 'manual', capturedAt })
const rule = (preset, patch = r => r) => patch(defaultPlanRule(preset, { id: 'rule1', exerciseId: 'ex1', routineId: 'rt1', unit: 'kg' }))
const load = (r, value) => ({ ...r, parameters: { ...r.parameters, load: { mode: 'absolute', value, unit: 'kg' } } })
const percentLinear = () => rule('linear', r => ({ ...r, parameters: { ...r.parameters, load: { mode: 'percent_1rm', percent: 60 } }, increment: { type: 'percentage_points', value: 5 } }))
const loadRange = (r, low, high) => ({ ...r, parameters: { ...r.parameters, load: low, loadTo: high } })
const gen = (r, extra = {}) => generatePrescription({ id: 'p1', now: NOW, trackId: 't1', rule: r, ...extra })
const active = over => ({ status: 'active', readyToIncrement: true, planRuleRevision: 1, position: 0, ...over })
const logOf = (actual, audit = []) => ({ id: 'log1', actual, audit })

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
    expect(p).toMatchObject({ statusAtGeneration: 'active', preset: 'linear', planRuleRevision: 1, snapshot1RM: null, position: 0 })
    expect(p.parameters.load.resolved).toEqual(kg(20))
    expect(p.parameters.restSeconds).toBe(180)
    expect(p.rows).toEqual([0, 1, 2].map(() => ({ reps: { min: 5, max: 5 }, load: kg(20) })))
    expect(p.prefill).toEqual({ sets: 3, reps: 5, load: null })
    expect(p.provenance).toEqual({ derivedFromOutOfPlan: false, sourceLogId: null })
  })

  it('freezes the 1RM and plan it was generated from', () => {
    const orm = oneRm(100)
    const r = percentLinear()
    const p = gen(r, { oneRm: orm })
    orm.value = 200
    r.parameters.load.percent = 90
    expect(p.snapshot1RM.value).toBe(100)
    expect(p.parameters.load.resolved).toEqual(kg(60))
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
    const log = logOf({ sets: 3, reps: 5, load: kg(60) })
    const second = gen(percentLinear(), { id: 'p2', oneRm: oneRm(100), state: active(), lastPrescription: first, lastLog: log })
    const third = gen(percentLinear(), { id: 'p3', oneRm: oneRm(100), state: active(), lastPrescription: second, lastLog: log })
    expect([first, second, third].map(p => p.parameters.load.expression.percent)).toEqual([60, 65, 70])
    expect(third.parameters.load.resolved).toEqual(kg(70))
  })

  it('holds, prefills the last raw actual and carries out-of-plan provenance', () => {
    const first = gen(rule('double'))
    const finding = { code: 'above_range', field: 'load', expected: { min: 20, max: 20 }, actual: 22.5, severity: 'warning', row: 0 }
    const next = gen(rule('double'), { id: 'p2', state: active({ readyToIncrement: false }), lastPrescription: first, lastLog: logOf({ sets: 3, reps: 10, load: kg(22.5) }, [finding]) })
    expect(next.parameters.load.resolved).toEqual(kg(20))
    expect(next.prefill).toEqual({ sets: 3, reps: 10, load: kg(22.5) })
    expect(next.provenance).toEqual({ derivedFromOutOfPlan: true, sourceLogId: 'log1' })
  })

  it('keeps rows on the plan while the prefill follows the log on a hold', () => {
    const first = gen(rule('double'))
    const next = gen(rule('double'), { id: 'p2', state: active({ readyToIncrement: false }), lastPrescription: first, lastLog: logOf({ sets: 5, reps: 10, load: kg(20) }) })
    expect(next.prefill.sets).toBe(5)
    expect(next.rows).toHaveLength(3)
  })

  it('restarts the prefill from range minima after an increment', () => {
    const first = gen(rule('double'))
    const next = gen(rule('double'), { id: 'p2', state: active(), lastPrescription: first, lastLog: logOf({ sets: 3, reps: 12, load: kg(20) }) })
    expect(next.parameters.load.resolved).toEqual(kg(22.5))
    expect(next.prefill).toEqual({ sets: 3, reps: 8, load: null })
  })

  it('caps the automated suggestion at the rounded target without capping the expression', () => {
    const r = { ...load(rule('linear'), 97.5), increment: { type: 'absolute', value: 5, unit: 'kg' } }
    const next = gen(r, { id: 'p2', state: active(), lastPrescription: gen(r), lastLog: logOf({ sets: 3, reps: 5, load: kg(97.5) }) })
    expect(next.parameters.load.expression.value).toBe(102.5)
    expect(next.parameters.load.resolved).toEqual(kg(100))
  })

  it('holds a completed track at its terminal target until the rule is edited', () => {
    const first = gen(rule('linear'))
    const done = active({ status: 'completed', readyToIncrement: false, terminalTarget: kg(100) })
    const log = logOf({ sets: 3, reps: 5, load: kg(20) })
    const held = gen(rule('linear'), { id: 'p2', state: done, lastPrescription: first, lastLog: log })
    expect(held.statusAtGeneration).toBe('completed')
    expect(held.parameters.load.resolved).toEqual(kg(20))
    expect(held.target.resolved).toEqual(kg(100))
    const reopened = gen({ ...rule('linear'), revision: 2 }, { id: 'p3', state: done, lastPrescription: first, lastLog: log })
    expect(reopened.statusAtGeneration).toBe('active')
  })

  it('does not treat a completed_track finding as out-of-plan provenance', () => {
    const first = gen(rule('linear'))
    const next = audit => gen(rule('linear'), { id: 'p2', state: active(), lastPrescription: first, lastLog: logOf({ sets: 3, reps: 5, load: kg(20) }, audit) })
    expect(next([{ code: 'completed_track' }]).provenance.derivedFromOutOfPlan).toBe(false)
    expect(next([{ code: 'completed_track' }, { code: 'above_cap' }]).provenance.derivedFromOutOfPlan).toBe(true)
  })

  it('carries progress across an edit unless the declared start load changed', () => {
    const first = gen(rule('linear'))
    const log = logOf({ sets: 3, reps: 5, load: kg(20) })
    const restEdit = rule('linear', r => ({ ...r, revision: 2, parameters: { ...r.parameters, restSeconds: 240 } }))
    expect(gen(restEdit, { id: 'p2', state: active(), lastPrescription: first, lastLog: log }).parameters.load.resolved).toEqual(kg(22.5))
    const startEdit = { ...load(rule('linear'), 40), revision: 2 }
    expect(gen(startEdit, { id: 'p3', state: active(), lastPrescription: first, lastLog: log }).parameters.load.resolved).toEqual(kg(40))
  })

  it('resolves pyramid offsets from the rounded anchor', () => {
    const r = { ...load(rule('pyramid'), 100), target: { mode: 'absolute', value: 150, unit: 'kg' } }
    const p = gen(r)
    expect(p.rows.map(row => [row.load.value, !!row.anchor])).toEqual([[70, false], [85, false], [100, true]])
    const next = gen(r, { id: 'p2', state: active(), lastPrescription: p, lastLog: logOf({ sets: 3, reps: 8, load: kg(100) }) })
    expect(next.rows.map(row => row.load.value)).toEqual([72.5, 87.5, 102.5])
  })

  it('slides a hold_seconds window by the earned steps, recovers its declared start, and survives a rule edit', () => {
    const r = rule('hold_seconds')
    const p = gen(r, { id: 'p2', state: active({ position: 2, readyToIncrement: false }), lastPrescription: gen(r) })
    expect(p.parameters.durationSeconds).toEqual({ min: 30, max: 40 })
    expect(p.prefill.durationSeconds).toBe(30)
    expect(ruleOfPrescription(p, 'rt1')).toEqual(r)
    const edited = { ...r, revision: 2, parameters: { ...r.parameters, durationSeconds: { min: 30, max: 40 } } }
    const q = gen(edited, { id: 'p3', state: active({ position: 1, readyToIncrement: false }), lastPrescription: p })
    expect(q.parameters.durationSeconds).toEqual({ min: 35, max: 45 })
  })

  it('gives each pyramid row its own reps when the offsets carry them, else the rule reps', () => {
    const rpt = { ...load(rule('reverse_pyramid'), 100), parameters: { ...load(rule('reverse_pyramid'), 100).parameters, reps: { min: 6, max: 6 } }, special: { offsets: [{ percentOfAnchor: 100 }, { percentOfAnchor: 90, reps: 8 }, { percentOfAnchor: 80, reps: 10 }] } }
    expect(gen(rpt).rows.map(row => [row.load.value, row.reps.min, row.reps.max, !!row.anchor])).toEqual([[100, 6, 6, true], [90, 8, 8, false], [80, 10, 10, false]])
    expect(gen(load(rule('reverse_pyramid'), 100)).rows.map(row => row.reps)).toEqual([{ min: 8, max: 8 }, { min: 8, max: 8 }, { min: 8, max: 8 }])
  })

  it('builds 5/3/1 weeks from the training max', () => {
    const direct = rule('five_three_one', r => ({ ...r, special: { ...r.special, trainingMax: { mode: 'direct', value: 100, unit: 'kg' } } }))
    const week1 = gen(direct)
    expect(week1.rows.map(row => [row.load.value, row.reps.min, !!row.amrap])).toEqual([[65, 5, false], [75, 5, false], [85, 5, true]])
    const week3 = gen(direct, { id: 'p2', state: active({ position: 2, trainingMax: kg(100) }), lastPrescription: week1 })
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
    const ranged = loadRange(rule('autoregulated'), { mode: 'absolute', value: 60, unit: 'kg' }, { mode: 'absolute', value: 80, unit: 'kg' })
    expect(ruleOfPrescription(gen(ranged), 'rt1')).toEqual(ranged)
  })

  it('resolves a load range and puts it on every row, the low end staying the basis', () => {
    const r = loadRange(rule('autoregulated'), { mode: 'absolute', value: 60, unit: 'kg' }, { mode: 'absolute', value: 81, unit: 'kg' })
    const p = gen(r)
    expect(p.parameters.load).toEqual({ expression: r.parameters.load, resolved: kg(60) })
    expect(p.parameters.loadTo).toEqual({ expression: r.parameters.loadTo, resolved: kg(80) })
    expect(p.basis).toEqual(r.parameters.load)
    expect(p.rows.map(row => [row.load, row.loadTo])).toEqual([0, 1, 2].map(() => [kg(60), kg(80)]))
    expect(Object.isFrozen(p.rows[0].loadTo)).toBe(true)
  })

  it('resolves a % 1RM load range from the frozen 1RM, or leaves both ends null without one', () => {
    const r = loadRange(rule('autoregulated'), { mode: 'percent_1rm', percent: 60 }, { mode: 'percent_1rm', percent: 75 })
    const p = gen(r, { oneRm: oneRm(100) })
    expect(p.snapshot1RM.value).toBe(100)
    expect(p.rows[0]).toMatchObject({ load: kg(60), loadTo: kg(75) })
    expect(gen(r).rows[0]).toMatchObject({ load: null, loadTo: null })
  })

  it('adds no loadTo to a fixed-load prescription', () => {
    const p = gen(rule('linear'))
    expect('loadTo' in p.parameters).toBe(false)
    expect(p.rows.some(row => 'loadTo' in row)).toBe(false)
  })
})

describe('warm-up rows', () => {
  const smart = { mode: 'smart', count: 3 }
  it('snapshots rounded rows into the hashed body without touching the rule revision', () => {
    const r = load(rule('linear'), 100)
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
    expect(gen(rule('manual'), { warmup: smart, equipment: 'barbell' }).warmupRows).toBeUndefined()      // empty load
    expect(gen(percentLinear(), { warmup: smart, equipment: 'barbell' }).warmupRows).toBeUndefined()     // no 1RM
  })
  it('never warms up a timed hold, even a loaded one', () => {
    const plank = load(rule('duration'), 20)
    expect(gen(plank, { warmup: smart, equipment: 'body weight' }).warmupRows).toBeUndefined()
  })
})
