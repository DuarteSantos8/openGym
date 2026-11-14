import { describe, it, expect } from 'vitest'
import { entryTimes, exerciseTimeRows } from './exercise-time.js'

const MIN = 60000
const T0 = Date.UTC(2026, 9, 20, 17)
const tick = (min, extra = {}) => ({ w: 50, r: 8, done: true, at: T0 + min * MIN, ...extra })
const wo = (entries, extra = {}) => ({ id: 'w', d: '2026-10-20', start: T0, end: T0 + 60 * MIN, entries, ...extra })

describe('exercise time', () => {
  it('gives the time up to each tick to that set’s exercise', () => {
    const w = wo([{ id: 'a', sets: [tick(3), tick(6), tick(9)] }, { id: 'b', sets: [tick(13), tick(16)] }])
    expect(entryTimes(w)).toEqual([9 * MIN, 7 * MIN])
  })

  it('splits a superset’s time as its sets were done', () => {
    const w = wo([{ id: 'a', sets: [tick(2), tick(6)] }, { id: 'b', sets: [tick(4), tick(8)] }])
    expect(entryTimes(w)).toEqual([4 * MIN, 4 * MIN])
  })

  it('leaves out unticked sets, untimed workouts and ticks outside the workout', () => {
    expect(entryTimes(wo([{ id: 'a', sets: [{ w: 50, r: 8, done: true }] }]))).toEqual([])
    const w = wo([{ id: 'a', sets: [tick(5), tick(7, { done: false })] }, { id: 'b', sets: [tick(-5), tick(10), tick(200)] }])
    expect(entryTimes(w)).toEqual([5 * MIN, 5 * MIN])
  })

  it('counts a timed row ticked as it began for its own length', () => {
    const w = wo([{ id: 'a', sets: [tick(10)] }, { id: 'bike', sets: [tick(11, { min: 20, w: 0, r: 0 })] }, { id: 'c', sets: [tick(33)] }])
    expect(entryTimes(w)).toEqual([10 * MIN, 20 * MIN, 3 * MIN])
  })

  it('a pause past the forgotten-session gap is a break, not the next exercise’s', () => {
    const w = wo([{ id: 'a', sets: [tick(5)] }, { id: 'b', sets: [tick(40), tick(42)] }], { end: T0 + 50 * MIN })
    expect(entryTimes(w)).toEqual([5 * MIN, 2 * MIN])
  })

  it('averages each exercise over its sessions, one per workout, from a start time on', () => {
    const day = (start, entries) => ({ id: 'w' + start, start, end: start + 60 * MIN, entries })
    const T1 = T0 + 7 * 86400000
    const ws = [
      day(T0, [{ id: 'a', sets: [{ w: 50, r: 8, done: true, at: T0 + 4 * MIN }] }, { id: 'b', sets: [{ w: 9, r: 8, done: true, at: T0 + 6 * MIN }] }, { id: 'a', sets: [{ w: 50, r: 8, done: true, at: T0 + 8 * MIN }] }]),
      day(T1, [{ id: 'a', sets: [{ w: 50, r: 8, done: true, at: T1 + 2 * MIN }] }]),
      { id: 'imported', start: T1, entries: [{ id: 'b', sets: [{ w: 9, r: 8, done: true }] }] },
    ]
    expect(exerciseTimeRows(ws)).toEqual([
      { id: 'a', sessions: 2, total: 8 * MIN, avg: 4 * MIN },
      { id: 'b', sessions: 1, total: 2 * MIN, avg: 2 * MIN },
    ])
    expect(exerciseTimeRows(ws, T1)).toEqual([{ id: 'a', sessions: 1, total: 2 * MIN, avg: 2 * MIN }])
    expect(exerciseTimeRows([])).toEqual([])
  })
})
