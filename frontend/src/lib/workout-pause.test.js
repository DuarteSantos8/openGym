// #976: a paused workout's clock stands still, the pause is not counted in its length, it
// survives a reload (it lives in S.active), and finishing while paused ends it at the pause.
import { describe, expect, it } from 'vitest'
import { isPaused, canPause, pauseWorkout, resumeWorkout, elapsedMs, stopAt } from './workout-pause.js'
import { buildCompletedWorkout } from './finish-workout.js'

const live = () => ({ id: 'a', d: '2026-11-03', start: 1_000_000, cur: 0, entries: [] })

describe('pausing a workout (#976)', () => {
  it('stands the clock still, and resuming moves the start on by the pause', () => {
    const A = live()
    pauseWorkout(A, 1_600_000)
    expect(isPaused(A)).toBe(true)
    expect(elapsedMs(A, 9_999_999)).toBe(600_000)
    pauseWorkout(A, 2_000_000)                    // pausing twice keeps the first pause
    expect(A.pausedAt).toBe(1_600_000)
    resumeWorkout(A, 1_900_000)
    expect(isPaused(A)).toBe(false)
    expect(A.start).toBe(1_300_000)
    expect(A.pausedMs).toBe(300_000)
    expect(elapsedMs(A, 2_000_000)).toBe(700_000)
    expect(JSON.parse(JSON.stringify(A))).toEqual(A)   // a reload reads the same thing back
  })
  it('only pauses a live workout', () => {
    expect(canPause({ ...live(), backfill: { durationMin: 60 } })).toBe(false)
    expect(canPause({ ...live(), editingWorkoutId: 'w1' })).toBe(false)
    const B = { ...live(), backfill: { durationMin: 60 } }
    pauseWorkout(B, 2_000_000)
    expect(isPaused(B)).toBe(false)
  })
  it('a workout finished while paused ends at the pause', () => {
    const A = pauseWorkout(live(), 1_600_000)
    expect(stopAt(A, 5_000_000)).toBe(1_600_000)
    expect(stopAt(live(), 5_000_000)).toBe(5_000_000)
    const w = buildCompletedWorkout(A, { end: 5_000_000 })
    expect(w.end).toBe(1_600_000)
    expect(w.start).toBe(1_000_000)
  })
})
