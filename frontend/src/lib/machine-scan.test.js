import { describe, it, expect } from 'vitest'
import { scanSlot, scanInWorkout, pickForScan } from './machine-scan.js'
import { moveActiveWorkoutUnitTo } from './active-workout-order.js'

function ex(id, done, total, sg) {
  const sets = Array.from({ length: total }, (_, i) => ({ reps: 8, done: i < done }))
  return sg ? { id, sets, sg } : { id, sets }
}

describe('scanInWorkout', () => {
  it('after the current exercise once it is started: A B D C', () => {
    const A = { cur: 1, entries: [ex('A', 3, 3), ex('B', 1, 3), ex('C', 0, 3)] }
    expect(scanInWorkout(A, 'D')).toEqual({ do: 'add', slot: 2 })
  })
  it('in front of the current exercise when it is not started: A D B C', () => {
    const A = { cur: 1, entries: [ex('A', 3, 3), ex('B', 0, 3), ex('C', 0, 3)] }
    expect(scanInWorkout(A, 'D')).toEqual({ do: 'add', slot: 1 })
    expect(scanInWorkout(A, 'C')).toEqual({ do: 'move', idx: 2, slot: 1 })
  })
  it('a done exercise is only jumped to', () => {
    const A = { cur: 1, entries: [ex('A', 3, 3), ex('B', 1, 3)] }
    expect(scanInWorkout(A, 'A')).toEqual({ do: 'jump', idx: 0 })
  })
  it('current exercise scanned: jump, no move', () => {
    const A = { cur: 1, entries: [ex('A', 3, 3), ex('B', 1, 3), ex('C', 0, 3)] }
    expect(scanInWorkout(A, 'B')).toEqual({ do: 'jump', idx: 1 })
  })
  it('an exercise already at the slot is only jumped to', () => {
    const A = { cur: 0, entries: [ex('A', 1, 3), ex('B', 0, 3), ex('C', 0, 3)] }
    expect(scanInWorkout(A, 'B')).toEqual({ do: 'jump', idx: 1 })
  })
  it('inserts after a started superset', () => {
    const A = { cur: 1, entries: [ex('A', 3, 3), ex('B', 1, 3, 's1'), ex('C', 0, 3, 's1'), ex('D', 0, 3)] }
    expect(scanInWorkout(A, 'E')).toEqual({ do: 'add', slot: 3 })
    expect(scanSlot(A)).toBe(3)
  })
  it('in front of an unstarted superset', () => {
    const A = { cur: 2, entries: [ex('A', 3, 3), ex('B', 0, 3, 's1'), ex('C', 0, 3, 's1')] }
    expect(scanSlot(A)).toBe(1)
  })
})

describe('moveActiveWorkoutUnitTo', () => {
  it('moves a whole superset when one member is scanned', () => {
    const A = { cur: 0, entries: [ex('A', 1, 3), ex('B', 0, 3), ex('C', 0, 3, 's2'), ex('D', 0, 3, 's2')] }
    const r = moveActiveWorkoutUnitTo(A, 3, 1)
    expect(A.entries.map(e => e.id)).toEqual(['A', 'C', 'D', 'B'])
    expect(r.indices).toEqual([0, 2, 3, 1])
    expect(A.cur).toBe(2)
  })
  it('moves later, slot counted before the move', () => {
    const A = { cur: 0, entries: [ex('A', 0, 1), ex('B', 0, 1), ex('C', 0, 1)] }
    const r = moveActiveWorkoutUnitTo(A, 0, 3)
    expect(A.entries.map(e => e.id)).toEqual(['B', 'C', 'A'])
    expect(r.indices).toEqual([1, 2, 0])
    expect(A.cur).toBe(2)
  })
  it('returns null when the order would not change', () => {
    const A = { cur: 0, entries: [ex('A', 0, 1), ex('B', 0, 1)] }
    expect(moveActiveWorkoutUnitTo(A, 1, 1)).toBe(null)
    expect(moveActiveWorkoutUnitTo(A, 1, 2)).toBe(null)
  })
})

describe('pickForScan', () => {
  it('prefers the one still to do', () => {
    const A = { cur: 0, entries: [ex('CHEST', 0, 3), ex('LAT', 3, 3)] }
    expect(pickForScan(A, ['CHEST', 'LAT'])).toBe('CHEST')
    expect(pickForScan({ cur: 0, entries: [ex('X', 0, 3)] }, ['CHEST', 'LAT'])).toBe(null)
    expect(pickForScan({ cur: 0, entries: [ex('CHEST', 0, 3), ex('LAT', 0, 3)] }, ['CHEST', 'LAT'])).toBe(null)
    expect(pickForScan({ cur: 0, entries: [ex('X', 0, 3)] }, ['CHEST'])).toBe('CHEST')
  })
})
