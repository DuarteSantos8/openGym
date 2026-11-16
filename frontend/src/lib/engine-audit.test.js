import { describe, expect, it } from 'vitest'
import { buildSessionExposures } from './session-start.js'
import { entriesForExposures } from './session-ui-adapter.js'
import { buildCompletedSession } from './finish-session.js'
import { ruleOccurrence } from './test-fixtures.js'
import { defaultPlanRule } from './prescription/index.js'

// Audit of the v2 progression engine against what v1 (progression.js, main) did: each test states
// the v1 behaviour a confirmed divergence (REPORT.md P1…P4) used to break.
const DAY = 24 * 3600 * 1000
const T0 = Date.UTC(2026, 8, 1)
const profile = () => ({ unit: 'kg', workouts: [], prescriptions: {}, oneRepMaxes: {}, progression: {} })
const start = (S, occ, day) => {
  const exposures = buildSessionExposures(S, { id: 'r1', ex: [occ] }, { now: T0 + day * DAY, newId: s => s, unit: 'kg' })
  return { id: 'w' + day, d: 'd' + day, start: 1, routineIds: ['r1'], name: 'T', exposures, entries: entriesForExposures(exposures, S.prescriptions) }
}
// `rows`: what the athlete did, as [reps, done?] per work row (weight/sec untouched).
const finish = (S, a, day, edit = () => {}) => {
  edit(a.entries[0].sets.filter(s => s.phase !== 'warmup'))
  const { session, progression } = buildCompletedSession(a, S, { end: T0 + day * DAY + 1000, newId: s => s, unit: 'kg' })
  S.workouts.push(session)
  Object.assign(S.progression, progression)
  return session.exposures[0]
}
const prescriptionOf = (S, a) => S.prescriptions[a.exposures[0].prescriptionId]
const doAll = rows => rows.forEach(s => { s.done = true })

const linear = (load = 60) => ruleOccurrence('0025', { options: { target: { mode: 'none' }, completion: [], load: { mode: 'absolute', value: load, unit: 'kg' } } })
const double = (load = 50) => ruleOccurrence('0025', { preset: 'double', options: { target: { mode: 'none' }, completion: [], sets: { min: 3, max: 3 }, reps: { min: 8, max: 12 }, load: { mode: 'absolute', value: load, unit: 'kg' } } })
const ladder = () => ruleOccurrence('3293', { preset: 'bodyweight_ladder', routineId: null, options: { sets: { min: 3, max: 6 }, reps: { min: 10, max: 12 }, completion: [] } })

describe('P1 — an exercise left untouched in a finished session', () => {
  // v1 (finish-workout.js) dropped any entry with no completed set, and readers skipped sessions
  // with no done set, so a skipped exercise was invisible to progression. v2 advances the track
  // with `sets: 0`, which `advance.js` reads as a miss: three skipped sessions deload the lift.
  it('does not count as a stall (skipped exercise must not deload)', () => {
    const S = profile(), occ = linear(100)
    for (const day of [0, 1, 2]) finish(S, start(S, occ, day), day)          // nothing checked off
    expect(S.progression['occ-0025']?.stalls ?? 0).toBe(0)
    expect(prescriptionOf(S, start(S, occ, 3)).parameters.load.resolved.value).toBe(100)
  })
})

describe('P2 — bodyweight ladder', () => {
  it('a set left unchecked does not shrink the next session', () => {
    const S = profile(), occ = ladder()
    const a1 = start(S, occ, 0)
    finish(S, a1, 0, rows => { rows.forEach((s, i) => { s.done = i < 2 }) })   // 3 prescribed, 2 done
    expect(prescriptionOf(S, start(S, occ, 1)).rows.length).toBe(3)
  })
  it('one weak set does not drag the next target below the plan (v1: "same target again")', () => {
    const S = profile(), occ = ladder()
    const a1 = start(S, occ, 0)
    finish(S, a1, 0, rows => { rows.forEach((s, i) => { s.done = true; s.r = i === 2 ? 4 : 10 }) })
    expect(prescriptionOf(S, start(S, occ, 1)).prefill.reps).toBeGreaterThanOrEqual(10)
  })
})

describe('P3 — double progression', () => {
  // v1 stallCount (PR !93): at one weight, a session that beats the best of the run is progress, not a stall.
  it('improving but short sessions at one weight do not deload', () => {
    const S = profile(), occ = double(50)
    // lows 5, 6, 7 reps against an aim of 8: always short, always better than before
    for (const [day, low] of [[0, 5], [1, 6], [2, 7]]) finish(S, start(S, occ, day), day, rows => { doAll(rows); rows.forEach(s => { s.r = low }) })
    expect(prescriptionOf(S, start(S, occ, 3)).parameters.load.resolved.value).toBe(50)
  })
  it('after a session short of the aim, the next aim is low + 1 (v1), not the same reps again', () => {
    const S = profile(), occ = double(50)
    finish(S, start(S, occ, 0), 0, rows => { doAll(rows); rows.forEach(s => { s.r = 9 }) })    // aim 8 → clean, climbs to 10
    const a2 = start(S, occ, 1)
    expect(a2.entries[0].sets.find(s => s.phase !== 'warmup').r).toBe(10)
    finish(S, a2, 1, rows => { doAll(rows); rows.forEach(s => { s.r = 9 }) })                   // missed 10 by one
    expect(prescriptionOf(S, start(S, occ, 2)).prefill.reps).toBe(10)                            // v1: low (9) + 1
  })
})

describe('P3 — a stagnating double still deloads', () => {
  it('three sessions at the same short reps deload', () => {
    const S = profile(), occ = double(50)
    for (const day of [0, 1, 2]) finish(S, start(S, occ, day), day, rows => { doAll(rows); rows.forEach(s => { s.r = 5 }) })
    expect(prescriptionOf(S, start(S, occ, 3)).parameters.load.resolved.value).toBeLessThan(50)
  })
})

describe('P4 — the lifter overrides the prescribed load', () => {
  // v1 judged a session by reps only and built the next load from the heaviest load lifted
  // (readSession.weight); v2 increments the *prescribed* load, so the lifter's own jump is ignored.
  it('lifting 70 against a prescribed 60, every rep clean, continues from 70', () => {
    const S = profile(), occ = linear(60)
    finish(S, start(S, occ, 0), 0, rows => { doAll(rows); rows.forEach(s => { s.w = 70 }) })
    expect(prescriptionOf(S, start(S, occ, 1)).parameters.load.resolved.value).toBe(72.5)
  })
  it('lifting 50 against a prescribed 60, every rep clean, is not read as a miss (v1: 52.5)', () => {
    const S = profile(), occ = linear(60)
    finish(S, start(S, occ, 0), 0, rows => { doAll(rows); rows.forEach(s => { s.w = 50 }) })
    expect(S.progression['occ-0025'].stalls).toBe(0)
  })
})

describe('P4 — mixed loads in one session', () => {
  it('60, 60, 50 continues from the heaviest set (v1: 62.5)', () => {
    const S = profile(), occ = linear(60)
    finish(S, start(S, occ, 0), 0, rows => { doAll(rows); rows.forEach((s, i) => { s.w = i === 2 ? 50 : 60 }) })
    expect(prescriptionOf(S, start(S, occ, 1)).parameters.load.resolved.value).toBe(62.5)
  })
})
