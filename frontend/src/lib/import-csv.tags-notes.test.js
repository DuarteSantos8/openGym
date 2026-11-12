import { describe, expect, it } from 'vitest'
import { workoutsCSV } from './export-csv.js'
import { parseWorkoutCSV } from './import-csv.js'

// Night QA 146: our own CSV wrote set_color and set_note, and a re-import dropped both.
const S = { unit: 'kg', workouts: [{ id: 'w', d: '2026-11-01', start: 0, end: 0, name: 'Push', entries: [
  { id: '0025', target: { mode: 'reps' }, sets: [
    { w: 60, r: 8, done: true, tag: 'red', note: 'felt good, grip wide' },
    { w: 62.5, r: 6, done: true, tag: 'blue', type: 'dropset', drops: [{ w: 45, r: 6 }] },
    { w: 60, r: 8, done: true },
  ] },
  { id: '0336', target: { mode: 'reps', side: true }, sets: [
    { w: 12, r: 20, done: true, tag: 'green', note: 'left knee', sides: { L: { w: 12, r: 10, done: true }, R: { w: 12, r: 10, done: true } } },
  ] },
] }] }

describe('set colour tags and set notes survive a CSV round trip', () => {
  const back = parseWorkoutCSV(workoutsCSV(S), { unit: 'kg' })
  const [bench, lunge] = back.workouts[0].entries

  it('straight sets get their tag and note back, untagged ones stay plain', () => {
    expect(bench.sets.map(s => s.tag)).toEqual(['red', 'blue', undefined])
    expect(bench.sets[0].note).toBe('felt good, grip wide')
    expect(bench.sets[2].note).toBeUndefined()
    expect(bench.sets[1].drops).toEqual([{ w: 45, r: 6 }])
  })

  it('a per-side set carries them on the row, not on a side', () => {
    expect(lunge.sets[0].tag).toBe('green')
    expect(lunge.sets[0].note).toBe('left knee')
    expect(lunge.sets[0].sides.L.tag).toBeUndefined()
  })

  it('a colour that is not a tag is left out', () => {
    const csv = workoutsCSV(S).replace(/,red(\r?\n)/, ',magenta$1')
    expect(parseWorkoutCSV(csv, { unit: 'kg' }).workouts[0].entries[0].sets[0].tag).toBeUndefined()
  })
})

describe('FitNotes: a hold logged in its Time column', () => {
  const head = 'Date,Exercise,Category,Weight (kg),Reps,Distance,Distance Unit,Time,Comment\n'
  it('is a timed set of exact seconds, not cardio at 0 km/h', () => {
    const back = parseWorkoutCSV(head + '2026-10-19,Plank,Abs,,,,,0:01:30,\n', { unit: 'kg' })
    expect(back.workouts[0].entries[0].sets[0]).toMatchObject({ sec: 90 })
    expect(back.workouts[0].entries[0].sets[0].speed).toBeUndefined()
  })
  it('a treadmill row with a distance stays cardio', () => {
    const back = parseWorkoutCSV(head + '2026-10-19,Treadmill,Cardio,,,2.5,km,0:20:00,\n', { unit: 'kg' })
    expect(back.workouts[0].entries[0].sets[0]).toMatchObject({ min: 20 })
    expect(back.workouts[0].entries[0].sets[0].sec).toBeUndefined()
  })
})
