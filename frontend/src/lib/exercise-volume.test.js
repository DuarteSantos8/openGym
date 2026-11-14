import { describe, expect, it } from 'vitest'
import { exerciseVolumeSeries } from './exercise-volume.js'

const BENCH = '0025', PULLUP = '0652', ASSISTED = '0017'
const now = new Date(2026, 10, 14, 16).getTime()
const done = (w = 50, r = 5) => ({ w, r, done: true })
const entry = (sets = [done()], extra = {}) => ({ id: BENCH, sets, ...extra })
const workout = (d = '2026-11-14', entries = [entry()], extra = {}) => ({ d, entries, ...extra })
const state = (workouts, extra = {}) => ({ unit: 'kg', workouts, ...extra })
const series = (workouts, options = {}, extra = {}, id = BENCH) =>
  exerciseVolumeSeries(state(workouts, extra), id, { now, ...options })

describe('exerciseVolumeSeries', () => {
  it('cuts 7 days at local midnight, including today and six earlier calendar days', () => {
    const result = series([
      workout('2026-11-07', [entry()], { start: new Date(2026, 10, 7, 23, 59, 59, 999).getTime() }),
      workout('2026-11-08', [entry()], { start: new Date(2026, 10, 8).getTime() }),
      workout('2026-11-14'), workout('2026-11-15'),
    ], { days: 7 })
    expect(result.points.map(p => p.d)).toEqual(['2026-11-08', '2026-11-14'])
    expect(result.included).toBe(2)
    expect(result.excluded).toBe(0)
  })

  it.each([7, 30, 90, 365])('uses calendar days for a %i-day window, including across DST', days => {
    const boundary = new Date(now)
    boundary.setHours(0, 0, 0, 0)
    boundary.setDate(boundary.getDate() - days + 1)
    const result = series([
      { start: boundary.getTime() - 1, entries: [entry()] },
      { start: boundary.getTime(), entries: [entry()] },
    ], { days })
    expect(result.points).toHaveLength(1)
    expect(result.points[0].t).toBe(boundary.getTime())
  })

  it('uses the canonical local day when start and day differ, and ignores invalid dates', () => {
    const result = series([
      workout('2026-11-08', [entry()], { start: new Date(2026, 10, 7, 23).getTime() }),
      { entries: [entry()] }, workout('2026-13-60'),
    ], { days: 7 })
    expect(result.points).toHaveLength(1)
    expect(result.points[0].d).toBe('2026-11-08')
  })

  it('keeps two sessions on the same day and sorts by their real start', () => {
    const morning = new Date(2026, 10, 14, 8).getTime(), evening = morning + 10 * 3600000
    const result = series([
      workout(undefined, [entry([done(60)])], { start: evening }),
      workout(undefined, [entry()], { start: morning }),
    ])
    expect(result.points.map(p => [p.t, p.y])).toEqual([[morning, 250], [evening, 300]])
    expect(result.included).toBe(2)
  })

  it('reads d-only sessions at local noon and All includes old sessions', () => {
    const result = series([workout('2020-01-01')])
    expect(result.points).toEqual([{ t: new Date(2020, 0, 1, 12).getTime(), d: '2020-01-01', y: 250, sets: 1 }])
  })

  it.each([
    ['kg', 'lb', 20.4117, 225],
    ['lb', 'kg', 110.2311, 250],
  ])('converts a %s profile to its exercise pin %s', (unit, pin, load, expected) => {
    const result = series([workout(undefined, [entry([done(load)])])], {}, { unit, exUnit: { [BENCH]: { unit: pin } } })
    expect(result.unit).toBe(pin)
    expect(result.points[0].y).toBeCloseTo(expected, 2)
  })

  it('counts warm-ups only when chosen, with the same rule for sets and volume', () => {
    const w = workout(undefined, [entry([done(), { ...done(20, 10), phase: 'warmup' }])])
    expect(series([w]).points[0]).toMatchObject({ y: 250, sets: 1 })
    expect(series([w], {}, { volumeWarmups: true }).points[0]).toMatchObject({ y: 450, sets: 2 })
    expect(series([workout(undefined, [entry([{ ...done(), phase: 'warmup' }])])]).excluded).toBe(1)
  })

  it('counts bodyweight only when chosen and converts the session weight for a pin', () => {
    const w = workout(undefined, [entry([done(0, 5)], { id: PULLUP })], { bw: 80 })
    expect(series([w], {}, {}, PULLUP)).toMatchObject({ points: [], included: 0, excluded: 1, reasons: { noVolume: 1 } })
    expect(series([w], {}, { volumeBodyweight: true }, PULLUP).points[0].y).toBe(400)
    const pinned = series([w], {}, { volumeBodyweight: true, exUnit: { [PULLUP]: { unit: 'lb' } } }, PULLUP)
    expect(pinned.unit).toBe('lb')
    expect(pinned.points[0].y).toBeCloseTo(881.85, 2)
  })

  it('reuses nearest weigh-in for d-only bodyweight history', () => {
    const result = series([workout(undefined, [entry([done(0, 5)], { id: PULLUP })])], {}, {
      volumeBodyweight: true, bodyweight: [{ d: '2026-11-13', w: 80 }],
    }, PULLUP)
    expect(result.points[0].y).toBe(400)
  })

  it('uses completed sides at their own loads, including their drops', () => {
    const sets = [{ w: 100, r: 100, done: false, sides: {
      L: { ...done(14, 10), type: 'dropset', drops: [{ w: 10, r: 3 }] }, R: { ...done(12, 6), done: false },
    } }, { sides: { L: done(14, 10), R: done(12.5, 6) } }]
    expect(series([workout(undefined, [entry(sets)])]).points[0]).toMatchObject({ y: 385, sets: 3 })
  })

  it('adds drop volume and both entries of the exercise once, ignoring other exercises', () => {
    const w = workout(undefined, [
      entry([{ ...done(), type: 'dropset', drops: [{ w: 40, r: 3 }] }]),
      entry([done(30, 4)]), entry([done(1000, 100)], { id: PULLUP }),
    ])
    expect(series([w])).toMatchObject({ included: 1, excluded: 0, points: [{ y: 490, sets: 2 }] })
  })

  it('respects recorded dumbbell meaning instead of the current setting', () => {
    const dbBench = '0289', oneArmRow = '0292'
    const w = workout(undefined, [entry([done(20, 10)], { id: dbBench, target: { dbLoad: 'each' } })])
    const total = workout(undefined, [entry([done(40, 10)], { id: dbBench, target: { dbLoad: 'total' } })])
    expect(series([w, total], {}, { dbLoad: { [dbBench]: { mode: 'total' } } }, dbBench).points.map(p => p.y)).toEqual([400, 400])
    const single = workout(undefined, [entry([done(20, 10)], { id: oneArmRow, target: { dbLoad: 'each' } })])
    expect(series([single], {}, {}, oneArmRow).points[0].y).toBe(200)
  })

  it.each(['time', 'cardio'])('excludes %s rows even if stale weight and reps remain', mode => {
    const w = workout(undefined, [entry([done()], { target: { mode } })])
    expect(series([w])).toMatchObject({ points: [], included: 0, excluded: 1, reasons: { timedOrCardio: 1 } })
  })

  it('keeps only reps rows in a mixed session and does not count that session as excluded', () => {
    const w = workout(undefined, [entry([done(), { ...done(1000), mode: 'time' }])])
    expect(series([w])).toMatchObject({ included: 1, excluded: 0, points: [{ y: 250, sets: 1 }] })
  })

  it('never plots unfinished or zero-rep work, or legacy whole-session volume as zero', () => {
    const result = series([
      workout(undefined, [entry([{ ...done(), done: false }])]),
      workout(undefined, [entry([done(50, 0)])]),
      { d: '2026-11-14', vol: 9999 },
      workout(undefined, [entry(undefined, { sets: undefined, topW: 50 })]),
      workout(undefined, [entry(undefined, { id: PULLUP })]),
    ])
    expect(result).toMatchObject({ points: [], included: 0, excluded: 4,
      reasons: { noVolume: 2, missingDetails: 2, timedOrCardio: 0 } })
  })

  it('counts exclusions only in the selected window', () => {
    expect(series([{ d: '2026-11-07', vol: 99 }, { d: '2026-11-08', vol: 99 }], { days: 7 }))
      .toMatchObject({ excluded: 1, reasons: { missingDetails: 1 } })
  })

  it('does not interpret assistance as lifted load', () => {
    expect(series([workout(undefined, [entry(undefined, { id: ASSISTED })])], {}, {}, ASSISTED).points).toEqual([])
  })

  it('does not mutate the profile or inject any persisted field', () => {
    const S = state([workout()], { exUnit: { [BENCH]: { unit: 'lb' } } })
    const before = structuredClone(S)
    exerciseVolumeSeries(S, BENCH, { now })
    expect(S).toEqual(before)
  })
})
