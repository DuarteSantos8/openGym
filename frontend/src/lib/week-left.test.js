import { describe, expect, test } from 'vitest'
import { workoutsLeft, weekTargetOf } from './week-left.js'

// 2026-10-28 is a Wednesday; the week (Monday start) runs 26 Oct to 1 Nov.
const TODAY = '2026-10-28'
const routines = [{ id: 'A', name: 'Push', ex: [] }, { id: 'B', name: 'Pull', ex: [] }, { id: 'C', name: 'Legs', ex: [] }]
const wk = (d, rid = 'A') => ({ id: 'w' + d + rid, d, start: new Date(d + 'T10:00:00').getTime(), name: 'x', routineIds: [rid], entries: [] })
const base = extra => ({ weekStart: 1, routines, workouts: [], week: {}, ...extra })

describe('workouts left this week (#753)', () => {
  test('a fixed week counts its planned days down', () => {
    const S = base({ week: { 1: ['A'], 3: ['B'], 5: ['C'], 6: ['A'] }, workouts: [wk('2026-10-26')] })
    expect(workoutsLeft(S, TODAY)).toEqual({ left: 3, of: 4, done: 1 })
  })
  test('more workouts than planned is zero left, never negative', () => {
    const S = base({ week: { 1: ['A'] }, workouts: [wk('2026-10-26'), wk('2026-10-27', 'B')] })
    expect(workoutsLeft(S, TODAY)).toEqual({ left: 0, of: 1, done: 2 })
  })
  test('last week does not count', () => {
    const S = base({ week: { 1: ['A'], 3: ['B'] }, workouts: [wk('2026-10-20')] })
    expect(workoutsLeft(S, TODAY).left).toBe(2)
  })
  test('nothing planned, nothing said', () => {
    expect(workoutsLeft(base(), TODAY)).toBe(null)
    expect(workoutsLeft(null, TODAY)).toBe(null)
  })
  test('a rotation counts down its weekly target, and says nothing without one', () => {
    const rotation = { id: 'rot', sequence: ['A', 'B', 'C'], label: '' }
    const queue = { ids: ['A', 'B', 'C'], since: 0, startsOn: '2026-10-01', label: '', rotationId: 'rot' }
    const S = base({ rotation, queue, workouts: [wk('2026-10-26'), wk('2026-10-27', 'B')] })
    expect(workoutsLeft(S, TODAY)).toBe(null)
    expect(workoutsLeft({ ...S, weekTarget: 4 }, TODAY)).toEqual({ left: 2, of: 4, done: 2 })
  })
  test('the target is 1 to 7, anything else is none', () => {
    expect(weekTargetOf({ weekTarget: 3 })).toBe(3)
    expect(weekTargetOf({ weekTarget: 0 })).toBe(null)
    expect(weekTargetOf({ weekTarget: 9 })).toBe(null)
    expect(weekTargetOf({})).toBe(null)
  })
})
