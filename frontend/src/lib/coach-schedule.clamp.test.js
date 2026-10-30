import { describe, it, expect } from 'vitest'
import { clampWorkoutCount } from './coach-schedule.js'

describe('clampWorkoutCount', () => {
  it('keeps whole numbers from 1 to 10 as typed', () => {
    expect(clampWorkoutCount('1', 4)).toBe(1)
    expect(clampWorkoutCount('7', 4)).toBe(7)
    expect(clampWorkoutCount('10', 4)).toBe(10)
  })
  it('holds values outside the range to the nearest end', () => {
    expect(clampWorkoutCount('0', 4)).toBe(1)
    expect(clampWorkoutCount('-3', 4)).toBe(1)
    expect(clampWorkoutCount('25', 4)).toBe(10)
  })
  it('rounds a decimal entry', () => {
    expect(clampWorkoutCount('3.6', 4)).toBe(4)
  })
  it('gives back the saved value for an empty or non-numeric entry', () => {
    expect(clampWorkoutCount('', 6)).toBe(6)
    expect(clampWorkoutCount('   ', 6)).toBe(6)
    expect(clampWorkoutCount('abc', 6)).toBe(6)
    expect(clampWorkoutCount(undefined, 6)).toBe(6)
  })
})
