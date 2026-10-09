import { describe, it, expect } from 'vitest'
import { copyRowAt, copySpanAt, insertRowAt, removeRowAt } from './history.js'
import { makeSideSet, setSideField, toggleSide, isSideSet } from './workout-model.js'

// Swipe on sets (v1.3.11): swipe right copies a set, swipe left removes one with an Undo.
describe('copyRowAt', () => {
  it('puts an unticked copy of a work set right below it, keeping weight, reps and effort', () => {
    const rows = [{ w: 60, r: 8, done: true, rir: 2, at: 123, weightOrigin: 'manual' }, { w: 60, r: 8, done: false }]
    const out = copyRowAt(rows, 0)
    expect(out).toHaveLength(3)
    expect(out[1]).toEqual({ w: 60, r: 8, rir: 2, done: false })
    expect(out[0]).toBe(rows[0])
    expect(rows).toHaveLength(2)   // input untouched
  })

  it('keeps a warm-up a warm-up, so a ladder grows by copying', () => {
    const rows = [{ w: 40, r: 10, done: true, phase: 'warmup', warmup: true }, { w: 80, r: 5, done: false }]
    const out = copyRowAt(rows, 0)
    expect(out[1]).toEqual({ w: 40, r: 10, done: false, phase: 'warmup', warmup: true })
    expect(out[2]).toEqual({ w: 80, r: 5, done: false })
  })

  it('drops drop sets and bursts on the copy', () => {
    const rows = [{ w: 100, r: 6, done: true, type: 'dropset', drops: [{ w: 80, r: 5 }] }]
    expect(copyRowAt(rows, 0)[1]).toEqual({ w: 100, r: 6, done: false })
    const rp = [{ w: 50, r: 14, done: false, type: 'restpause', clusters: [{ r: 4, restSec: 15 }] }]
    expect(copyRowAt(rp, 0)[1]).toEqual({ w: 50, r: 14, done: false })
  })

  it('copies a timed hold with its time and a pyramid Max with its flag, but not the set-aside plan', () => {
    expect(copyRowAt([{ sec: 38, w: 0, done: true, planSec: 45 }], 0)[1]).toEqual({ sec: 38, w: 0, done: false })
    expect(copyRowAt([{ w: 60, r: 12, done: false, max: true }], 0)[1]).toEqual({ w: 60, r: 12, done: false, max: true })
  })

  it('copies a per-side set with both sides unticked and their own values', () => {
    let row = makeSideSet({ w: 16, r: 20 })
    row = setSideField(row, 'L', 'r', 11)
    row = setSideField(row, 'R', 'w', 18)
    row = toggleSide(row, 'L')
    row = { ...row, sides: { ...row.sides, L: { ...row.sides.L, type: 'dropset', drops: [{ w: 10, r: 6 }] } } }
    const out = copyRowAt([row], 0)
    const c = out[1]
    expect(isSideSet(c)).toBe(true)
    expect(c.sides.L).toEqual({ w: 16, r: 11, done: false })
    expect(c.sides.R).toEqual({ w: 18, r: 10, done: false })
    expect(c.done).toBe(false)
    expect(c.r).toBe(21)
    expect(c.w).toBe(18)
    expect(c.type).toBeUndefined()
  })

  it('copies a timed per-side hold as its L/R pair, after the pair', () => {
    const rows = [{ sec: 30, w: 0, side: 'L', done: true }, { sec: 30, w: 0, side: 'R', done: false }, { sec: 30, w: 0, side: 'L', done: false }, { sec: 30, w: 0, side: 'R', done: false }]
    for (const i of [0, 1]) {
      const out = copyRowAt(rows, i)
      expect(out.map(r => r.side)).toEqual(['L', 'R', 'L', 'R', 'L', 'R'])
      expect(out[2]).toEqual({ sec: 30, w: 0, side: 'L', done: false })
      expect(copySpanAt(rows, i)).toEqual({ start: 0, end: 1 })
    }
  })

  it('leaves the rows alone for an index that is not there', () => {
    const rows = [{ w: 1, r: 1, done: false }]
    expect(copyRowAt(rows, 4)).toEqual(rows)
  })
})

describe('insertRowAt (undo of a removed set)', () => {
  it('puts the exact row back where it was, tick and sub-rows included', () => {
    const rows = [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: true, type: 'dropset', drops: [{ w: 50, r: 6 }] }, { w: 60, r: 8, done: false }]
    const removed = rows[1]
    const after = removeRowAt(rows, 1)
    expect(after).toHaveLength(2)
    const back = insertRowAt(after, 1, removed)
    expect(back).toEqual(rows)
    expect(back[1]).toBe(removed)
  })

  it('lands it last when the entry lost rows in the meantime', () => {
    expect(insertRowAt([{ w: 1 }], 5, { w: 2 })).toEqual([{ w: 1 }, { w: 2 }])
    expect(insertRowAt([{ w: 1 }], undefined, { w: 2 })).toEqual([{ w: 1 }, { w: 2 }])
    expect(insertRowAt([{ w: 1 }], -3, { w: 2 })).toEqual([{ w: 2 }, { w: 1 }])
  })

  it('never lets removeRowAt take the last row', () => {
    const rows = [{ w: 1, r: 1, done: false }]
    expect(removeRowAt(rows, 0)).toEqual(rows)
  })
})
