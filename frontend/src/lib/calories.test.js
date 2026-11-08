// A cardio interval is as long as a time or a calorie count, one or the other (lib/calories.js):
// a calorie slot and its sets carry `kcal` and no minutes, and everything that reads a cardio set
// back reads it by its count, with the session's total in the summaries.
import { describe, it, expect } from 'vitest'
import { KCAL_MAX, byKcal, clampKcal, hasKcal, isKcalSet, kcalFits, workoutKcal } from './calories.js'
import { EXIDX } from './exercises.js'
import { cardioLength } from './cardio-length.js'
import { setLabel, buildSets, copyRowAt, exLine, insertWarmupRow, setsRepsOf } from './history.js'
import { buildPlanBundle, parsePlan } from './plan-share.js'
import { workoutText } from './workout-text.js'
import { finishCardio } from './finish-compare.js'
import { setTrend, trendLabel } from './set-trend.js'
import { parseWorkoutCSV } from './import-csv.js'
import { workoutRows, WORKOUT_COLUMNS } from './export-csv.js'

const ROWER = '1161'   // rowing (with rowing machine)
const TREADMILL = '2259'

describe('clampKcal', () => {
  it('keeps a whole number between 1 and the ceiling', () => {
    expect(clampKcal(120)).toBe(120)
    expect(clampKcal('87.6')).toBe(88)
    expect(clampKcal(99999)).toBe(KCAL_MAX)
  })
  it('leaves nothing, 0 and junk as nothing, so a cleared field drops the key', () => {
    for (const v of [null, undefined, '', 0, -5, 'lots', NaN]) expect(clampKcal(v)).toBe(null)
  })
})

describe('time or calories', () => {
  it('a slot with a count is a calorie one, whatever minutes it still carries', () => {
    expect(byKcal({ kcal: 50 })).toBe(true)
    expect(byKcal({ kcal: 50, min: 20 })).toBe(true)
    expect(byKcal({ min: 20 })).toBe(false)
    expect(byKcal(undefined)).toBe(false)
  })
  it('a set is a calorie one when it has a count and no minutes', () => {
    expect(isKcalSet({ kcal: 50, speed: 10 })).toBe(true)
    expect(isKcalSet({ kcal: 50, min: 5 })).toBe(false)
    expect(isKcalSet({ min: 5 })).toBe(false)
    expect(hasKcal({ kcal: 0 })).toBe(false)
  })
  it('a new row takes its length in the slot\'s measure, last time\'s when it was measured the same way', () => {
    expect(cardioLength({ kcal: 50 }, null)).toEqual({ kcal: 50 })
    expect(cardioLength({ kcal: 50 }, { kcal: 62 })).toEqual({ kcal: 62 })
    expect(cardioLength({ kcal: 50 }, { min: 12 })).toEqual({ kcal: 50 })
    expect(cardioLength({ min: 20 }, { min: 12 })).toEqual({ min: 12 })
    expect(cardioLength({ min: 20 }, { kcal: 62 })).toEqual({ min: 20 })
    expect(cardioLength({}, null)).toEqual({ min: 20 })
  })
})

describe('a calorie interval', () => {
  it('reads by its count in the set label, the routine line and the sets line', () => {
    expect(setLabel(ROWER, { kcal: 120, speed: 10 })).toBe('120 kcal @ 10 km/h')
    expect(setLabel(ROWER, { kcal: 120 })).toBe('120 kcal')
    expect(setLabel(TREADMILL, { kcal: 240, speed: 5, incline: 6 })).toBe('240 kcal @ 5 km/h · 6% incline')
    expect(setLabel(ROWER, { min: 10, speed: 10 })).toBe('10 min @ 10 km/h')
    expect(exLine({ id: ROWER, sets: 4, kcal: 50, speed: 10 }, 'kg')).toBe('4 × 50 kcal @ 10 km/h')
    expect(exLine({ id: ROWER, sets: 4, min: 5, speed: 10 }, 'kg')).toBe('4 × 5 min @ 10 km/h')
    expect(setsRepsOf({ id: ROWER, sets: 4, kcal: 50 })).toBe('4 × 50 kcal')
  })

  it('builds its rows with a count and no minutes', () => {
    const cfg = { id: ROWER, sets: 2, kcal: 50, speed: 10 }
    const last = sets => ({ exWeights: {}, workouts: [{ id: 'w1', d: '2026-10-01', start: 0, end: 1, entries: [{ id: ROWER, target: { sets: 2, kcal: 50, speed: 10 }, sets }] }] })
    expect(buildSets({ exWeights: {}, workouts: [] }, cfg)).toEqual([{ kcal: 50, speed: 10, done: false }, { kcal: 50, speed: 10, done: false }])
    expect(buildSets(last([{ kcal: 62, speed: 11, done: true }]), cfg)).toEqual([{ kcal: 62, speed: 11, done: false }, { kcal: 62, speed: 11, done: false }])
    // Last time it was timed: the count comes from the plan, never a minute.
    expect(buildSets(last([{ min: 12, speed: 11, done: true }]), cfg)[0]).toEqual({ kcal: 50, speed: 11, done: false })
    // And a timed slot never picks up a count.
    expect(buildSets(last([{ kcal: 62, speed: 11, done: true }]), { id: ROWER, sets: 1, min: 20, speed: 10 })).toEqual([{ min: 20, speed: 11, done: false }])
  })

  it('warms up in the same measure, and copies onto a copied row', () => {
    const rows = insertWarmupRow([{ kcal: 50, speed: 10, done: false }], 'cardio', { kcal: 50, speed: 10 })
    expect(rows[0]).toMatchObject({ kcal: 50, speed: 10, phase: 'warmup' })
    expect(rows[0]).not.toHaveProperty('min')
    expect(copyRowAt([{ kcal: 62, speed: 10, done: true }], 0)[1]).toEqual({ kcal: 62, speed: 10, done: false })
  })

  it('travels in a shared plan without minutes, clamped', () => {
    const S = { unit: 'kg', customEx: [], routines: [{ id: 'r1', name: 'Row', ex: [{ id: ROWER, sets: 4, kcal: 50, speed: 10, min: 20 }] }] }
    const file = buildPlanBundle(S, 'Row')
    expect(file.routines[0].ex[0].kcal).toBe(50)
    expect(file.routines[0].ex[0]).not.toHaveProperty('min')
    file.routines[0].ex[0].kcal = 1e6
    expect(parsePlan(file, 'kg').routines[0].ex[0].kcal).toBe(KCAL_MAX)
  })

  it('is in the finish summary, and compares by its count', () => {
    const w = { entries: [{ id: ROWER, target: { sets: 1, kcal: 50 }, sets: [{ kcal: 55, done: true }] }] }
    expect(finishCardio(w)[0].sets).toEqual([{ kcal: 55, done: true }])
    const up = setTrend({ kcal: 55, speed: 10 }, { kcal: 50, speed: 10 }, { mode: 'cardio' })
    expect(up).toMatchObject({ dir: 1, by: 'kcal' })
    expect(trendLabel(up)).toBe('More calories than last time')
    expect(setTrend({ kcal: 50, speed: 11 }, { kcal: 50, speed: 10 }, { mode: 'cardio' })).toMatchObject({ dir: 1, by: 'speed' })
  })
})

