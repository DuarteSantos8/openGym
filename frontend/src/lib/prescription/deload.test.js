import { describe, expect, it } from 'vitest'
import { defaultPlanRule, validatePlanRule, cardioParameters } from '../../../../api/engine/rules.js'
import { generatePrescription, ruleOfPrescription } from '../../../../api/engine/generate.js'
import { advanceProgression, initialProgressionState } from '../../../../api/engine/advance.js'
import { summarizeActual } from '../../../../api/engine/audit.js'
import { DELOAD_AFTER, defaultDeload, deloadLoad, deloadPercent, deloadedLoad, deloadedPosition, selectDeloadCandidate } from '../../../../api/engine/deload.js'

const NOW = '2026-09-24T10:00:00.000Z'
const kg = value => ({ value, unit: 'kg' })
// No terminal target: a track that keeps progressing, the way a migrated one does.
const rule = (preset, patch = r => r) => {
  const r = patch(defaultPlanRule(preset, { id: 'r1', exerciseId: 'ex1', unit: 'kg' }))
  return { ...r, target: { mode: 'none' }, completion: [] }
}
const loaded = (preset, value = 100, patch = r => r) => rule(preset, r => patch({ ...r, parameters: { ...r.parameters, load: { mode: 'absolute', value, unit: 'kg' } } }))
let n = 0
// One finished session on a track: the prescription it was made from and the state it leaves.
function session(r, previous, actual, extra = {}) {
  const prescription = generatePrescription({
    id: 'p' + ++n, now: NOW, trackId: 't1', rule: r, ...extra,
    ...(previous ? { state: previous.state, lastPrescription: previous.prescription, lastLog: { id: 'log' + n, actual: previous.actual } } : {})
  })
  return { prescription, actual, state: advanceProgression({ state: previous?.state ?? null, prescription, log: { id: 'log' + (n + 1000), actual }, now: NOW }) }
}
const miss = (load = 100) => ({ sets: 3, reps: 4, load: kg(load) })
const clean = (load = 100) => ({ sets: 3, reps: 5, load: kg(load) })

describe('deloadLoad (v1 deloadTo)', () => {
  const grid = { mode: 'nearest', step: 2.5 }
  it('backs off by the factor onto the grid', () => {
    expect(deloadLoad(100, 0.9, grid)).toBe(90)
    expect(deloadLoad(20, 0.9, grid)).toBe(17.5)
    expect(deloadLoad(62.5, 0.9, { mode: 'nearest', step: 5 })).toBe(55)
  })
  it('is always at least a step lower, and never below one', () => {
    expect(deloadLoad(5, 0.95, grid)).toBe(2.5)
    expect(deloadLoad(2.5, 0.9, grid)).toBe(2.5)
  })
  it('walks an allowed-values list', () => {
    expect(deloadLoad(30, 0.9, { mode: 'allowed_values', allowedValues: [10, 15, 20, 25, 30] })).toBe(25)
    expect(deloadLoad(10, 0.9, { mode: 'allowed_values', allowedValues: [10, 15, 20] })).toBe(10)
  })
  it('a percent load backs off by the same factor, at least a point', () => {
    expect(deloadPercent(70, 0.9)).toBe(63)
    expect(deloadPercent(1, 0.95)).toBe(1)
  })
})

describe('the Epley deload (v1 selectDeloadCandidate)', () => {
  const rounding = { mode: 'nearest', step: 2.5 }
  it('linear takes the factor of the load and keeps the reps', () => {
    expect(deloadedLoad({ preset: 'linear', rounding, factor: 0.9, prescribed: 100, lifted: 100, reps: 5 })).toEqual({ value: 90, reps: 5, method: 'epley' })
  })
  it('double progression may give up reps at the same load range instead of only load', () => {
    expect(deloadedLoad({ preset: 'double', rounding, factor: 0.9, prescribed: 60, lifted: 60, reps: 12, repsMin: 8 })).toEqual({ value: 55, reps: 11, method: 'epley' })
    expect(deloadedLoad({ preset: 'double', rounding, factor: 0.9, prescribed: 60, lifted: 60, reps: 9, repsMin: 8 })).toEqual({ value: 55, reps: 8, method: 'epley' })
  })
  it('Greyskull, rest-pause rows and a list of allowed values take the plain factor', () => {
    const base = { rounding, factor: 0.9, prescribed: 100, lifted: 100, reps: 5 }
    expect(deloadedLoad({ ...base, preset: 'greyskull' })).toEqual({ value: 90, reps: null, method: 'factor' })
    expect(deloadedLoad({ ...base, preset: 'linear', restPause: true })).toEqual({ value: 90, reps: null, method: 'factor' })
    expect(deloadedLoad({ ...base, preset: 'linear', rounding: { mode: 'allowed_values', allowedValues: [80, 90, 100] } }).method).toBe('factor')
  })
  it('backs off from what was lifted when that was lighter than prescribed', () => {
    expect(deloadedLoad({ preset: 'greyskull', rounding, factor: 0.9, prescribed: 100, lifted: 80, reps: 5 }).value).toBe(72.5)
  })
  it('counts unilateral reps per side', () => {
    const found = selectDeloadCandidate({ currentWeight: 20, targetWeight: 20, targetReps: 10, step: 2.5, factor: 0.9, reps: 10, repsMin: 8, perSide: true })
    expect(found.reps % 2).toBe(0)
    expect(found.weight).toBeLessThanOrEqual(20)
  })
})

