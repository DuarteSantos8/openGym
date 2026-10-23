import { startMigratedFixture } from './test-fixtures.js'
// Treadmill incline per cardio set (Discord "Add incline level for treadmill"): optional on the
// set, offered where a grade means something, and carried everywhere a cardio set is read back.
import { describe, it, expect } from 'vitest'
import { INCLINE_MAX, clampIncline, inclineFits, hasIncline, inclineFrom } from './incline.js'
import { EXIDX } from './exercises.js'
import { setLabel, insertWarmupRow, copyRowAt } from './history.js'
import { workoutText } from './workout-text.js'
import { finishCardio } from './finish-compare.js'
import { parseWorkoutCSV } from './import-csv.js'

const TREADMILL = '2259'      // walking on treadmill
const INCLINE_WALK = '3666'   // walking on incline treadmill
const ELLIPTICAL = '2192'     // elliptical machine walk
const STEPMILL = '2311'       // walking on stepmill
const RUN = '0685'            // run
const BIKE = '2138'           // stationary bike run v. 3
const ROWER = '1161'          // rowing (with rowing machine)
const ROPE = '2612'           // jump rope
const JACKS = '3094'          // jumping jack

describe('clampIncline', () => {
  it('keeps a grade on the half percent between 0 and 40', () => {
    expect(clampIncline(5)).toBe(5)
    expect(clampIncline(7.3)).toBe(7.5)
    expect(clampIncline(7.2)).toBe(7)
    expect(clampIncline('12.5')).toBe(12.5)
    expect(clampIncline(55)).toBe(INCLINE_MAX)
    expect(clampIncline(-3)).toBe(0)
    expect(clampIncline(0)).toBe(0)
  })
  it('leaves nothing as nothing, so a cleared field drops the key', () => {
    expect(clampIncline(null)).toBe(null)
    expect(clampIncline(undefined)).toBe(null)
    expect(clampIncline('')).toBe(null)
    expect(clampIncline('steep')).toBe(null)
    expect(clampIncline(NaN)).toBe(null)
  })
})

describe('inclineFits', () => {
  it('offers the incline on treadmills, walking, running, stairs and ellipticals', () => {
    for (const id of [TREADMILL, INCLINE_WALK, ELLIPTICAL, STEPMILL, RUN]) expect(inclineFits(EXIDX[id]), EXIDX[id].n).toBe(true)
  })
  it('not on a bike, a rower, a rope or jumping jacks', () => {
    for (const id of [BIKE, ROWER, ROPE, JACKS]) expect(inclineFits(EXIDX[id]), EXIDX[id].n).toBe(false)
  })
  it('on your own cardio exercise unless its name says it has no grade', () => {
    expect(inclineFits({ id: 'c1', n: 'Laufband', bp: 'cardio', custom: true })).toBe(true)
    expect(inclineFits({ id: 'c2', n: 'Hill walk', bp: 'cardio', custom: true })).toBe(true)
    expect(inclineFits({ id: 'c3', n: 'Spin bike', bp: 'cardio', custom: true })).toBe(false)
    expect(inclineFits({ id: 'c4', n: 'Concept2 rower', bp: 'cardio', custom: true })).toBe(false)
    expect(inclineFits(null)).toBe(false)
  })
})

