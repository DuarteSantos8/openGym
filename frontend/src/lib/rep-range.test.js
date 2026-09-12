import { describe, expect, it } from 'vitest'
import { normalizeRepRange, normalizeSetRange, normalizeTriple } from './rep-range.js'

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

describe('normalizeSetRange', () => {
  it('keeps valid positive integer bounds unchanged', () => {
    expect(normalizeSetRange(5, 3)).toEqual({ setsMax: 5, setsMin: 3 })
  })

  it('allows an equal lower and upper bound — a fixed set count is a valid plan', () => {
    expect(normalizeSetRange(3, 3)).toEqual({ setsMax: 3, setsMin: 3 })
  })

  it('raises the lower bound to meet the upper bound instead of bumping the ceiling', () => {
    expect(normalizeSetRange(3, 5)).toEqual({ setsMax: 5, setsMin: 5 })
  })

  it('rounds bounds to positive integers', () => {
    expect(normalizeSetRange(5.4, 2.6)).toEqual({ setsMax: 5, setsMin: 3 })
    expect(normalizeSetRange(0, -2)).toEqual({ setsMax: 3, setsMin: 1 })
  })

  it('supplies a usable default lower bound for a small upper bound', () => {
    expect(normalizeSetRange(1, undefined)).toEqual({ setsMax: 1, setsMin: 1 })
  })
})

describe('normalizeTriple', () => {
  it('normalizes both ranges together', () => {
    expect(normalizeTriple({ setsMin: 3, setsMax: 5, repsMin: 8, reps: 12 })).toEqual({
      setsMin: 3, setsMax: 5, repsMin: 8, reps: 12, valid: true
    })
  })

  it('is invalid when any of the four limits is missing', () => {
    expect(normalizeTriple({ setsMin: 3, setsMax: 5, reps: 12 }).valid).toBe(false)
    expect(normalizeTriple({}).valid).toBe(false)
  })

  it('aligns the rep range to the per-side stride', () => {
    const t = normalizeTriple({ setsMin: 3, setsMax: 5, repsMin: 7, reps: 13, side: true })
    expect(t.reps).toBe(14)
    expect(t.repsMin).toBe(8)
  })
})