describe('stalls and readiness', () => {
  it('counts sessions short of the plan at one load, and a clean session ends the run', () => {
    const r = loaded('linear')
    const one = session(r, null, miss())
    const two = session(r, one, miss())
    expect(one.state).toMatchObject({ stalls: 1, stallLoad: 100, readyToDeload: false })
    expect(two.state).toMatchObject({ stalls: 2, readyToDeload: false })
    expect(session(r, two, miss()).state).toMatchObject({ stalls: 3, readyToDeload: true, readyToIncrement: false })
    expect(session(r, two, clean()).state).toMatchObject({ stalls: 0, stallLoad: null, readyToDeload: false, readyToIncrement: true })
  })

  it('a clean session that has not reached the top of a double range is a hold, not a stall', () => {
    const r = loaded('double', 60)
    const held = session(r, null, { sets: 3, reps: 10, load: kg(60) })
    expect(held.state).toMatchObject({ stalls: 0, readyToIncrement: false, readyToDeload: false })
  })

  it('a different load starts a new run', () => {
    const r = loaded('linear')
    const one = session(r, null, miss(100))
    expect(session(r, one, miss(95)).state.stalls).toBe(1)
  })

  it('Greyskull backs off after a single miss', () => {
    expect(session(loaded('greyskull'), null, miss()).state).toMatchObject({ stalls: 1, readyToDeload: true })
  })

  it('a rule with no deload, or a preset that cannot stall, is never ready', () => {
    const { deload, ...bare } = loaded('linear')
    let s = null
    for (let i = 0; i < 5; i++) s = session(bare, s, miss())
    expect(s.state).toMatchObject({ stalls: 5, readyToDeload: false })
    expect(session(rule('manual'), null, miss()).state.readyToDeload).toBeFalsy()
  })

  it('older states that never counted read as no run', () => {
    const { stalls, stallLoad, readyToDeload, ...old } = initialProgressionState('t1')
    const p = generatePrescription({ id: 'p1', now: NOW, trackId: 't1', rule: loaded('linear') })
    expect(advanceProgression({ state: old, prescription: p, log: { id: 'l', actual: miss() }, now: NOW })).toMatchObject({ stalls: 1, stallLoad: 100 })
  })
})