describe('a workout\'s calories', () => {
  const w = { id: 'w', d: '2026-10-01', start: 0, end: 30 * 60000, name: 'Cardio', vol: 0, entries: [
    { id: '0025', target: { mode: 'reps' }, sets: [{ w: 60, r: 5, done: true }] },
    { id: ROWER, target: { mode: 'cardio', kcal: 50 }, sets: [
      { kcal: 20, speed: 8, done: true, phase: 'warmup' },
      { kcal: 55, speed: 10, done: true },
      { kcal: 50, speed: 10, done: false },
    ] },
    { id: TREADMILL, target: { mode: 'cardio' }, sets: [{ min: 20, speed: 5, done: true }] },
  ] }

  it('adds up the done calorie intervals, warm-ups included', () => {
    expect(workoutKcal(w)).toBe(75)
    expect(workoutKcal({ entries: [{ id: '0025', sets: [{ w: 60, r: 5, done: true }] }] })).toBe(0)
    expect(workoutKcal(null)).toBe(0)
  })

  it('is in the workout copied as text', () => {
    expect(workoutText(w, { unit: 'kg', nameOf: () => 'rower' })).toContain('55 kcal @ 10 km/h')
  })

  it('round-trips through the CSV export and import as calorie sets', () => {
    const rows = workoutRows({ unit: 'kg', customEx: [], workouts: [w] })
    const col = name => WORKOUT_COLUMNS.indexOf(name)
    for (const r of rows) expect(r).toHaveLength(WORKOUT_COLUMNS.length)
    expect(rows.map(r => r[col('calories')])).toEqual(['', '20', '55', ''])
    // A calorie set has no time.
    expect(rows[2][col('seconds')]).toBe('')
    const csv = [WORKOUT_COLUMNS, ...rows].map(r => r.map(v => String(v ?? '')).join(',')).join('\n')
    const back = parseWorkoutCSV(csv, { unit: 'kg' }).workouts[0]
    const rower = back.entries.find(e => e.id === ROWER)
    expect(rower.sets.map(s => s.kcal)).toEqual([20, 55])
    expect(rower.sets.every(isKcalSet)).toBe(true)
    expect(back.entries.find(e => e.id === TREADMILL).sets[0]).toMatchObject({ min: 20 })
  })

  it('reads a Calories column from another app as a calorie set when there is no time', () => {
    const head = 'Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Calories'
    const csv = [head,
      '2026-01-22 10:00:00,Mixed,Rowing,1,0,0,0,0,98',
      '2026-01-22 10:00:00,Mixed,Rowing,2,0,0,1,600,90',
      '2026-01-22 10:00:00,Mixed,Bench Press (Barbell),1,60,5,0,0,30'].join('\n')
    const sets = parseWorkoutCSV(csv, { unit: 'kg' }).workouts.flatMap(x => x.entries.flatMap(e => e.sets))
    expect(sets.find(s => s.kcal)).toMatchObject({ kcal: 98 })
    expect(sets.find(s => s.kcal)).not.toHaveProperty('min')
    // A timed row is timed: one measure, never both.
    expect(sets.find(s => s.min > 0)).not.toHaveProperty('kcal')
    expect(sets.find(s => s.r > 0)).not.toHaveProperty('kcal')
  })
})

describe('which cardio offers Calories', () => {
  it('the machines whose console shows a count', () => {
    for (const id of ['2259', '3666', '9608', '2138', '3893', '0798', '1161', '2192', '2141', '2140', '2311', '0938', '2331', '4229', '0828', '0684', '10729'])
      expect(kcalFits(EXIDX[id]), EXIDX[id].n).toBe(true)
  })
  it('not a run or walk outdoors, a rope or a drill', () => {
    for (const id of ['0685', '3556', '3380', '2258', '5214', '0630'])
      expect(kcalFits(EXIDX[id]), EXIDX[id].n).toBe(false)
  })
  it('your own exercise always does', () => {
    expect(kcalFits({ id: 'c1', n: 'Laufband', custom: true, eq: 'custom', bp: 'cardio' })).toBe(true)
    expect(kcalFits(null)).toBe(false)
  })
})
