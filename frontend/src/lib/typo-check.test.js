import { describe, expect, it } from 'vitest'
import { bestsFor, lastRowFor, oddValues } from './typo-check.js'
import { makeSideSet } from './workout-model.js'

const W = (id, sets) => ({ entries: [{ id, sets }] })

describe('typo check', () => {
  it('reads the best weight and reps over every set, both sides of a per-side set too', () => {
    const workouts = [
      W('a', [{ w: 30, r: 8, done: true }, { w: 25, r: 12, done: true }]),
      W('b', [{ w: 200, r: 50, done: true }]),
      W('a', [makeSideSet({ w: 32, r: 20 })]),
    ]
    expect(bestsFor(workouts, 'a')).toEqual({ w: 32, r: 12 })
    expect(bestsFor([], 'a')).toEqual({ w: 0, r: 0 })
  })

  it('pairs a set with the same work set or warm-up last time', () => {
    const last = [{ w: 20, r: 10, warmup: true, phase: 'warmup' }, { w: 60, r: 8 }, { w: 60, r: 7 }]
    const now = [{ w: 20, r: 10, warmup: true, phase: 'warmup' }, { w: 60, r: 8 }, { w: 6, r: 7 }, { w: 60, r: 6 }]
    expect(lastRowFor(last, now, 2, null)).toEqual({ w: 60, r: 7 })
    expect(lastRowFor(last, now, 0, null)).toMatchObject({ w: 20 })
    expect(lastRowFor(last, now, 3, null)).toBeNull()
    expect(lastRowFor(last, now, 1, 'L')).toBeNull()
    const sides = [makeSideSet({ w: 20, r: 20 })]
    expect(lastRowFor(sides, sides, 0, 'R')).toMatchObject({ w: 20, r: 10 })
  })

  it('flags a weight or rep count over twice the best', () => {
    const best = { w: 30, r: 12 }
    expect(oddValues({ w: 300, r: 8 }, best)).toEqual([{ f: 'w', typed: 300, ref: 30 }])
    expect(oddValues({ w: 30, r: 120 }, best)).toEqual([{ f: 'r', typed: 120, ref: 12 }])
    expect(oddValues({ w: 60, r: 24 }, best)).toEqual([])
    // Over twice but by less than the gap: a light lift growing, not a typo.
    expect(oddValues({ w: 10, r: 8 }, { w: 4, r: 8 })).toEqual([])
    expect(oddValues({ w: 30, r: 8 }, { w: 14, r: 8 }, { unit: 'lb' })).toEqual([])
    expect(oddValues({ w: 30, r: 8 }, { w: 14, r: 8 })).toHaveLength(1)
  })

  it('flags a weight or rep count under a third of last time’s same set', () => {
    const best = { w: 100, r: 10 }
    expect(oddValues({ w: 6, r: 8 }, best, { last: { w: 60, r: 8 } })).toEqual([{ f: 'w', typed: 6, ref: 60, low: true }])
    expect(oddValues({ w: 60, r: 1 }, best, { last: { w: 60, r: 10 } })).toEqual([{ f: 'r', typed: 1, ref: 10, low: true }])
    expect(oddValues({ w: 25, r: 4 }, best, { last: { w: 60, r: 8 } })).toEqual([])
    // A third of a small number is a small gap: 1 rep after 3 is a hard set, not a typo.
    expect(oddValues({ w: 60, r: 1 }, best, { last: { w: 60, r: 3 } })).toEqual([])
  })

  it('leaves an assisted exercise’s weight and a first time alone', () => {
    expect(oddValues({ w: 90, r: 8 }, { w: 30, r: 8 }, { assisted: true })).toEqual([])
    expect(oddValues({ w: 1, r: 8 }, { w: 30, r: 8 }, { assisted: true, last: { w: 30, r: 8 } })).toEqual([])
    expect(oddValues({ w: 500, r: 500 }, { w: 0, r: 0 })).toEqual([])
  })
})
