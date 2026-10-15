import { describe, expect, it } from 'vitest'
import { hasUnfinishedSide, sideRestSecFor } from './side-rest.js'

describe('between-side rest', () => {
  it('preserves legacy defaults but lets an explicit timer be independent of normal rest', () => {
    expect(sideRestSecFor({ side: true, mode: 'reps' }, 90)).toBe(0)
    expect(sideRestSecFor({ side: true, mode: 'time' }, 90)).toBe(10)
    expect(sideRestSecFor({ side: true, mode: 'time' }, 5)).toBe(5)
    expect(sideRestSecFor({ side: true, mode: 'time' }, 0)).toBe(0)
    for (const mode of ['reps', 'time']) {
      expect(sideRestSecFor({ side: true, mode, sideRestSec: 0 }, 90)).toBe(0)
      expect(sideRestSecFor({ side: true, mode, sideRestSec: 45 }, 0)).toBe(45)
      expect(sideRestSecFor({ side: true, mode, sideRestSec: 10000 })).toBe(900)
    }
    expect(sideRestSecFor({ side: false, sideRestSec: 45 })).toBe(0)
    expect(sideRestSecFor({ side: true, mode: 'cardio', sideRestSec: 45 })).toBe(0)
    expect(sideRestSecFor({ side: true, sideRestSec: NaN })).toBe(0)
  })

  it.each(['L', 'R'])('recognises the first %s side in rep and timed pairs, never an undo or completed pair', side => {
    const other = side === 'L' ? 'R' : 'L'
    const row = { sides: { [side]: { done: true }, [other]: { done: false } } }
    const entry = { target: { mode: 'reps', side: true }, sets: [row] }
    expect(hasUnfinishedSide(entry, 0, side)).toBe(true)
    expect(hasUnfinishedSide(entry, 0, other)).toBe(false)
    row.sides[other].done = true
    expect(hasUnfinishedSide(entry, 0, side)).toBe(false)
    const timed = { target: { mode: 'time', side: true }, sets: ['L', 'R'].map(s => ({ side: s, done: s === side })) }
    const i = side === 'L' ? 0 : 1
    expect(hasUnfinishedSide(timed, i)).toBe(true)
    timed.sets[1 - i].done = true
    expect(hasUnfinishedSide(timed, i)).toBe(false)
  })
})
