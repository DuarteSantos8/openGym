import { describe, expect, it } from 'vitest'
import { buildSessionExposures } from './session-start.js'
import { entriesForExposures } from './session-ui-adapter.js'
import { buildCompletedSession } from './finish-session.js'
import { ruleOccurrence } from './test-fixtures.js'
import { EXIDX, isAssisted } from './exercises.js'

// start -> finish -> write state -> start, on real functions and a store-shaped profile.
const DAY = 24 * 3600 * 1000
const T0 = Date.UTC(2026, 8, 1)
const linear = (target = 25, revision = 1) => ruleOccurrence('0025', { patch: r => ({ ...r, revision, target: { mode: 'absolute', value: target, unit: 'kg' } }) })
const profile = () => ({ unit: 'kg', workouts: [], prescriptions: {}, oneRepMaxes: {}, progression: {} })
const start = (S, occ, day) => {
  const exposures = buildSessionExposures(S, { id: 'r1', ex: [occ] }, { now: T0 + day * DAY, newId: s => s, unit: 'kg' })
  return { id: 'w' + day, d: 'd' + day, start: 1, routineIds: ['r1'], name: 'Push', exposures, entries: entriesForExposures(exposures, S.prescriptions) }
}
const finish = (S, active, day) => {
  active.entries[0].sets.forEach(s => { s.done = true })
  const { session, progression } = buildCompletedSession(active, S, { end: T0 + day * DAY + 1000, newId: s => s, unit: 'kg' })
  S.workouts.push(session)
  Object.assign(S.progression, progression)
  return session.exposures[0]
}
const loadOf = (S, active) => S.prescriptions[active.exposures[0].prescriptionId].parameters.load.resolved.value
const session = (S, occ, day) => { const a = start(S, occ, day); return { a, log: finish(S, a, day) } }

describe('prescription lifecycle (linear 20 kg -> 25 kg, +2.5)', () => {
  it('A7: finishing a unilateral session estimates 1RM from a limb, not combined reps', () => {
    const S = profile()
    const a = start(S, { ...linear(), side: true }, 0)
    a.entries[0].sets = [{ w: 20, r: 10, done: true, setId: 'r0', sides: {
      L: { w: 20, r: 5, done: true }, R: { w: 20, r: 5, done: true }
    } }]
    const result = buildCompletedSession(a, S, { end: T0 + 1000, newId: s => s, unit: 'kg' })
    expect(result.oneRepMaxes[0].value).toBe(23.3)
  })
  it('increments once per finished session; an abandoned start adds nothing', () => {
    const S = profile(), occ = linear()
    const { a: a1 } = session(S, occ, 0)
    expect(loadOf(S, a1)).toBe(20)
    start(S, occ, 1)                          // generated, never finished
    const a2 = start(S, occ, 2)               // next start: still one step from the finished session
    expect(loadOf(S, a2)).toBe(22.5)
  })

  it('completes at the target, holds, and later sessions are not out-of-plan for it alone', () => {
    const S = profile(), occ = linear()
    session(S, occ, 0); session(S, occ, 1)
    const a3 = start(S, occ, 2); expect(loadOf(S, a3)).toBe(25)
    finish(S, a3, 2)
    expect(S.progression['occ-0025']).toMatchObject({ status: 'completed', readyToIncrement: false })
    const a4 = start(S, occ, 3)
    expect(S.prescriptions[a4.exposures[0].prescriptionId]).toMatchObject({ statusAtGeneration: 'completed' })
    expect(loadOf(S, a4)).toBe(25)
    const log4 = finish(S, a4, 3)
    expect(log4.audit.map(f => f.code)).toContain('completed_track')
    const a5 = start(S, occ, 4)
    expect(loadOf(S, a5)).toBe(25)
    expect(S.prescriptions[a5.exposures[0].prescriptionId].provenance.derivedFromOutOfPlan).toBe(false)
  })

  it('an edited rule reopens the track and the finished session is not audited as completed', () => {
    const S = profile()
    session(S, linear(), 0); session(S, linear(), 1); session(S, linear(), 2)
    const edited = linear(30, 2)
    const a4 = start(S, edited, 3)
    expect(S.prescriptions[a4.exposures[0].prescriptionId].statusAtGeneration).toBe('active')
    const log4 = finish(S, a4, 3)
    expect(log4.audit.map(f => f.code)).not.toContain('completed_track')
    expect(S.progression['occ-0025']).toMatchObject({ status: 'active', planRuleRevision: 2 })
  })
})

