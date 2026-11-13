// A cardio interval is as long as a time, a distance or a calorie count, one of them
// (lib/cardio-length.js). These cover distance; calories.test.js covers the count.
import { describe, it, expect } from 'vitest'
import { KM_MAX, cardioLength, clampKm, fmtDist, fromDist, lengthOf, setLengthOf, toDist } from './cardio-length.js'
import { setLabel, buildSets, exLine, insertWarmupRow, setsRepsOf } from './history.js'
import { buildPlanBundle, parsePlan } from './plan-share.js'
import { finishCardio } from './finish-compare.js'
import { setTrend, trendLabel } from './set-trend.js'
import { exerciseHistory } from './exercise-history.js'
import { parseWorkoutCSV } from './import-csv.js'
import { workoutRows, WORKOUT_COLUMNS } from './export-csv.js'
import { routineFromSession } from './session-routines.js'

const ROWER = '1161'
const TREADMILL = '2259'

describe('the length of an interval', () => {
  it('a slot measures by calories, then distance, else time', () => {
    expect(lengthOf({ kcal: 50, km: 2, min: 20 })).toBe('kcal')
    expect(lengthOf({ km: 2, min: 20 })).toBe('km')
    expect(lengthOf({ min: 20 })).toBe('min')
    expect(lengthOf(undefined)).toBe('min')
  })
  it('a set is read by its minutes when it has any, else what it carries', () => {
    expect(setLengthOf({ min: 10, km: 2 })).toBe('min')
    expect(setLengthOf({ km: 2 })).toBe('km')
    expect(setLengthOf({ kcal: 50 })).toBe('kcal')
    expect(setLengthOf({})).toBe('min')
  })
  it('clamps a distance to the metre, and leaves nothing as nothing', () => {
    expect(clampKm('2.5')).toBe(2.5)
    expect(clampKm(0.12345)).toBe(0.123)
    expect(clampKm(9999)).toBe(KM_MAX)
    for (const v of [null, '', 0, -1, 'far']) expect(clampKm(v)).toBe(null)
  })
  it('a new row takes the slot\'s measure, last time\'s when it was measured the same way', () => {
    expect(cardioLength({ km: 2 }, null)).toEqual({ km: 2 })
    expect(cardioLength({ km: 2 }, { km: 2.5 })).toEqual({ km: 2.5 })
    expect(cardioLength({ km: 2 }, { min: 12 })).toEqual({ km: 2 })
    expect(cardioLength({ km: 2 }, { kcal: 60 })).toEqual({ km: 2 })
    expect(cardioLength({ min: 20 }, { km: 2.5 })).toEqual({ min: 20 })
  })
  it('shows in miles with mph and stores km', () => {
    expect(toDist(1.609344, 'mph')).toBe(1)
    expect(fromDist(1, 'mph')).toBe(1.609)
    expect(toDist(5, 'kmh')).toBe(5)
    expect(fmtDist(5, 'kmh')).toBe('5 km')
    expect(fmtDist(1.609344, 'mph')).toBe('1 mi')
  })
})

