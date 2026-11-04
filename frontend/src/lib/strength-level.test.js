import { describe, expect, test } from 'vitest'
import { strengthLevel, strengthLevels, strengthCard, levelPosition, bandRanges, populationShown, BAR_EDGES, ageCoefficient, thresholdsFor, levelAt, liftOf, ageOf } from './strength-level.js'

const BENCH = '0025', DB_BENCH = '0289', CURL_X = '0001'
const wk = (d, id, w, r, extra = {}) => ({ id: d + id, d, start: new Date(d + 'T10:00:00').getTime(), entries: [{ id, target: { mode: 'reps' }, sets: [{ w, r, done: true }], ...extra }] })
const base = extra => ({ unit: 'kg', bodyweight: [{ d: '2026-10-01', w: 80 }], workouts: [], ...extra })

describe('the level bar position and the Stats card split', () => {
  test('the position is a fifth per level, and inside a band the share to the next line', () => {
    // 100 kg at 80 kg: ratio 1.25, halfway from Intermediate's 1.0 to Advanced's 1.5
    expect(levelPosition(strengthLevel(base({ workouts: [wk('2026-10-02', BENCH, 100, 1)] }), BENCH))).toBeCloseTo(0.5)
    // exactly on a line: the start of that level's fifth
    expect(levelPosition(strengthLevel(base({ workouts: [wk('2026-10-02', BENCH, 80, 1)] }), BENCH))).toBeCloseTo(0.4)
    expect(levelPosition(strengthLevel(base({ workouts: [wk('2026-10-02', BENCH, 170, 1)] }), BENCH))).toBe(1)
    expect(levelPosition(null)).toBe(0)
  })
  test('the population scale places a lifter by their percentile, between the cut-offs', () => {
    // bench, men: 1.25× sits halfway between the 1× (50th percentile) and 1.5× (80th) lines
    const lv = strengthLevel(base({ workouts: [wk('2026-10-02', BENCH, 100, 1)] }), BENCH)
    expect(levelPosition(lv, 'population')).toBeCloseTo(0.65)
    expect(levelPosition(strengthLevel(base({ workouts: [wk('2026-10-02', BENCH, 170, 1)] }), BENCH), 'population')).toBe(1)
    expect(BAR_EDGES.population.at(-1)).toBe(1)
  })
  test('the cut-off table ranges: weight from the thresholds, population from the band edges', () => {
    const bands = bandRanges(strengthLevel(base({ workouts: [wk('2026-10-02', BENCH, 100, 1)] }), BENCH))
    expect(bands[0].weight).toEqual({ lo: 0, hi: 0.75 })
    expect(bands[2].weight).toEqual({ lo: 1, hi: 1.5 })
    expect(bands[4].weight).toEqual({ lo: 2, hi: null })
    expect(bands.map(b => [b.pop.lo, b.pop.hi])).toEqual([[0, 20], [20, 50], [50, 80], [80, 95], [95, 100]])
  })
  test('women are graded on their own table; population shares hold for men and unset under 40', () => {
    expect(thresholdsFor('bench', { sex: 'female' })).toEqual([0.25, 0.5, 0.75, 1, 1.5])
    expect(populationShown({})).toBe(true)
    expect(populationShown({ sex: 'male', birthYear: 1990 })).toBe(true)
    expect(populationShown({ sex: 'female', birthYear: 1990 })).toBe(false)
    expect(populationShown({ sex: 'male', birthYear: 1960 })).toBe(false)
    expect(populationShown({ birthYear: 1990 })).toBe(true)
  })
  test('the card splits graded lifts from the standard lifts not logged yet', () => {
    const card = strengthCard(base({ workouts: [wk('2026-10-02', BENCH, 100, 1)] }))
    expect(card.weighed).toBe(true)
    expect(card.done.map(d => d.lift)).toEqual(['bench'])
    expect(card.todo.map(x => x.lift)).not.toContain('bench')
    expect(card.todo.find(x => x.lift === 'squat')).toEqual({ lift: 'squat', id: '0043' })
  })
  test('without a weigh-in the card reports it, and every lift is still to try', () => {
    const card = strengthCard(base({ bodyweight: [], workouts: [wk('2026-10-02', BENCH, 100, 1)] }))
    expect(card.weighed).toBe(false)
    expect(card.done).toEqual([])
    expect(card.todo).toHaveLength(13)
  })
})

describe('strength level per lift', () => {
  test('a 100 kg bench at 80 kg body weight is Intermediate for a man, Advanced for a woman', () => {
    const S = base({ workouts: [wk('2026-10-02', BENCH, 100, 1)] })
    expect(strengthLevel(S, BENCH)).toMatchObject({ lift: 'bench', name: 'intermediate', ratio: 1.25, e1rm: 100, bw: 80, next: { name: 'advanced', ratio: 1.5, weight: 120 } })
    expect(strengthLevel({ ...S, sex: 'female' }, BENCH)).toMatchObject({ name: 'advanced', next: { name: 'elite', weight: 120 } })
  })
  test('elite has no next level, and below the first line is still Beginner', () => {
    expect(strengthLevel(base({ workouts: [wk('2026-10-02', BENCH, 170, 1)] }), BENCH)).toMatchObject({ name: 'elite', next: null })
    expect(strengthLevel(base({ workouts: [wk('2026-10-02', BENCH, 20, 1)] }), BENCH)).toMatchObject({ name: 'beginner', level: 0 })
  })
  test('no weigh-in, no estimate or no standard: no level', () => {
    expect(strengthLevel(base({ bodyweight: [], workouts: [wk('2026-10-02', BENCH, 100, 1)] }), BENCH)).toBe(null)
    expect(strengthLevel(base(), BENCH)).toBe(null)
    expect(liftOf(CURL_X)).toBe(null)
    expect(strengthLevel(base({ workouts: [wk('2026-10-02', CURL_X, 30, 5)] }), CURL_X)).toBe(null)
  })
  test('dumbbells are graded per bell, also when logged as the total of both', () => {
    const S = base({ workouts: [wk('2026-10-02', DB_BENCH, 60, 1, { target: { mode: 'reps', dbLoad: 'total' } })] })
    expect(strengthLevel(S, DB_BENCH)).toMatchObject({ e1rm: 30, perBell: true })
  })
  test('age from 40 eases the lines by the masters coefficients', () => {
    expect(ageCoefficient(30)).toBe(1)
    expect(ageCoefficient(60)).toBeCloseTo(1.3)
    expect(ageCoefficient(62.5)).toBeCloseTo(1.365)
    expect(ageCoefficient(95)).toBe(2.03)
    expect(thresholdsFor('bench', { age: 60 })[2]).toBeCloseTo(1 / 1.3, 3)
    expect(ageOf({ birthYear: 1966 }, 2026)).toBe(60)
    expect(ageOf({}, 2026)).toBe(null)
    const S = base({ birthYear: 1966, workouts: [wk('2026-10-02', BENCH, 100, 1)] })
    expect(strengthLevel(S, BENCH).name).toBe('advanced')
  })
  test('levelAt and the list of lifts', () => {
    expect(levelAt(1.0, [0.5, 0.75, 1, 1.5, 2])).toBe(2)
    expect(levelAt(0.1, [0.5, 0.75, 1, 1.5, 2])).toBe(0)
    const S = base({ workouts: [wk('2026-10-02', BENCH, 100, 1), wk('2026-10-03', '0043', 200, 1)] })
    expect(strengthLevels(S).map(l => [l.lift, l.name])).toEqual([['squat', 'advanced'], ['bench', 'intermediate']])
  })
})
