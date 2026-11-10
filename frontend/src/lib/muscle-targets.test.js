import { describe, expect, test } from 'vitest'
import { weeklyMuscleSets, targetOf, statusOf, mostRoom, withTarget, DEFAULT_TARGETS } from './muscle-targets.js'

const BENCH = '0025', SQUAT = '0043'
const TODAY = '2026-10-28'   // a Wednesday
const wk = (d, id, n, extra = {}) => ({ id: d + id, d, start: 1, entries: [{ id, sets: Array.from({ length: n }, () => ({ w: 60, r: 8, done: true })), ...extra }] })

describe('weekly sets per muscle', () => {
  test('counts this week’s working sets, primary 1, supporting 0.4, warm-ups and last week left out', () => {
    const S = { weekStart: 1, workouts: [
      wk('2026-10-26', BENCH, 4),
      wk('2026-10-27', SQUAT, 3),
      wk('2026-10-20', BENCH, 10),
      { id: 'warm', d: '2026-10-27', start: 1, entries: [{ id: BENCH, sets: [{ w: 40, r: 5, done: true, phase: 'warmup' }, { w: 60, r: 8, done: false }] }] },
    ] }
    const rows = Object.fromEntries(weeklyMuscleSets(S, TODAY).map(r => [r.slug, r]))
    expect(rows.chest).toMatchObject({ sets: 4, lo: 10, hi: 20, status: 'below' })
    expect(rows.triceps.sets).toBeCloseTo(1.6)
    expect(rows.quadriceps.sets).toBe(3)
    expect(Object.keys(rows)).toEqual(Object.keys(DEFAULT_TARGETS))
  })
  test('in range and above it', () => {
    expect(statusOf(10, [10, 20])).toBe('in')
    expect(statusOf(20, [10, 20])).toBe('in')
    expect(statusOf(21, [10, 20])).toBe('above')
    expect(statusOf(9.6, [10, 20])).toBe('below')
  })
  test('your own range wins, a broken one falls back to the default', () => {
    expect(targetOf({ muscleTargets: { chest: [12, 16] } }, 'chest')).toEqual([12, 16])
    expect(targetOf({ muscleTargets: { chest: [16, 12] } }, 'chest')).toEqual([10, 20])
    expect(targetOf({}, 'nope')).toBe(null)
  })
  test('setting a range: put in order, and the default stored as no override', () => {
    expect(withTarget({}, 'chest', [18, 12])).toEqual({ chest: [12, 18] })
    expect(withTarget({ chest: [12, 18] }, 'chest', [10, 20])).toEqual({})
    expect(withTarget({ chest: [12, 18] }, 'chest', null)).toEqual({})
  })
  test('the most room is the muscle furthest under its low end, by share', () => {
    const rows = [{ slug: 'a', sets: 0, lo: 4, status: 'below' }, { slug: 'b', sets: 5, lo: 10, status: 'below' }, { slug: 'c', sets: 30, lo: 10, status: 'above' }]
    expect(mostRoom(rows).slug).toBe('a')
    expect(mostRoom([{ slug: 'c', status: 'in' }])).toBe(null)
  })
})