describe('a set with an incline', () => {
  it('reads with its grade, and a flat or older set reads exactly as before', () => {
    expect(setLabel(TREADMILL, { min: 30, speed: 5.5, incline: 12, done: true })).toBe('30 min @ 5.5 km/h · 12% incline')
    expect(setLabel(TREADMILL, { min: 30, speed: 5.5, incline: 7.5 })).toBe('30 min @ 5.5 km/h · 7.5% incline')
    expect(setLabel(TREADMILL, { min: 30, speed: 5.5, incline: 0 })).toBe('30 min @ 5.5 km/h')
    expect(setLabel(TREADMILL, { min: 30, speed: 5.5 })).toBe('30 min @ 5.5 km/h')
    // In mph too: the grade is a percentage either way.
    expect(setLabel(TREADMILL, { min: 30, speed: 16.09344, incline: 4 }, null, 'mph')).toBe('30 min @ 10 mph · 4% incline')
  })

  it('knows which sets carry one and what a new row takes over', () => {
    expect(hasIncline({ incline: 3 })).toBe(true)
    expect(hasIncline({ incline: 0 })).toBe(false)
    expect(hasIncline({})).toBe(false)
    expect(hasIncline(null)).toBe(false)
    expect(inclineFrom({ incline: 6 })).toEqual({ incline: 6 })
    expect(inclineFrom({ incline: 0 })).toEqual({})
    expect(inclineFrom(null)).toEqual({})
  })

  it('is prefilled from last time, and a session with no grade last time opens flat', () => {
    const cfg = { id: TREADMILL, sets: 2, min: 20, speed: 8 }
    const last = sets => ({ exWeights: {}, workouts: [{ id: 'w1', d: '2026-10-01', start: 0, end: 1, entries: [{ id: TREADMILL, target: { sets: 2, min: 20, speed: 8 }, sets }] }] })
    expect(buildSets(last([{ min: 25, speed: 5, incline: 10, done: true }, { min: 10, speed: 6, done: true }]), cfg)).toEqual([
      { min: 25, speed: 5, incline: 10, done: false },
      { min: 10, speed: 6, done: false },
    ])
    expect(buildSets(last([{ min: 25, speed: 5, done: true }]), cfg)).toEqual([
      { min: 25, speed: 5, done: false },
      { min: 25, speed: 5, done: false },
    ])
    expect(buildSets({ exWeights: {}, workouts: [] }, cfg)).toEqual([
      { min: 20, speed: 8, done: false },
      { min: 20, speed: 8, done: false },
    ])
  })

  it('comes along on a warm-up added in front of it and on a copied row', () => {
    const rows = insertWarmupRow([{ min: 20, speed: 5, incline: 8, done: false }], 'cardio', { min: 20, speed: 5 })
    expect(rows[0]).toMatchObject({ min: 20, speed: 5, incline: 8, phase: 'warmup' })
    expect(copyRowAt([{ min: 20, speed: 5, incline: 8, done: true }], 0)[1]).toEqual({ min: 20, speed: 5, incline: 8, done: false })
  })

  it('is in the workout copied as text', () => {
    const w = { id: 'w', d: '2026-10-01', start: 0, end: 30 * 60000, name: 'Walk', vol: 0,
      entries: [{ id: TREADMILL, target: { mode: 'cardio' }, sets: [{ min: 30, speed: 5.5, incline: 12, done: true }] }] }
    expect(workoutText(w, { unit: 'kg', nameOf: () => 'treadmill' })).toContain('30 min @ 5.5 km/h · 12% incline')
  })

  it('is in the finish summary, which lists the cardio the lift rows leave out', () => {
    const w = { entries: [
      { id: '0025', target: { mode: 'reps' }, sets: [{ w: 60, r: 5, done: true }] },
      { id: TREADMILL, target: { sets: 2, min: 20, speed: 8 }, sets: [{ min: 20, speed: 5, incline: 9, done: true }, { min: 20, speed: 5, done: false }] },
      { id: BIKE, target: { mode: 'cardio' }, sets: [{ min: 20, speed: 25, done: false }] },
    ] }
    const rows = finishCardio(w)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(TREADMILL)
    expect(rows[0].sets).toEqual([{ min: 20, speed: 5, incline: 9, done: true }])
    expect(setLabel(rows[0].id, rows[0].sets[0], rows[0].target)).toBe('20 min @ 5 km/h · 9% incline')
    expect(finishCardio({})).toEqual([])
  })
})

describe('importing an incline', () => {
  // gravl writes the grade per set in an "Incline" column.
  const head = 'Date,Start Date,Workout,Source,Workout Duration (min),Energy,Exercise,Superset,Set,Set Type,Reps,Weight (kg),Distance (km),Set Duration (sec),Incline,Steps,Effort,Workout Notes'
  it('reads the column onto a cardio set, clamped, and leaves an empty one out', () => {
    const csv = [head,
      '2026/01/22,2:22 PM,Walk,,30,0,Walking,No,0,Normal,0,0,3,1800,12,,,',
      '2026/01/23,2:22 PM,Walk,,30,0,Walking,No,0,Normal,0,0,3,1800,"8,5",,,',
      '2026/01/24,2:22 PM,Walk,,30,0,Walking,No,0,Normal,0,0,3,1800,90,,,',
      '2026/01/25,2:22 PM,Walk,,30,0,Walking,No,0,Normal,0,0,3,1800,,,,',
    ].join('\n')
    const sets = parseWorkoutCSV(csv, { unit: 'kg' }).workouts.map(w => w.entries[0].sets[0])
    expect(sets[0]).toEqual({ min: 30, speed: 6, incline: 12, done: true })
    expect(sets[1].incline).toBe(8.5)
    expect(sets[2].incline).toBe(INCLINE_MAX)
    expect(sets[3]).toEqual({ min: 30, speed: 6, done: true })
  })
  it('never puts a grade on a lifting set', () => {
    const csv = [head, '2026/01/01,1:11 PM,Push Day,,11,11,Chin Up,No,1,Normal,11,11,0,,5,,,'].join('\n')
    expect(parseWorkoutCSV(csv, { unit: 'kg' }).workouts[0].entries[0].sets[0]).toEqual({ w: 11, r: 11, done: true })
  })
})

function buildSets(S, cfg) { return startMigratedFixture(S, { ex: [cfg] }).entries[0].sets.map(({ setId, ...row }) => row) }
