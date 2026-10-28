import { describe, it, expect } from 'vitest'
import { forgottenDue, lastActivity, quietFor } from './forgotten-workout.js'
import { FORGOTTEN_GAP_MS } from './finish-workout.js'

const T0 = 1_800_000_000_000
const MIN = 60000
const A = (over = {}) => ({ start: T0, entries: [{ id: '0043', sets: [
  { w: 60, r: 8, done: true, at: T0 + 30 * MIN },
  { w: 60, r: 8, done: false, at: T0 + 90 * MIN },   // not ticked: not activity
] }], ...over })

describe('a forgotten workout', () => {
  it('is asked about 20 minutes after its last ticked set', () => {
    const last = T0 + 30 * MIN
    expect(lastActivity(A())).toBe(last)
    expect(forgottenDue(A(), last + FORGOTTEN_GAP_MS - 1)).toBe(false)
    expect(forgottenDue(A(), last + FORGOTTEN_GAP_MS)).toBe(true)
    expect(quietFor(A(), last + 25 * MIN)).toBe(25 * MIN)
  })
  it('counts from the start while nothing is ticked', () => {
    const empty = A({ entries: [{ id: '0043', sets: [{ w: 60, r: 8, done: false }] }] })
    expect(lastActivity(empty)).toBe(T0)
    expect(forgottenDue(empty, T0 + FORGOTTEN_GAP_MS)).toBe(true)
  })
  it('lets a cardio row ticked at its start run its length first', () => {
    const run = A({ entries: [{ id: 'run', sets: [{ min: 30, done: true, at: T0 }] }] })
    expect(lastActivity(run)).toBe(T0 + 30 * MIN)
    expect(forgottenDue(run, T0 + 45 * MIN)).toBe(false)
  })
  it('waits another 20 minutes once asked, for that workout only', () => {
    const asked = { start: T0, at: T0 + 50 * MIN }
    expect(forgottenDue(A(), T0 + 69 * MIN, asked)).toBe(false)
    expect(forgottenDue(A(), T0 + 70 * MIN, asked)).toBe(true)
    expect(forgottenDue(A({ start: T0 + 1 }), T0 + 60 * MIN, asked)).toBe(true)
  })
  it('never asks during a rest or hold, while editing a saved workout, or for a past one', () => {
    const late = T0 + 3 * 3600e3
    expect(forgottenDue(A(), late, null, true)).toBe(false)
    expect(forgottenDue(A({ editingWorkoutId: 'w1' }), late)).toBe(false)
    expect(forgottenDue(A({ backfill: {} }), late)).toBe(false)
    expect(forgottenDue(null, late)).toBe(false)
  })
})
