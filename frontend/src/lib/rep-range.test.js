import { describe, expect, it } from 'vitest'
import { normalizeRepRange } from './rep-range.js'

describe('normalizeRepRange', () => {
  it('keeps valid positive integer bounds unchanged', () => {
    expect(normalizeRepRange(12, 8)).toEqual({ reps: 12, repsMin: 8 })
  })

  it('rounds bounds to positive integers', () => {
    expect(normalizeRepRange(12.4, 7.6)).toEqual({ reps: 12, repsMin: 8 })
    expect(normalizeRepRange(0, -2)).toEqual({ reps: 10, repsMin: 8 })
  })

  it('raises the upper bound when the lower bound reaches it', () => {
    expect(normalizeRepRange(8, 8)).toEqual({ reps: 9, repsMin: 8 })
  })

  it('raises the upper bound when the lower bound exceeds it', () => {
    expect(normalizeRepRange(8, 12)).toEqual({ reps: 13, repsMin: 12 })
  })

  it('keeps the lower bound at least one below a lowered upper bound', () => {
    expect(normalizeRepRange(6, 8)).toEqual({ reps: 9, repsMin: 8 })
  })

  it('supplies a usable default lower bound for a small upper bound', () => {
    expect(normalizeRepRange(1, undefined)).toEqual({ reps: 2, repsMin: 1 })
  })

  it('aligns both bounds to an even stride', () => {
    expect(normalizeRepRange(13, 7, 2)).toEqual({ reps: 14, repsMin: 8 })
  })

  it('keeps a valid gap when per-side bounds are invalid', () => {
    expect(normalizeRepRange(8, 9, 2)).toEqual({ reps: 12, repsMin: 10 })
    expect(normalizeRepRange(0, -2, 2)).toEqual({ reps: 10, repsMin: 8 })
  })
})
