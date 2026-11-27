import { describe, expect, test } from 'vitest'
import { strengthLevel, strengthLevels, ageCoefficient, thresholdsFor, levelAt, liftOf, ageOf } from './strength-level.js'

const BENCH = '0025', DB_BENCH = '0289', CURL_X = '0001'
const wk = (d, id, w, r, extra = {}) => ({ id: d + id, d, start: new Date(d + 'T10:00:00').getTime(), entries: [{ id, target: { mode: 'reps' }, sets: [{ w, r, done: true }], ...extra }] })
const base = extra => ({ unit: 'kg', bodyweight: [{ d: '2026-10-01', w: 80 }], workouts: [], ...extra })

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

// The body weight a lift is graded against (owner 2026-11-24): that day's, never just today's.
describe('strength level against the body weight of the day', () => {
  const NOW = new Date('2026-11-24T12:00:00').getTime()
  const lv = (S, id = BENCH) => strengthLevel(S, id, { now: NOW })
  test('weighed in that day: that weigh-in', () => {
    const S = base({ bodyweight: [{ d: '2026-10-02', w: 100 }, { d: '2026-11-20', w: 80 }], workouts: [wk('2026-10-02', BENCH, 100, 1)] })
    // 100 at 100 is 1.0 (intermediate), not 1.25 against today's 80; the next step is for today
    expect(lv(S)).toMatchObject({ ratio: 1, bw: expect.closeTo(100, 0), name: 'intermediate', approx: false, d: '2026-10-02', next: { name: 'advanced', weight: 120 } })
  })
  test('no weigh-in that day: the line between the last one before and the next one after', () => {
    // 10:00 on the 11th, between 90 at noon on the 1st and 80 at noon on the 21st: 85.04
    const S = base({ bodyweight: [{ d: '2026-10-01', w: 90 }, { d: '2026-10-21', w: 80 }], workouts: [wk('2026-10-11', BENCH, 100, 1)] })
    const r = lv(S)
    expect(r.bw).toBeCloseTo(85, 0)
    expect(r.ratio).toBeCloseTo(100 / 85.04, 2)
  })
  test('weigh-ins only before, or only after the lift', () => {
    expect(lv(base({ bodyweight: [{ d: '2026-10-01', w: 90 }], workouts: [wk('2026-10-20', BENCH, 90, 1)] }))).toMatchObject({ bw: 90, ratio: 1, approx: false })
    expect(lv(base({ bodyweight: [{ d: '2026-10-25', w: 90 }], workouts: [wk('2026-10-20', BENCH, 90, 1)] }))).toMatchObject({ bw: 90, ratio: 1, approx: false })
  })
  test('the session’s own check-in wins over the log', () => {
    const S = base({ bodyweight: [{ d: '2026-10-01', w: 90 }], workouts: [{ ...wk('2026-10-02', BENCH, 100, 1), bw: 80 }] })
    expect(lv(S)).toMatchObject({ bw: 80, ratio: 1.25 })
  })
  test('the best ratio sets the level, not the heaviest lift', () => {
    // 100 at 80 (1.25) beats 110 at 100 (1.1) after a bulk
    const S = base({
      bodyweight: [{ d: '2026-03-01', w: 80 }, { d: '2026-10-01', w: 100 }],
      workouts: [wk('2026-03-01', BENCH, 100, 1), wk('2026-10-01', BENCH, 110, 1)],
    })
    expect(lv(S)).toMatchObject({ ratio: 1.25, e1rm: 100, d: '2026-03-01', next: { weight: 150 } })
  })
  test('a lift with no weigh-in within a month is left out while another has one', () => {
    const S = base({
      bodyweight: [{ d: '2026-10-01', w: 80 }],
      workouts: [wk('2025-01-10', BENCH, 140, 1), wk('2026-10-02', BENCH, 100, 1)],
    })
    expect(lv(S)).toMatchObject({ e1rm: 100, ratio: 1.25, approx: false })
  })
  test('no weigh-in near any lift: the best lift against the nearest weigh-in, flagged', () => {
    const S = base({ bodyweight: [{ d: '2026-10-01', w: 80 }], workouts: [wk('2025-01-10', BENCH, 120, 1)] })
    expect(lv(S)).toMatchObject({ e1rm: 120, bw: 80, ratio: 1.5, approx: true })
  })
  test('no weigh-in at all but a checked-in session: graded by the check-in', () => {
    const S = base({ bodyweight: [], workouts: [{ ...wk('2026-10-02', BENCH, 100, 1), bw: 80 }] })
    expect(lv(S)).toMatchObject({ ratio: 1.25, next: { weight: 120 } })
  })
  test('weigh-ins stored out of order read the same', () => {
    const S = base({ bodyweight: [{ d: '2026-11-20', w: 80 }, { d: '2026-10-02', w: 100 }], workouts: [wk('2026-10-02', BENCH, 100, 1)] })
    expect(lv(S)).toMatchObject({ ratio: 1, currentBw: 80 })
  })
})
