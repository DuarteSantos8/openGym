import { describe, expect, it } from 'vitest'
import { defaultPlanRule, generatePrescription, replayProgression, reconcileDerivedOneRms, validatePlanRule } from './prescription/index.js'
import { buildSessionExposures } from './session-start.js'
import { entriesForExposures, rowsOfPerformance } from './session-ui-adapter.js'
import { buildCompletedSession, recordsOf } from './finish-session.js'
import { bestWeightFor, workoutVolume } from './history.js'
import { migratedFixture, loggedExposure } from './test-fixtures.js'
import { fatigueOf, strengthOf } from './recovery.js'
import { loadOfWorkouts } from './muscles.js'
import { editCompletedSession } from './session-edit.js'
import { perSetSessions } from './per-set.js'

const fixed = n => ({ min: n, max: n })
const absolute = value => ({ mode: 'absolute', value, unit: 'kg' })
const routineFor = (preset = 'linear', options = {}, extras = {}) => ({ id: 'routine', ex: [{
  occurrenceId: 'track', exerciseId: '0289', ...extras,
  rule: defaultPlanRule(preset, { id: 'rule', exerciseId: '0289', routineId: 'routine', completion: [], target: { mode: 'none' }, ...options })
}] })
const profileFor = routine => ({ engineSchemaVersion: 2, unit: 'kg', routines: [routine], workouts: [], prescriptions: {}, progression: {}, oneRepMaxes: {} })
function start(profile, routine) {
  const now = Date.parse('2026-10-01T12:00:00Z') + profile.workouts.length * 86400000
  const exposures = buildSessionExposures(profile, routine, { now, newId: s => s })
  return { id: 'workout-' + profile.workouts.length, d: new Date(now).toISOString().slice(0, 10), start: now, exposures, entries: entriesForExposures(exposures, profile.prescriptions) }
}
function finish(profile, active, edit = () => {}) {
  active.entries.forEach(entry => entry.sets.forEach((row, i) => { row.done = true; edit(row, i) }))
  const result = buildCompletedSession(active, profile, { end: active.start + 3600000, unit: 'kg', newId: s => s })
  Object.assign(profile.progression, result.progression)
  profile.workouts.push(result.session)
  return result.session
}

