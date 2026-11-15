import { describe, expect, it } from 'vitest'
import { lifetimeTotals, likenessOf, cardioWeeks, cardioGoalOf } from './lifetime.js'

const set = (extra = {}) => ({ w: 50, r: 10, done: true, ...extra })

describe('lifetimeTotals', () => {
  it('counts workouts, work sets and hours, and leaves out warm-ups, open sets and a timer left running', () => {
    const S = { workouts: [
      { d: '2026-11-01', start: 0, end: 3600e3, entries: [{ id: 'a', sets: [set({ phase: 'warmup' }), set(), set(), set({ done: false })] }] },
      { d: '2026-11-02', start: 0, end: 30 * 60e3, entries: [{ id: 'b', sets: [set()] }] },
      { d: '2026-11-03', start: 0, end: 20 * 3600e3, entries: [{ id: 'c', sets: [set()] }] },  // forgot to finish
      { d: '2026-11-04', entries: [{ id: 'd', sets: [set()] }] },                              // imported, no clock
    ] }
    const r = lifetimeTotals(S)
    expect(r.workouts).toBe(4)
    expect(r.sets).toBe(5)
    expect(r.hours).toBeCloseTo(1.5)
  })
  it('names a size for the total, without plurals', () => {
    expect(likenessOf(100)).toBe('')
    expect(likenessOf(450)).toBe('About as heavy as a grand piano.')
    expect(likenessOf(3100)).toBe('About 2× a car.')
    expect(likenessOf(1_284_000)).toBe('About 8× a blue whale.')
  })
})

describe('cardioWeeks', () => {
  it('sums cardio minutes per profile week, this week last', () => {
    const S = { weekStart: 1, workouts: [
      { d: '2026-11-03', entries: [{ id: 'x', sets: [{ min: 30, speed: 10, done: true }, { min: 10, done: false }] }] },
      { d: '2026-11-05', entries: [{ id: 'x', sets: [{ min: 25, done: true }] }, { id: 'y', sets: [set()] }] },
      { d: '2026-10-27', entries: [{ id: 'x', sets: [{ min: 40, done: true }] }] },
      { d: '2025-01-01', entries: [{ id: 'x', sets: [{ min: 99, done: true }] }] },
    ] }
    const weeks = cardioWeeks(S, { today: '2026-11-06' })
    expect(weeks).toHaveLength(8)
    expect(weeks.at(-1)).toEqual({ week: '2026-11-02', min: 55 })
    expect(weeks.at(-2)).toEqual({ week: '2026-10-26', min: 40 })
    expect(weeks.reduce((n, w) => n + w.min, 0)).toBe(95)
  })
  it('reads a goal only when it is a sane number of minutes', () => {
    expect(cardioGoalOf({ cardioGoal: 150 })).toBe(150)
    expect(cardioGoalOf({})).toBe(0)
    expect(cardioGoalOf({ cardioGoal: 'x' })).toBe(0)
    expect(cardioGoalOf({ cardioGoal: 1e9 })).toBe(0)
  })
})
