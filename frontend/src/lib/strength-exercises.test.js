import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { strengthExerciseRows, strengthExerciseRowsForMuscle, primaryMuscleOf } from './strength-exercises.js'
import { registerCustom } from './exercises.js'

const DAY = 86400000
const NOW = Date.UTC(2026, 7, 8, 12) // 2026-08-08 12:00 UTC

const CUSTOMS = [
  { id: 'bench', n: 'Bench Press', tg: 'chest', mg: 'triceps', sm: ['deltoids'] },
  { id: 'squat', n: 'Squat', tg: 'quadriceps', mg: 'glutes' },
  { id: 'fly', n: 'Cable Crossovers', tg: 'deltoids', mg: 'chest' },
  { id: 'pushdown', n: 'Triceps Pushdown', tg: 'triceps' },
  { id: 'undone', n: 'Undone Lift', tg: 'upper-back' },
  { id: 'stretch', n: 'Chest Stretch', tg: 'chest' },
]

beforeEach(() => registerCustom(CUSTOMS))
afterEach(() => registerCustom([]))

function workout(dayAgo, entries) {
  const d = new Date(NOW - dayAgo * DAY)
  const iso = d.toISOString().slice(0, 10)
  return { id: 'x' + iso, d: iso, start: NOW - dayAgo * DAY, unit: 'kg', entries }
}

const bench = { id: 'bench', n: 'Bench Press', muscleWeights: { chest: 1, triceps: 0.4, deltoids: 0.4 }, sets: [
  { phase: 'warmup', w: 40, r: 8, done: true, unit: 'kg' },
  { phase: 'work', w: 80, r: 8, done: true, unit: 'kg' },
  { phase: 'work', w: 85, r: 6, done: true, unit: 'kg' },
] }
// est 85x6 -> 102.0 ; 80x8 -> 101.3 ; warmup 40x8 -> 50.7 (must never win)

const squat = { id: 'squat', n: 'Squat', muscleWeights: { quadriceps: 1, glutes: 0.4 }, sets: [
  { phase: 'work', w: 100, r: 5, done: true, unit: 'kg' },
] }
// est 100x5 -> 116.7 ; trained 30 days ago -> quadriceps decayed (30d - 14d = 16d / 28d half-life)

const fly = { id: 'fly', n: 'Cable Crossovers', muscleWeights: { chest: 0.4, deltoids: 1 }, sets: [
  { phase: 'work', w: 20, r: 12, done: true, unit: 'kg' },
] }
// est 20x12 -> 28 ; chest is SECONDARY here

const pushdown = { id: 'pushdown', n: 'Triceps Pushdown', muscleWeights: { triceps: 1 }, sets: [
  { phase: 'work', w: 30, r: 10, done: true, unit: 'kg' },
] }
// est 30x10 -> 40

const undone = { id: 'undone', n: 'Undone Lift', muscleWeights: { 'upper-back': 1 }, sets: [
  { phase: 'work', w: 200, r: 5, done: false, unit: 'kg' },
] }

const noLoad = { id: 'stretch', n: 'Chest Stretch', muscleWeights: { chest: 0.4 }, sets: [
  { phase: 'work', w: 0, r: 10, done: true },
] }

const unitState = (workouts) => ({ unit: 'kg', workouts })