describe('the deloaded prescription', () => {
  const stalled = (r, times = 3) => {
    let s = null
    for (let i = 0; i < times; i++) s = session(r, s, miss())
    return s
  }

  it('lowers the load once the run is long enough, and says why', () => {
    const next = session(loaded('linear'), stalled(loaded('linear')), miss(90))
    expect(next.prescription.parameters.load.resolved).toEqual(kg(90))
    expect(next.prescription.rows.every(row => row.load.value === 90)).toBe(true)
    expect(next.prescription.provenance.deload).toEqual({ stalls: 3, from: 100, to: 90, method: 'epley', reps: 5 })
    // The lighter rows open the session: the last lifted load is not carried over them.
    expect(next.prescription.prefill.load).toBe(null)
  })

  it('does nothing before then, and never on a restart', () => {
    const r = loaded('linear')
    expect(session(r, stalled(r, 2), miss()).prescription.parameters.load.resolved).toEqual(kg(100))
    expect(generatePrescription({ id: 'x', now: NOW, trackId: 't1', rule: r, reset: 'plan_changed', heldLoad: kg(100), state: stalled(r).state, lastPrescription: stalled(r).prescription, lastLog: { id: 'l', actual: miss() } }).provenance.deload).toBeUndefined()
  })

  it('progression carries on from the lighter load', () => {
    const r = loaded('linear')
    const light = session(r, stalled(r), clean(90))
    expect(light.state.readyToIncrement).toBe(true)
    expect(session(r, light, clean(92.5)).prescription.parameters.load.resolved).toEqual(kg(92.5))
  })

  it('a double-progression deload can trade reps for load', () => {
    const r = loaded('double', 60)
    let s = null
    for (let i = 0; i < 3; i++) s = session(r, s, { sets: 3, reps: 6, load: kg(60) })
    const next = session(r, s, { sets: 3, reps: 6, load: kg(55) })
    expect(next.prescription.provenance.deload).toMatchObject({ stalls: 3, from: 60, method: 'epley' })
    expect(next.prescription.parameters.load.resolved.value).toBeLessThan(60)
    expect(next.prescription.prefill.reps).toBe(next.prescription.provenance.deload.reps)
  })

  it('a percent-of-1RM load backs off by the factor', () => {
    const r = rule('linear', x => ({ ...x, parameters: { ...x.parameters, load: { mode: 'percent_1rm', percent: 70 } }, increment: { type: 'percentage_points', value: 2.5 } }))
    const oneRm = { id: 'o', exerciseId: 'ex1', value: 100, unit: 'kg', source: 'manual', capturedAt: '2026-09-01T00:00:00.000Z' }
    let s = null
    for (let i = 0; i < 3; i++) s = session(r, s, miss(70), { oneRm })
    expect(session(r, s, miss(63), { oneRm }).prescription.parameters.load.expression).toEqual({ mode: 'percent_1rm', percent: 63 })
  })

  it('carries the setting in the frozen prescription and reads back as the rule', () => {
    const r = loaded('greyskull')
    const p = generatePrescription({ id: 'p', now: NOW, trackId: 't', rule: r })
    expect(p.deload).toEqual({ after: 1, factor: 0.9 })
    expect(ruleOfPrescription(p).deload).toEqual({ after: 1, factor: 0.9 })
    const { deload, ...bare } = r
    expect(generatePrescription({ id: 'p', now: NOW, trackId: 't', rule: bare })).not.toHaveProperty('deload')
  })
})

describe('a timed hold backs off by sliding its window back (v1 deloadTo(goal, 5))', () => {
  const hold = rule('hold_seconds', r => ({ ...r, parameters: { ...r.parameters, durationSeconds: { min: 60, max: 60 } } }))
  const held = seconds => ({ sets: 3, reps: null, durationSeconds: seconds })
  it('slides up after a clean session and back after three short ones', () => {
    let s = session(hold, null, held(60))
    s = session(hold, s, held(65))
    expect(s.prescription.parameters.durationSeconds).toEqual({ min: 65, max: 65 })
    expect(s.state.position).toBe(2)
    for (let i = 0; i < 3; i++) s = session(hold, s, held(50))
    expect(s.state).toMatchObject({ stalls: 3, readyToDeload: true, position: 2 })
    const back = session(hold, s, held(50))
    expect(back.prescription.parameters.durationSeconds).toEqual({ min: 65, max: 65 })
    expect(back.prescription.provenance.deload).toEqual({ stalls: 3, from: 70, to: 65, method: 'seconds' })
    // The lighter window is where the track stands now, and a miss there starts a new run.
    expect(back.state).toMatchObject({ position: 1, stalls: 1, readyToDeload: false })
  })
  it('never slides below one grid step of work', () => {
    expect(deloadedPosition({ startSeconds: 5, step: 5, position: 0, factor: 0.9 })).toBe(0)
    expect(deloadedPosition({ startSeconds: 20, step: 5, position: 1, factor: 0.9 })).toBe(0)
    expect(deloadedPosition({ startSeconds: 60, step: 0, position: 3, factor: 0.9 })).toBe(3)
  })
  it('reads back as the rule the window slid from, deloaded or not', () => {
    let s = session(hold, null, held(60))
    for (let i = 0; i < 3; i++) s = session(hold, s, held(50))
    const back = session(hold, s, held(50))
    expect(ruleOfPrescription(back.prescription).parameters.durationSeconds).toEqual({ min: 60, max: 60 })
  })
})

