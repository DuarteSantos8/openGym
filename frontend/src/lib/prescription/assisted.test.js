import { describe, expect, it } from 'vitest'
import { defaultPlanRule } from '../../../../api/engine/rules.js'
import { generatePrescription } from '../../../../api/engine/generate.js'
import { advanceProgression } from '../../../../api/engine/advance.js'
import { resolveProgressionContext } from '../../../../api/engine/context.js'
import { applyIncrement, resolveLoad } from '../../../../api/engine/load.js'
import { auditExecution, summarizeActual } from '../../../../api/engine/audit.js'
import { deloadedLoad } from '../../../../api/engine/deload.js'

// An assistance machine: the number is the help the stack gives, so less is harder (issue #232).
const NOW = '2026-09-24T10:00:00.000Z'
const kg = value => ({ value, unit: 'kg' })
const help = (value, patch = r => r) => {
  const r = defaultPlanRule('linear', { id: 'r1', exerciseId: 'ex1', unit: 'kg' })
  return { ...patch({ ...r, parameters: { ...r.parameters, load: { mode: 'absolute', value, unit: 'kg' } } }), target: { mode: 'none' }, completion: [] }
}
let n = 0
function session(r, previous, actual, extra = {}) {
  const prescription = generatePrescription({
    id: 'p' + ++n, now: NOW, trackId: 't1', rule: r, assisted: true, ...extra,
    ...(previous ? { state: previous.state, lastPrescription: previous.prescription, lastLog: { id: 'log' + n, actual: previous.actual } } : {})
  })
  return { prescription, actual, state: advanceProgression({ state: previous?.state ?? null, prescription, log: { id: 'log' + (n + 1000), actual }, now: NOW }) }
}
const clean = load => ({ sets: 3, reps: 5, load: kg(load) })
const short = load => ({ sets: 3, reps: 4, load: kg(load) })

describe('the load steps', () => {
  const inc = { type: 'absolute', value: 2.5, unit: 'kg' }
  it('an earned step takes help away, down to none and never below', () => {
    expect(applyIncrement({ mode: 'absolute', value: 40, unit: 'kg' }, inc, { assisted: true }).value).toBe(37.5)
    expect(applyIncrement({ mode: 'absolute', value: 1, unit: 'kg' }, inc, { assisted: true }).value).toBe(0)
    expect(applyIncrement({ mode: 'absolute', value: 0, unit: 'kg' }, inc, { assisted: true }).value).toBe(0)
    expect(applyIncrement({ mode: 'absolute', value: 40, unit: 'kg' }, inc).value).toBe(42.5)   // a normal lift still adds
    expect(applyIncrement({ mode: 'absolute', value: 100, unit: 'kg' }, { type: 'current_load_percent', value: 5 }, { assisted: true }).value).toBe(95)
  })
  it('the target is a floor on the help, not a cap on the work', () => {
    const rounding = { mode: 'nearest', step: 2.5 }
    expect(resolveLoad({ mode: 'absolute', value: 10, unit: 'kg' }, { rounding, cap: 15, assisted: true }).value).toBe(15)
    expect(resolveLoad({ mode: 'absolute', value: 20, unit: 'kg' }, { rounding, cap: 15, assisted: true }).value).toBe(20)
    expect(resolveLoad({ mode: 'absolute', value: 20, unit: 'kg' }, { rounding, cap: 15 }).value).toBe(15)
  })
})

describe('judging a session', () => {
  it('more help than prescribed is not a hit, less is, and no help at all is the best set there is', () => {
    const p = generatePrescription({ id: 'p', now: NOW, trackId: 't', rule: help(40), assisted: true })
    const earned = actual => advanceProgression({ state: null, prescription: p, log: { id: 'l', actual }, now: NOW }).readyToIncrement
    expect(earned(clean(40))).toBe(true)
    expect(earned(clean(35))).toBe(true)       // less help: harder, still a clean session
    expect(earned({ sets: 3, reps: 5, load: null })).toBe(true)   // no help logged
    expect(earned(clean(45))).toBe(false)      // more help than the plan asked
    // The same numbers on a normal lift read the other way round.
    const plain = generatePrescription({ id: 'p', now: NOW, trackId: 't', rule: help(40) })
    expect(advanceProgression({ state: null, prescription: plain, log: { id: 'l', actual: clean(35) }, now: NOW }).readyToIncrement).toBe(false)
  })
  it('the session\'s load is its weakest set: the one with the most help', () => {
    const p = generatePrescription({ id: 'p', now: NOW, trackId: 't', rule: help(40), assisted: true })
    const sets = [{ row: 0, reps: 5, load: kg(40) }, { row: 1, reps: 5, load: kg(30) }, { row: 2, reps: 5, load: kg(45) }]
    expect(summarizeActual(p, sets).load).toEqual(kg(45))
    expect(summarizeActual({ ...p, assisted: undefined }, sets).load).toEqual(kg(30))
  })
  it('a target the help must not go below warns when it is', () => {
    const p = generatePrescription({ id: 'p', now: NOW, trackId: 't', rule: { ...help(40), target: { mode: 'absolute', value: 10, unit: 'kg' } }, assisted: true })
    const codes = load => auditExecution(p, { row: 0, reps: 5, load: kg(load) }).map(f => f.code)
    expect(codes(5)).toContain('above_cap')
    expect(codes(10)).not.toContain('above_cap')
  })
})

