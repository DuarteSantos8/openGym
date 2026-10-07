import { describe, expect, it } from 'vitest'
import { moveRoutineEntry, moveSupersetUnit } from './history.js'

// #377: the routine editor's arrows move one exercise. Inside a superset it passes the next
// member; at the edge it leaves the superset where it stands; a single exercise still jumps a
// whole superset and never joins it.
const e = (id, sg, extra = {}) => ({ id, sets: 3, reps: 8, ...(sg ? { sg } : {}), ...extra })
const ids = list => list.map(x => x.id + (x.sg ? ':' + x.sg : ''))

describe('moveRoutineEntry', () => {
  it('swaps with the next member inside a superset, configurations untouched', () => {
    const a = e('a', 'g', { w: 40, note: 'pause' }), b = e('b', 'g'), c = e('c', 'g'), d = e('d')
    const items = [a, b, c, d]
    const down = moveRoutineEntry(items, 0, 1)
    expect(ids(down)).toEqual(['b:g', 'a:g', 'c:g', 'd'])
    expect(down[1]).toBe(a)   // the same object: nothing about it changed
    const up = moveRoutineEntry(items, 2, -1)
    expect(ids(up)).toEqual(['a:g', 'c:g', 'b:g', 'd'])
    expect(ids(items)).toEqual(['a:g', 'b:g', 'c:g', 'd'])   // never mutated
  })

  it('leaves the superset at its top edge, where it stands', () => {
    const items = [e('x'), e('a', 'g'), e('b', 'g'), e('c', 'g')]
    const out = moveRoutineEntry(items, 1, -1)
    expect(ids(out)).toEqual(['x', 'a', 'b:g', 'c:g'])
    expect(out[1]).toEqual(e('a'))
    expect(items[1].sg).toBe('g')
  })

  it('leaves the superset at its bottom edge, where it stands', () => {
    const items = [e('a', 'g'), e('b', 'g'), e('c', 'g'), e('y')]
    expect(ids(moveRoutineEntry(items, 2, 1))).toEqual(['a:g', 'b:g', 'c', 'y'])
  })

  it('a superset of two dissolves when one leaves', () => {
    const items = [e('a', 'g'), e('b', 'g'), e('c')]
    expect(ids(moveRoutineEntry(items, 1, 1))).toEqual(['a', 'b', 'c'])
    expect(ids(moveRoutineEntry(items, 0, -1))).toEqual(['a', 'b', 'c'])
  })

  it('a member at the very top or bottom of the list can still leave', () => {
    const items = [e('a', 'g'), e('b', 'g'), e('c', 'g')]
    expect(ids(moveRoutineEntry(items, 0, -1))).toEqual(['a', 'b:g', 'c:g'])
    expect(ids(moveRoutineEntry(items, 2, 1))).toEqual(['a:g', 'b:g', 'c'])
  })

  it('a single exercise jumps a whole superset and does not join it', () => {
    const items = [e('x'), e('a', 'g'), e('b', 'g'), e('y')]
    expect(ids(moveRoutineEntry(items, 0, 1))).toEqual(['a:g', 'b:g', 'x', 'y'])
    expect(ids(moveRoutineEntry(items, 3, -1))).toEqual(['x', 'y', 'a:g', 'b:g'])
    expect(moveRoutineEntry(items, 0, 1)).toEqual(moveSupersetUnit(items, 0, 1))
  })

  it('a press that does nothing returns null and changes nothing', () => {
    const items = [e('x', 'lone'), e('a'), e('b')]
    const before = JSON.stringify(items)
    expect(moveRoutineEntry(items, 0, -1)).toBeNull()   // a lone leftover sg is no superset
    expect(moveRoutineEntry(items, 2, 1)).toBeNull()
    expect(moveRoutineEntry(items, 5, 1)).toBeNull()
    expect(moveRoutineEntry(items, 1, 2)).toBeNull()
    expect(moveRoutineEntry(null, 0, 1)).toBeNull()
    expect(JSON.stringify(items)).toBe(before)
  })
})