describe('strengthExerciseRows', () => {
  it('lists every exercise with an estimate, warm-ups excluded, sorted by expected current 1RM', () => {
    const S = unitState([
      workout(3, [bench]),
      workout(30, [squat]),
      workout(3, [fly, pushdown]),
      workout(2, [undone, noLoad]),
    ])
    const rows = strengthExerciseRows(S, NOW)
    // undone (no completed set) and stretch (no load) have no estimate -> omitted
    expect(rows.map(r => r.id).sort()).toEqual(['bench', 'fly', 'pushdown', 'squat'])
    // strongest expected current first: bench 102 > squat ~78.5 > pushdown 40 > fly 28
    expect(rows[0].id).toBe('bench')
    expect(rows.at(-1).id).toBe('fly')
  })

  it('keeps warm-up sets out of the estimate and reports the date of the best work set', () => {
    const S = unitState([workout(3, [bench])])
    const rows = strengthExerciseRows(S, NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0].est).toBe(102) // 85x6, not 80x8, not the 40x8 warm-up
    expect(rows[0].estDate).toBe('2026-08-05')
    expect(rows[0].primary).toBe('chest')
  })

  it('resolves real exercise names from the catalogue even when entries lack a name snapshot', () => {
    // Imported history entries are { id, sets, topW } - no `n` snapshot. The catalogue
    // (or the registered custom) must supply the display name, not the raw id.
    const nameless = { id: 'bench', sets: bench.sets } // no n, no muscleWeights
    const S = unitState([workout(3, [nameless])])
    const rows = strengthExerciseRows(S, NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Bench Press')
    expect(rows[0].id).toBe('bench')
    const muscleRows = strengthExerciseRowsForMuscle(S, NOW, 'chest')
    expect(muscleRows[0].name).toBe('Bench Press')
  })

  it('uses nested exercise snapshots for a deleted custom exercise', () => {
    const deleted = {
      id: 'deleted-custom',
      muscleSnapshot: { n: 'Deleted custom', muscleWeights: { chest: 1 } },
      sets: [{ phase: 'work', warmup: true, w: 80, r: 8, done: true, unit: 'kg' }],
    }
    const S = unitState([workout(3, [deleted])])
    const rows = strengthExerciseRows(S, NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'deleted-custom', name: 'Deleted custom', primary: 'chest', est: 101.3 })
    expect(strengthExerciseRowsForMuscle(S, NOW, 'chest')[0].name).toBe('Deleted custom')
  })

  it('applies the exercise own decay to the expected current 1RM', () => {
    const S = unitState([workout(3, [bench]), workout(30, [squat])])
    const rows = strengthExerciseRows(S, NOW)
    const benchRow = rows.find(r => r.id === 'bench')
    const squatRow = rows.find(r => r.id === 'squat')
    // bench last done 3 days ago -> still inside the 14-day full-retention plateau
    expect(benchRow.decay).toBe(1)
    expect(benchRow.current).toBe(102)
    // squat last done 30 days ago -> 16 days past the plateau at a 28-day half-life
    const squatDecay = 0.5 ** (16 / 28)
    expect(squatRow.decay).toBeCloseTo(squatDecay, 4)
    expect(squatRow.current).toBeCloseTo(Math.round(116.7 * squatDecay * 10) / 10, 2)
  })

  it('keeps the exercise own decay even when its muscle is kept fresh by other work', () => {
    // bench last done 30 days ago, but chest is fresh (fly trained 3 days ago): the row
    // speaks for the exercise, so bench still shows its own decline.
    const S = unitState([workout(30, [bench]), workout(3, [fly])])
    const rows = strengthExerciseRows(S, NOW)
    const benchRow = rows.find(r => r.id === 'bench')
    const benchDecay = 0.5 ** (16 / 28)
    expect(benchRow.decay).toBeCloseTo(benchDecay, 4)
    expect(benchRow.current).toBeCloseTo(Math.round(102 * benchDecay * 10) / 10, 2)
  })
})

describe('strengthExerciseRowsForMuscle', () => {
  it('lists primary and secondary exercises for the tapped muscle, with that muscle decay', () => {
    const S = unitState([workout(3, [bench, fly, pushdown])])
    const rows = strengthExerciseRowsForMuscle(S, NOW, 'chest')
    expect(rows.map(r => r.id).sort()).toEqual(['bench', 'fly'])
    const benchRow = rows.find(r => r.id === 'bench')
    const flyRow = rows.find(r => r.id === 'fly')
    expect(benchRow.weight).toBe(1)
    expect(benchRow.primary).toBe('chest')
    expect(flyRow.weight).toBe(0.4)
    expect(flyRow.primary).toBe('deltoids')
    expect(flyRow.decay).toBe(1) // chest is at full retention
    expect(flyRow.current).toBe(28)
  })

  it('the tapped muscle filters the list; the row decay stays the exercise own', () => {
    const S = unitState([workout(3, [bench]), workout(30, [fly])])
    const rows = strengthExerciseRowsForMuscle(S, NOW, 'triceps')
    const benchRow = rows.find(r => r.id === 'bench')
    // bench trains triceps secondarily (0.4), so it appears under the tapped triceps -
    // but the decay is bench's own (3 days ago -> full), not triceps' stale muscle value.
    expect(benchRow.weight).toBe(0.4)
    expect(benchRow.primary).toBe('chest')
    expect(benchRow.decay).toBe(1)
    expect(benchRow.current).toBe(102)
  })

  it('returns nothing for a muscle nothing trains', () => {
    const S = unitState([workout(3, [bench])])
    expect(strengthExerciseRowsForMuscle(S, NOW, 'biceps')).toEqual([])
  })
})

describe('primaryMuscleOf', () => {
  it('prefers the catalogue, then the logged snapshot, and handles missing metadata', () => {
    expect(primaryMuscleOf({ id: 'bench', muscleWeights: {} }).slug).toBe('chest') // catalogue wins
    expect(primaryMuscleOf({ muscleWeights: { chest: 1, triceps: 0.4 } }).slug).toBe('chest') // snapshot fallback
    expect(primaryMuscleOf({ tg: 'back', mg: 'biceps' }).slug).toBe('upper-back') // canonicalised
    expect(primaryMuscleOf({})).toBeNull()
    expect(primaryMuscleOf(null)).toBeNull()
  })
})