describe('the assisted prescription', () => {
  it('takes help away after a clean session, and says so in the frozen prescription', () => {
    const one = session(help(40), null, clean(40))
    expect(one.prescription.assisted).toBe(true)
    expect(one.state.readyToIncrement).toBe(true)
    const two = session(help(40), one, clean(37.5))
    expect(two.prescription.parameters.load.resolved).toEqual(kg(37.5))
    expect(two.prescription.rows.every(r => r.load.value === 37.5)).toBe(true)
  })
  it('a normal lift is untouched by the flag being absent', () => {
    const p = generatePrescription({ id: 'p', now: NOW, trackId: 't', rule: help(40) })
    expect(p).not.toHaveProperty('assisted')
  })
  it('holds when the session fell short, and goes back to more help after three in a row', () => {
    let s = session(help(40), null, short(40))
    s = session(help(40), s, short(40))
    expect(s.prescription.parameters.load.resolved).toEqual(kg(40))
    s = session(help(40), s, short(40))
    expect(s.state).toMatchObject({ stalls: 3, readyToDeload: true })
    const back = session(help(40), s, short(42.5))   // the athlete trains at the new, easier load
    expect(back.prescription.parameters.load.resolved).toEqual(kg(42.5))   // one step more help, not 90 %
    expect(back.prescription.provenance.deload).toMatchObject({ stalls: 3, from: 40, to: 42.5, method: 'assist' })
    expect(back.state.stalls).toBe(1)   // the new load starts a new run
  })
  it('a session that needed even more help backs off from that', () => {
    let s = null
    for (let i = 0; i < 3; i++) s = session(help(40), s, short(45))
    expect(session(help(40), s, short(45)).prescription.parameters.load.resolved).toEqual(kg(47.5))
  })
  it('the help never goes below none however many clean sessions follow', () => {
    let s = session(help(2.5), null, clean(2.5))
    s = session(help(2.5), s, clean(0))
    expect(s.prescription.parameters.load.resolved).toEqual(kg(0))
    s = session(help(2.5), s, { sets: 3, reps: 5, load: null })
    expect(s.prescription.parameters.load.resolved).toEqual(kg(0))
  })
  it('deloadedLoad adds a step of help, from an allowed-values list too', () => {
    const args = { preset: 'linear', factor: 0.9, prescribed: 40, lifted: 40, reps: 5, assisted: true, step: 2.5 }
    expect(deloadedLoad({ ...args, rounding: { mode: 'nearest', step: 2.5 } })).toEqual({ value: 42.5, reps: null, method: 'assist' })
    expect(deloadedLoad({ ...args, rounding: { mode: 'allowed_values', allowedValues: [30, 40, 50] } }).value).toBe(50)
    expect(deloadedLoad({ ...args, step: null, rounding: { mode: 'nearest', step: 5 } }).value).toBe(45)
  })
})

describe('a restart on an assistance machine', () => {
  const rule = help(40)
  it('holds at the most help every set managed, not the least', () => {
    const p = generatePrescription({ id: 'p0', now: NOW, trackId: 't1', rule, assisted: true })
    const x = { exposureId: 'x0', exerciseId: 'ex1', trackId: 't1', prescriptionId: 'p0', excludedFromProgression: false,
      performance: { sets: [30, 35].map(value => ({ role: 'work', status: 'completed', observations: [], resistance: { kind: 'external-load', value, unit: 'kg' }, segments: [] })) } }
    const held = assisted => resolveProgressionContext({ trackId: 't1', exerciseId: 'ex1', rule, assisted, workouts: [{ exposures: [{ ...x, prescriptionId: null }] }], prescriptions: { p0: p }, progression: {} }).heldLoad
    expect(held(true)).toEqual(kg(35))
    expect(held(false)).toEqual(kg(30))
  })
})