describe('a distance interval', () => {
  it('reads by its distance in labels and lines', () => {
    expect(setLabel(ROWER, { km: 2, speed: 12 })).toBe('2 km @ 12 km/h')
    expect(setLabel(ROWER, { km: 2 })).toBe('2 km')
    expect(setLabel(TREADMILL, { km: 1.609344, speed: 8.04672, incline: 3 }, null, 'mph')).toBe('1 mi @ 5 mph · 3% incline')
    expect(exLine({ id: ROWER, sets: 4, km: 0.5, speed: 12 }, 'kg')).toBe('4 × 0.5 km @ 12 km/h')
    expect(setsRepsOf({ id: ROWER, sets: 4, km: 0.5 })).toBe('4 × 0.5 km')
  })

  it('builds rows and warm-ups with a distance and no minutes', () => {
    const cfg = { id: ROWER, sets: 2, km: 0.5, speed: 12 }
    expect(buildSets({ exWeights: {}, workouts: [] }, cfg)).toEqual([{ km: 0.5, speed: 12, done: false }, { km: 0.5, speed: 12, done: false }])
    const rows = insertWarmupRow([{ km: 0.5, speed: 12, done: false }], 'cardio', cfg)
    expect(rows[0]).toMatchObject({ km: 0.5, phase: 'warmup' })
    expect(rows[0]).not.toHaveProperty('min')
  })

  it('saved as a routine keeps today\'s distance and no minutes', () => {
    const r = routineFromSession({ name: 'Row', entries: [{ id: ROWER, target: { sets: 1, km: 2, speed: 12 }, sets: [{ km: 2.5, speed: 13, done: true }] }] })
    expect(r.ex[0]).toMatchObject({ km: 2.5, speed: 13 })
    expect(r.ex[0]).not.toHaveProperty('min')
  })

  it('travels in a shared plan without minutes', () => {
    const S = { unit: 'kg', customEx: [], routines: [{ id: 'r1', name: 'Row', ex: [{ id: ROWER, sets: 4, km: 0.5, speed: 12, min: 20 }] }] }
    const file = buildPlanBundle(S, 'Row')
    expect(file.routines[0].ex[0]).toMatchObject({ km: 0.5 })
    expect(file.routines[0].ex[0]).not.toHaveProperty('min')
    expect(parsePlan(file, 'kg').routines[0].ex[0].km).toBe(0.5)
  })

  it('is in the finish summary and compares by distance', () => {
    expect(finishCardio({ entries: [{ id: ROWER, target: { km: 2 }, sets: [{ km: 2, done: true }] }] })[0].sets).toEqual([{ km: 2, done: true }])
    const up = setTrend({ km: 2.5, speed: 12 }, { km: 2, speed: 12 }, { mode: 'cardio' })
    expect(up).toMatchObject({ dir: 1, by: 'km' })
    expect(trendLabel(up)).toBe('Further than last time')
  })

  it('charts the distance', () => {
    const S = { unit: 'kg', workouts: [
      { id: 'a', d: '2026-10-01', start: 1, end: 2, entries: [{ id: ROWER, target: { km: 2 }, sets: [{ km: 2, speed: 12, done: true }] }] },
      { id: 'b', d: '2026-10-03', start: 3, end: 4, entries: [{ id: ROWER, target: { km: 2 }, sets: [{ km: 2, speed: 12, done: true }, { km: 1, speed: 12, done: true }] }] },
    ] }
    const h = exerciseHistory(S, ROWER)
    expect(h.metric).toBe('km')
    expect(h.best).toBe(3)
  })

  it('round-trips through the CSV and reads another app\'s distance without a time', () => {
    const w = { id: 'w', d: '2026-10-01', start: 0, end: 1, name: 'Row', entries: [{ id: ROWER, target: { km: 2 }, sets: [{ km: 2, speed: 12, done: true }] }] }
    const rows = workoutRows({ unit: 'kg', customEx: [], workouts: [w] })
    expect(rows[0][WORKOUT_COLUMNS.indexOf('distance_km')]).toBe('2')
    expect(rows[0][WORKOUT_COLUMNS.indexOf('seconds')]).toBe('')
    const csv = [WORKOUT_COLUMNS, ...rows].map(r => r.map(v => String(v ?? '')).join(',')).join('\n')
    expect(parseWorkoutCSV(csv, { unit: 'kg' }).workouts[0].entries[0].sets[0]).toMatchObject({ km: 2 })
    const head = 'Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Distance,Seconds'
    const other = parseWorkoutCSV([head, '2026-01-22 10:00:00,Row,Rowing,1,0,0,2,0'].join('\n'), { unit: 'kg' })
    const set = other.workouts[0].entries[0].sets[0]
    expect(set).toMatchObject({ km: 2 })
    expect(set).not.toHaveProperty('min')
  })
})