describe('deload lifecycle (linear 60 kg, three short sessions in a row)', () => {
  const plan = (patch = r => r) => ruleOccurrence('0025', { patch: r => patch({ ...r, target: { mode: 'none' }, completion: [], parameters: { ...r.parameters, load: { mode: 'absolute', value: 60, unit: 'kg' } } }) })
  // A session where every work set stopped one rep short.
  const shortSession = (S, occ, day) => {
    const a = start(S, occ, day)
    a.entries[0].sets.forEach(s => { s.r = 4 })
    return { a, log: finish(S, a, day) }
  }
  it('the fourth session opens lighter and says why, and progression carries on from there', () => {
    const S = profile(), occ = plan()
    for (const day of [0, 1, 2]) shortSession(S, occ, day)
    expect(S.progression['occ-0025']).toMatchObject({ stalls: 3, readyToDeload: true })
    const a4 = start(S, occ, 3)
    const p4 = S.prescriptions[a4.exposures[0].prescriptionId]
    expect(p4.parameters.load.resolved.value).toBe(55)   // 54 kg, onto the 2.5 kg grid
    expect(p4.provenance.deload).toMatchObject({ stalls: 3, from: 60, to: 55, method: 'epley' })
    expect(a4.entries[0].sets.map(s => s.w)).toEqual([55, 55, 55])
    finish(S, a4, 3)
    expect(S.progression['occ-0025']).toMatchObject({ stalls: 0, readyToIncrement: true, readyToDeload: false })
    expect(loadOf(S, start(S, occ, 4))).toBe(57.5)
  })
  it('a rule that turned the deload off keeps asking for the same load', () => {
    const S = profile(), occ = plan(({ deload, ...r }) => r)
    for (const day of [0, 1, 2, 3]) shortSession(S, occ, day)
    expect(S.progression['occ-0025']).toMatchObject({ stalls: 4, readyToDeload: false })
    expect(loadOf(S, start(S, occ, 4))).toBe(60)
  })
})

describe('a cardio interval, start to finish', () => {
  const cardio = ruleOccurrence('3220', {
    preset: 'manual', patch: r => ({ ...r, parameters: { ...r.parameters, sets: { min: 1, max: 1 }, reps: { min: 1, max: 1 }, durationSeconds: { min: 1500, max: 1500 }, speed: 9.5 } })
  })
  it('opens as minutes and speed, and is logged and saved as cardio', () => {
    const S = profile()
    const a = start(S, { ...cardio, mode: 'cardio' }, 0)
    expect(a.entries[0].target).toMatchObject({ mode: 'cardio', min: 25, speed: 9.5 })
    expect(a.entries[0].sets).toEqual([{ setId: 'r0', done: false, min: 25, speed: 9.5 }])
    a.entries[0].sets[0].min = 30
    const log = finish(S, a, 0)
    expect(log.mode).toBe('cardio')
    expect(log.performance.sets[0].observations).toEqual([{ metric: 'duration', unit: 's', value: 1800 }, { metric: 'speed', unit: 'kmh', value: 9.5 }])
    expect(log.actual).toMatchObject({ sets: 1, durationSeconds: 1800, speed: 9.5 })
  })
})

describe('an assistance machine, start to finish (the load is the help, so progress is less of it)', () => {
  const MACHINE = Object.keys(EXIDX).find(k => isAssisted(k))
  const plan = (id = MACHINE, extra = {}) => ({ ...ruleOccurrence(id, { patch: r => ({ ...r, target: { mode: 'none' }, completion: [], parameters: { ...r.parameters, load: { mode: 'absolute', value: 40, unit: 'kg' } } }) }), ...extra })
  const shortSession = (S, occ, day) => {
    const a = start(S, occ, day)
    a.entries[0].sets.forEach(s => { s.r = 4 })
    return { a, log: finish(S, a, day) }
  }
  it('every clean session takes 2.5 kg of help away', () => {
    const S = profile(), occ = plan()
    const loads = [0, 1, 2].map(day => { const { a } = session(S, occ, day); return loadOf(S, a) })
    expect(loads).toEqual([40, 37.5, 35])
    expect(S.prescriptions[S.workouts[0].exposures[0].prescriptionId].assisted).toBe(true)
    expect(loadOf(S, start(S, occ, 3))).toBe(32.5)
  })
  it('a normal lift on the same rule adds instead', () => {
    const S = profile(), occ = plan('0025')
    const loads = [0, 1].map(day => { const { a } = session(S, occ, day); return loadOf(S, a) })
    expect(loads).toEqual([40, 42.5])
  })
  it('three short sessions in a row go back to more help, and progress resumes from there', () => {
    const S = profile(), occ = plan()
    for (const day of [0, 1, 2]) shortSession(S, occ, day)
    const a4 = start(S, occ, 3)
    expect(loadOf(S, a4)).toBe(42.5)
    expect(S.prescriptions[a4.exposures[0].prescriptionId].provenance.deload).toMatchObject({ from: 40, to: 42.5, method: 'assist' })
    expect(a4.entries[0].sets.map(s => s.w)).toEqual([42.5, 42.5, 42.5])
    finish(S, a4, 3)
    expect(loadOf(S, start(S, occ, 4))).toBe(40)
  })
  it('an occurrence can say a machine is not assisted, or that another is', () => {
    const S = profile()
    expect(loadOf(S, session(S, plan(MACHINE, { assisted: false }), 0).a)).toBe(40)
    expect(loadOf(S, start(S, plan(MACHINE, { assisted: false }), 1))).toBe(42.5)
    const T = profile()
    session(T, plan('0025', { assisted: true }), 0)
    expect(loadOf(T, start(T, plan('0025', { assisted: true }), 1))).toBe(37.5)
  })
})
