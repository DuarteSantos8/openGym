import { describe, expect, it } from 'vitest'
import { parseWorkoutCSV, mergeImport } from './import-csv.js'
import { filterImport, importExercises } from './import-select.js'

// Synthetic FitNotes-style rows: two library lifts, two names the library doesn't have, and a
// day (09-05) that holds nothing but one of those.
const CSV = [
  'Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment',
  '2026-09-01,Bench Press,Chest,80,kgs,5,,,,',
  '2026-09-01,Bench Press,Chest,80,kgs,5,,,,',
  '2026-09-01,Grip Trainer Deluxe,Forearms,30,kgs,10,,,,',
  '2026-09-03,Deadlift,Back,140,kgs,5,,,,',
  '2026-09-03,Bench Press,Chest,82.5,kgs,4,,,,',
  '2026-09-03,Grip Trainer Deluxe,Forearms,30,kgs,12,,,,',
  '2026-09-05,Garden Walk,Cardio,,,,3.2,km,0:40:00,',
  '2026-09-05,Garden Walk,Cardio,,,,1.1,km,0:15:00,',
].join('\n')
const parse = () => parseWorkoutCSV(CSV, { unit: 'kg' })
const idOf = (p, name) => p.customEx.find(c => c.n === name)?.id
const allIds = p => importExercises(p).map(x => x.id)

describe('importExercises', () => {
  it('lists every exercise once with its sets and workouts, most sets first', () => {
    const p = parse()
    const list = importExercises(p)
    expect(list.map(x => x.sets)).toEqual([3, 2, 2, 1])
    expect(list[0]).toMatchObject({ sets: 3, workouts: 2, custom: false })
    expect(list.find(x => x.id === idOf(p, 'grip trainer deluxe'))).toMatchObject({ sets: 2, workouts: 2, custom: true })
    expect(list.find(x => x.id === idOf(p, 'garden walk'))).toMatchObject({ sets: 2, workouts: 1, custom: true })
    expect(list.reduce((n, x) => n + x.sets, 0)).toBe(p.sets)
  })
})

describe('filterImport', () => {
  it('keeping everything gives back the same result', () => {
    const p = parse()
    expect(filterImport(p, allIds(p))).toEqual(p)
  })

  it('leaves one exercise out of every workout and recounts', () => {
    const p = parse()
    const grip = idOf(p, 'grip trainer deluxe')
    const f = filterImport(p, allIds(p).filter(id => id !== grip))
    expect(f.workouts).toHaveLength(3)
    expect(f.workouts.flatMap(w => w.entries.map(e => e.id))).not.toContain(grip)
    expect(f.sets).toBe(p.sets - 2)
    expect(f.matched).toBe(p.matched)
    expect(f.created).toBe(1)
    expect(f.customEx.map(c => c.n)).toEqual(['garden walk'])
    expect(f.unmatchedNames).toEqual(['Garden Walk'])
    // The stored volume is the kept sets' only.
    expect(f.workouts[0].vol).toBe(80 * 5 * 2)
    // A narrower import is a different workout to the sync merge.
    expect(f.workouts[0].id).not.toBe(p.workouts[0].id)
    expect(f.workouts[2]).toBe(p.workouts[2])
  })

  it('drops a day left with nothing, and the date range shrinks with it', () => {
    const p = parse()
    expect([p.from, p.to]).toEqual(['2026-09-01', '2026-09-05'])
    const walk = idOf(p, 'garden walk')
    const f = filterImport(p, allIds(p).filter(id => id !== walk))
    expect(f.workouts.map(w => w.d)).toEqual(['2026-09-01', '2026-09-03'])
    expect([f.from, f.to]).toEqual(['2026-09-01', '2026-09-03'])
    expect(f.unmatchedNames).toEqual(['Grip Trainer Deluxe'])
  })

  it('creates no exercise nothing uses any more', () => {
    const p = parse()
    const keep = allIds(p).filter(id => !p.customEx.some(c => c.id === id))
    const f = filterImport(p, keep)
    expect(f.customEx).toEqual([])
    expect(f.created).toBe(0)
    expect(f.unmatchedNames).toEqual([])
    expect([f.from, f.to]).toEqual(['2026-09-01', '2026-09-03'])
    const S = { workouts: [], customEx: [], bodyweight: [], exWeights: {} }
    expect(mergeImport(S, f).added).toBe(2)
    expect(S.customEx).toEqual([])
  })

  it('a library lift left out counts out of the matches', () => {
    const p = parse()
    const [bench] = importExercises(p)
    const f = filterImport(p, allIds(p).filter(id => id !== bench.id))
    expect(f.matched).toBe(p.matched - 1)
    expect(f.matchedSets).toBe(p.matchedSets - 3)
    expect(f.workouts.map(w => w.entries.length)).toEqual([1, 2, 1])
  })

  it('nothing kept leaves nothing to import', () => {
    const f = filterImport(parse(), [])
    expect(f.workouts).toEqual([])
    expect(f.sets).toBe(0)
    expect([f.from, f.to]).toEqual([null, null])
  })

  it('a superset whose partner is left out is no superset any more', () => {
    const hevy = [
      'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe',
      'Push,"1 Sep 2026, 18:00","1 Sep 2026, 19:00",,Bench Press (Barbell),0,,0,normal,80,5,,,',
      'Push,"1 Sep 2026, 18:00","1 Sep 2026, 19:00",,Lateral Raise (Dumbbell),0,,0,normal,10,12,,,',
      'Push,"1 Sep 2026, 18:00","1 Sep 2026, 19:00",,Deadlift (Barbell),,,0,normal,140,5,,,',
    ].join('\n')
    const p = parseWorkoutCSV(hevy, { unit: 'kg' })
    const [a, b, c] = p.workouts[0].entries
    expect(a.sg).toBeTruthy()
    expect(b.sg).toBe(a.sg)
    const f = filterImport(p, [a.id, c.id])
    expect(f.workouts[0].entries.map(e => e.id)).toEqual([a.id, c.id])
    expect(f.workouts[0].entries[0].sg).toBeUndefined()
    // The parse's own entry is left as it was.
    expect(p.workouts[0].entries[0].sg).toBe(a.sg)
  })
})