describe('defaults and validation', () => {
  it('a new progressing rule starts with v1\'s deload for its policy', () => {
    for (const preset of Object.keys(DELOAD_AFTER)) expect(defaultPlanRule(preset, { id: 'r', exerciseId: 'e', unit: 'kg' }).deload).toEqual(defaultDeload(preset))
    expect(defaultPlanRule('linear', { id: 'r', exerciseId: 'e', unit: 'kg' }).deload).toEqual({ after: 3, factor: 0.9 })
    expect(defaultPlanRule('greyskull', { id: 'r', exerciseId: 'e', unit: 'kg' }).deload).toEqual({ after: 1, factor: 0.9 })
    for (const preset of ['manual', 'autoregulated', 'duration', 'bodyweight_ladder', 'pyramid']) expect(defaultPlanRule(preset, { id: 'r', exerciseId: 'e', unit: 'kg' })).not.toHaveProperty('deload')
  })
  it('refuses a deload that is malformed or on a preset that cannot stall', () => {
    const base = defaultPlanRule('linear', { id: 'r', exerciseId: 'e', unit: 'kg' })
    const errorsOf = deload => validatePlanRule({ ...base, deload }).errors
    expect(errorsOf({ after: 3, factor: 0.85 })).toEqual([])
    expect(errorsOf({ after: 0, factor: 0.9 })[0]).toMatch(/deload\.after/)
    expect(errorsOf({ after: 3, factor: 0.4 })[0]).toMatch(/deload\.factor/)
    expect(errorsOf({ after: 3, factor: 0.99 })[0]).toMatch(/deload\.factor/)
    expect(errorsOf({ after: 3 })[0]).toMatch(/must be/)
    expect(validatePlanRule({ ...defaultPlanRule('manual', { id: 'r', exerciseId: 'e', unit: 'kg' }), deload: { after: 3, factor: 0.9 } }).errors[0]).toMatch(/does not deload/)
  })
})

describe('cardio speed', () => {
  const cardio = () => ({ ...defaultPlanRule('manual', { id: 'r', exerciseId: 'c', unit: 'kg' }), parameters: { ...defaultPlanRule('manual', { id: 'r', exerciseId: 'c', unit: 'kg' }).parameters, ...cardioParameters({ sets: 2, min: 25, speed: 9.5 }) } })
  it('is a validated parameter that needs a duration', () => {
    expect(validatePlanRule(cardio()).ok).toBe(true)
    const noDuration = { ...cardio(), parameters: { ...cardio().parameters, durationSeconds: undefined } }
    expect(validatePlanRule(noDuration).errors.join()).toMatch(/speed needs/)
    expect(validatePlanRule({ ...cardio(), parameters: { ...cardio().parameters, speed: 0 } }).errors.join()).toMatch(/speed must be/)
  })
  it('reaches the prescription and its prefill, and the rule it reads back as', () => {
    const p = generatePrescription({ id: 'p', now: NOW, trackId: 't', rule: cardio() })
    expect(p.parameters).toMatchObject({ speed: 9.5, durationSeconds: { min: 1500, max: 1500 } })
    expect(p.prefill).toMatchObject({ speed: 9.5, durationSeconds: 1500 })
    expect(ruleOfPrescription(p).parameters.speed).toBe(9.5)
  })
  it('starts from last time\'s speed when the athlete chose that', () => {
    const p = generatePrescription({ id: 'p', now: NOW, trackId: 't', rule: cardio() })
    const state = { ...advanceProgression({ state: null, prescription: p, log: { id: 'l', actual: { sets: 2, reps: null, durationSeconds: 1500, speed: 10 } }, now: NOW }) }
    const next = generatePrescription({ id: 'p2', now: NOW, trackId: 't', rule: cardio(), state, lastPrescription: p, lastLog: { id: 'l', actual: { sets: 2, durationSeconds: 1500, speed: 10 } }, startFrom: 'last' })
    expect(next.prefill.speed).toBe(10)
  })
  it('the actual summary carries the slowest deciding speed', () => {
    const p = generatePrescription({ id: 'p', now: NOW, trackId: 't', rule: cardio() })
    expect(summarizeActual(p, [{ row: 0, durationSeconds: 1500, speed: 9 }, { row: 1, durationSeconds: 1500, speed: 10 }]).speed).toBe(9)
  })
})
