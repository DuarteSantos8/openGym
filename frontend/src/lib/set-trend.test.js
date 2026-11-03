import { describe, expect, test } from 'vitest'
import { setTrend, setTrendsFor, lastTimeBefore, trendGlyph, trendLabel, setTrendOn } from './set-trend.js'

const set = (w, r, extra = {}) => ({ w, r, done: true, ...extra })

describe('setTrend (#907)', () => {
  test('weight first, then reps', () => {
    expect(setTrend(set(80, 8), set(77.5, 8))).toMatchObject({ dir: 1, by: 'w', delta: 2.5 })
    expect(setTrend(set(80, 7), set(80, 7))).toMatchObject({ dir: 0 })
    expect(setTrend(set(75, 5), set(75, 6))).toMatchObject({ dir: -1, by: 'r', delta: -1 })
    expect(setTrend(set(80, 9), set(77.5, 8))).toMatchObject({ dir: 1, by: 'w' })
    expect(setTrend(set(70, 6), set(75, 6))).toMatchObject({ dir: -1, by: 'w' })
  })
  test('weight and reps pulling apart are settled by the estimated 1RM', () => {
    // 70 × 6 (e1RM 84) beats 60 × 8 (76), the issue's example
    expect(setTrend(set(70, 6), set(60, 8))).toMatchObject({ dir: 1, by: 'e1rm' })
    expect(setTrend(set(60, 12), set(80, 5))).toMatchObject({ dir: -1, by: 'e1rm' })
  })
  test('on an assisted machine less help is better', () => {
    expect(setTrend(set(20, 8), set(25, 8), { assisted: true })).toMatchObject({ dir: 1, by: 'w', delta: -5 })
    expect(setTrend(set(30, 10), set(25, 8), { assisted: true })).toMatchObject({ dir: -1, by: 'w' })
  })
  test('bodyweight sets go by reps', () => {
    expect(setTrend(set(0, 12), set(0, 10))).toMatchObject({ dir: 1, by: 'r', delta: 2 })
  })
  test('holds by seconds, cardio by minutes then speed', () => {
    expect(setTrend({ sec: 45, done: true }, { sec: 40, done: true }, { mode: 'time' })).toMatchObject({ dir: 1, by: 'sec', delta: 5 })
    expect(setTrend({ min: 20, speed: 10, done: true }, { min: 25, speed: 9, done: true }, { mode: 'cardio' })).toMatchObject({ dir: -1, by: 'min' })
    expect(setTrend({ min: 20, speed: 10, done: true }, { min: 20, speed: 9, done: true }, { mode: 'cardio' })).toMatchObject({ dir: 1, by: 'speed' })
  })
  test('nothing for warm-ups or empty sets', () => {
    expect(setTrend(set(40, 5, { warmup: true, phase: 'warmup' }), set(40, 5))).toBe(null)
    expect(setTrend(set(80, 0), set(80, 8))).toBe(null)
    expect(setTrend(set(80, 8), null)).toBe(null)
  })
})

describe('setTrendsFor', () => {
  const entry = {
    id: 'barbell bench press', target: { mode: 'reps' },
    sets: [
      { w: 40, r: 5, done: true, phase: 'warmup' },
      set(80, 8), set(80, 7), set(70, 6), { w: 75, r: 5, done: false },
    ],
  }
  const last = { sets: [set(77.5, 8), set(80, 7), set(60, 8), set(75, 6)], target: { mode: 'reps' } }
  test('work set N against work set N, skipping warm-ups and sets not done', () => {
    const out = setTrendsFor(entry, last)
    expect(out.map(trendGlyph)).toEqual(['', '↑', '=', '↑', ''])
  })
  test('a set with no counterpart says nothing', () => {
    const out = setTrendsFor(entry, { sets: [set(77.5, 8)] })
    expect(out.map(trendGlyph)).toEqual(['', '↑', '', '', ''])
  })
  test('a hold against rep sets compares nothing', () => {
    expect(setTrendsFor({ ...entry, target: { mode: 'time' } }, last).every(x => x == null)).toBe(true)
  })
  test('per-side sets compare their summary, once both sides are done', () => {
    const side = (w, r, done = true) => ({ w, r, done })
    const e = { id: 'dumbbell lunge', target: { mode: 'reps' }, sets: [
      { w: 20, r: 16, done: true, sides: { L: side(20, 8), R: side(20, 8) } },
      { w: 20, r: 14, done: false, sides: { L: side(20, 7), R: side(20, 7, false) } },
    ] }
    const prev = { sets: [{ w: 20, r: 14, done: true }, { w: 20, r: 14, done: true }] }
    expect(setTrendsFor(e, prev).map(trendGlyph)).toEqual(['↑', ''])
  })
})

describe('lastTimeBefore', () => {
  const ex = 'barbell squat'
  const wk = (id, d, w) => ({ id, d, start: new Date(d + 'T10:00:00').getTime(), entries: [{ id: ex, target: { mode: 'reps' }, sets: [set(w, 5)] }] })
  const S = { workouts: [wk('a', '2026-10-01', 100), wk('b', '2026-10-05', 105), wk('c', '2026-10-09', 110)] }
  test('an old workout is held against the one before it, never a later one', () => {
    expect(lastTimeBefore(S, S.workouts[1], S.workouts[1].entries[0]).sets[0].w).toBe(100)
    expect(lastTimeBefore(S, S.workouts[0], S.workouts[0].entries[0])).toBe(null)
    expect(lastTimeBefore(S, S.workouts[2], S.workouts[2].entries[0]).sets[0].w).toBe(105)
  })
})

describe('labels and the switch', () => {
  test('say what changed, in plain words', () => {
    expect(trendLabel({ dir: 1, by: 'w', delta: 2.5 }, 'kg')).toBe('2.5 kg more than last time')
    expect(trendLabel({ dir: -1, by: 'w', delta: -5 }, 'lb')).toBe('5 lb less than last time')
    expect(trendLabel({ dir: 1, by: 'w', delta: -5 }, 'kg')).toBe('5 kg less help than last time')
    expect(trendLabel({ dir: -1, by: 'r', delta: -1 })).toBe('1 rep fewer than last time')
    expect(trendLabel({ dir: 1, by: 'r', delta: 2 })).toBe('2 more reps than last time')
    expect(trendLabel({ dir: 0, by: 'w', delta: 0 })).toBe('Same as last time')
    expect(trendLabel({ dir: 1, by: 'e1rm', delta: 4 })).toBe('Better estimated 1RM than last time')
    expect(trendLabel(null)).toBe('')
  })
  test('on unless switched off', () => {
    expect(setTrendOn({})).toBe(true)
    expect(setTrendOn({ setTrend: false })).toBe(false)
  })
})