describe('main functionality through the canonical engine', () => {
  it('triple climbs the base sets together, then only the newly added set, then resets after a load step', () => {
    const routine = routineFor('triple', { sets: { min: 3, max: 4 }, reps: { min: 8, max: 10 }, load: absolute(60) })
    const profile = profileFor(routine)
    for (const expected of [[8, 8, 8], [9, 9, 9], [10, 10, 10], [10, 10, 10, 8], [10, 10, 10, 9], [10, 10, 10, 10]]) {
      const active = start(profile, routine)
      expect(active.entries[0].sets.map(row => row.r)).toEqual(expected)
      finish(profile, active)
    }
    const next = start(profile, routine)
    expect(next.entries[0].sets.map(row => [row.w, row.r])).toEqual([[62.5, 8], [62.5, 8], [62.5, 8]])
    expect(replayProgression({ workouts: profile.workouts, prescriptions: profile.prescriptions, trackId: 'track' })).toEqual(profile.progression.track)
  })

  it('a short added triple set holds every aim and does not take the added set away', () => {
    const routine = routineFor('triple', { sets: { min: 2, max: 3 }, reps: { min: 8, max: 9 }, load: absolute(60) })
    const profile = profileFor(routine)
    finish(profile, start(profile, routine))
    finish(profile, start(profile, routine))
    const active = start(profile, routine)
    expect(active.entries[0].sets.map(row => row.r)).toEqual([9, 9, 8])
    finish(profile, active, (row, i) => { if (i === 2) row.r = 6 })
    expect(start(profile, routine).entries[0].sets.map(row => row.r)).toEqual([9, 9, 8])
  })

  it('back-off loads are frozen, graded per row, and advanced together', () => {
    const routine = routineFor('linear', { sets: fixed(3), reps: fixed(6), load: absolute(26), step: { type: 'absolute', value: 2, unit: 'kg' }, rounding: { mode: 'nearest', step: 2 } }, { backoff: true })
    const profile = profileFor(routine)
    const first = start(profile, routine)
    expect(first.entries[0].sets.map(row => row.w)).toEqual([26, 24, 22])
    expect(profile.prescriptions[first.exposures[0].prescriptionId].rows.map(row => row.load.value)).toEqual([26, 24, 22])
    finish(profile, first, (row, i) => { if (i === 2) row.w = 20 })
    expect(start(profile, routine).entries[0].sets.map(row => row.w)).toEqual([26, 24, 22])
    finish(profile, start(profile, routine))
    expect(start(profile, routine).entries[0].sets.map(row => row.w)).toEqual([28, 26, 24])
  })

  it('owned bells decide the next load and generated warm-ups stay on the inventory', () => {
    const routine = routineFor('linear', { sets: fixed(2), reps: fixed(8), load: absolute(21) }, { dbLoad: 'each', warmup: { mode: 'template', steps: [{ percent: 50, reps: 8 }] } })
    const profile = { ...profileFor(routine), dumbbells: { kg: { weights: [9, 15, 19, 21, 24] } } }
    const active = start(profile, routine)
    expect(active.entries[0].sets.map(row => row.w)).toEqual([9, 21, 21])
    const workout = finish(profile, active)
    expect(workout.vol).toBe(672)
    expect(start(profile, routine).entries[0].sets.filter(row => row.phase !== 'warmup').map(row => row.w)).toEqual([24, 24])
  })

  it('editing a completed session preserves the meaning and planned execution flags', () => {
    const routine = routineFor('linear', { sets: fixed(2), reps: fixed(8), load: absolute(20) }, { dbLoad: 'each', lastToFailure: true, backoff: true })
    const profile = profileFor(routine)
    const workout = finish(profile, start(profile, routine))
    const draft = editCompletedSession(profile, workout.id)
    expect(draft.entries[0].target).toMatchObject({ dbLoad: 'each', lastToFailure: true, backoff: true, backoffStep: 2.5 })
    expect(draft.entries[0].sets.at(-1).failure).toBe(true)
  })

  it('reads a source-linked 1RM in the current meaning and records a stronger per-bell estimate', () => {
    const routine = routineFor('autoregulated', { sets: fixed(1), reps: fixed(5), load: { mode: 'percent_1rm', percent: 50 } }, { dbLoad: 'each' })
    const prior = { ...loggedExposure('0289', [{ w: 40, r: 5 }]), exposureId: 'previous', dbLoad: 'total' }
    const record = { id: 'orm', exerciseId: '0289', value: 50, unit: 'kg', source: 'estimated', sourceRecordId: 'previous', capturedAt: '2026-10-01T12:00:00Z' }
    const profile = { ...profileFor(routine), workouts: [{ start: Date.parse(record.capturedAt), exposures: [prior] }], oneRepMaxes: { orm: record } }
    const active = start(profile, routine)
    expect(profile.prescriptions[active.exposures[0].prescriptionId].snapshot1RM.value).toBe(25)
    expect(active.entries[0].sets[0].w).toBe(12.5)
    expect(record.value).toBe(50)
    active.entries[0].sets[0] = { ...active.entries[0].sets[0], w: 22, r: 8, done: true }
    const result = buildCompletedSession(active, profile, { end: active.start + 3600000, unit: 'kg', newId: s => s })
    expect(result.oneRepMaxes).toHaveLength(1)
    expect(result.oneRepMaxes[0]).toMatchObject({ dbLoad: 'each', value: 27.9 })
    profile.workouts.push(result.session)
    reconcileDerivedOneRms(profile)
    expect(Object.values(profile.oneRepMaxes)[0]).toMatchObject({ dbLoad: 'each', value: 27.9 })
  })

  it('compares a new per-bell load against history logged as the total of both bells', () => {
    const prior = { ...loggedExposure('0289', [{ w: 40, r: 8 }]), dbLoad: 'total' }
    const now = { ...loggedExposure('0289', [{ w: 22, r: 8 }]), dbLoad: 'each' }
    const profile = { workouts: [{ exposures: [prior] }] }
    expect(bestWeightFor(profile, '0289', 'each')).toBe(20)
    expect(recordsOf(profile, { exposures: [now] })).toEqual({ prs: ['0289'], e1prs: [] })
    expect(workoutVolume(profile, { exposures: [now] })).toBe(352)
  })

  it('failure is logged as RIR zero, survives read-back, and applies to both halves of the last timed set', () => {
    const routine = routineFor('autoregulated', { sets: fixed(2), durationSeconds: fixed(30), load: absolute(10) }, { mode: 'time', side: true, lastToFailure: true })
    const profile = profileFor(routine)
    const active = start(profile, routine)
    expect(active.entries[0].sets.map(row => !!row.failure)).toEqual([false, false, true, true])
    const workout = finish(profile, active)
    const sets = workout.exposures[0].performance.sets
    expect(sets.slice(-2).every(row => row.failure && row.rir === 0)).toBe(true)
    expect(rowsOfPerformance(sets, 'time').slice(-2).every(row => row.failure)).toBe(true)
  })

  it('migration and a new cardio session retain each interval’s incline, minutes and speed', () => {
    const old = { unit: 'kg', routines: [{ id: 'routine', ex: [{ id: '3220', mode: 'cardio', sets: 2, min: 20, speed: 8 }] }], workouts: [{ id: 'old', d: '2026-10-01', routineIds: ['routine'], entries: [{ id: '3220', rid: 'routine', target: { mode: 'cardio', sets: 2, min: 20, speed: 8 }, sets: [{ min: 25, speed: 5, incline: 10, done: true }, { min: 10, speed: 6, done: true }] }] }] }
    const profile = migratedFixture(old)
    const active = start(profile, profile.routines[0])
    expect(active.entries[0].sets.map(({ min, speed, incline }) => ({ min, speed, ...(incline != null ? { incline } : {}) }))).toEqual([{ min: 25, speed: 5, incline: 10 }, { min: 10, speed: 6 }])
    const workout = finish(profile, active)
    expect(rowsOfPerformance(workout.exposures[0].performance.sets, 'cardio')[0].incline).toBe(10)
  })

  it('per-set pyramid weights use their own plan, falling back to that same historical row', () => {
    const rule = defaultPlanRule('pyramid_reps', { id: 'r', exerciseId: '0289', setReps: [12, 8, 6], setWeights: [40, 0, 60], sets: fixed(3), load: absolute(100) })
    expect(validatePlanRule(rule).ok).toBe(true)
    const lastLog = loggedExposure('0289', [{ w: 45, r: 12 }, { w: 50, r: 8 }, { w: 55, r: 6 }])
    const p = generatePrescription({ id: 'p', now: '2026-10-09T12:00:00Z', trackId: 't', rule, lastLog })
    expect(p.rows.map(row => row.load.value)).toEqual([40, 50, 60])
  })

  it('canonical recovery, muscle counts and per-set charts retain a deleted custom exercise', () => {
    const entry = { id: 'deleted-custom', muscleSnapshot: { muscleWeights: { chest: 1 } }, sets: [{ w: 60, r: 5, done: true }] }
    const old = { id: 'w', d: '2026-10-01', start: Date.parse('2026-10-01T12:00:00Z'), entries: [entry] }
    const profile = migratedFixture({ unit: 'kg', routines: [], workouts: [old] })
    const now = old.start + 3600000
    expect(fatigueOf(profile, now)).toEqual(fatigueOf([old], now))
    expect(strengthOf(profile, now)).toEqual(strengthOf([old], now))
    expect(loadOfWorkouts(profile.workouts).chest).toBe(1)
    expect(perSetSessions(profile.workouts, entry.id)[0].sets).toEqual([{ n: 1, y: 60, w: 60, r: 5 }])
  })
})
