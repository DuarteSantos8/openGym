// #976: a paused workout's clock stands still, the pause is not counted in its length, it
// survives a reload (it lives in S.active), and finishing while paused ends it at the pause.
import { describe, expect, it } from 'vitest'
import { isPaused, canPause, pauseWorkout, resumeWorkout, elapsedMs, stopAt, pauseSpans, pausedBetween } from './workout-pause.js'
import { buildCompletedWorkout, sessionEnd } from './finish-workout.js'

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
  it('keeps each pause for the session end, so a long pause between sets is no forgotten workout (#1021)', () => {
    const MIN = 60_000
    const T0 = 1_000_000_000_000
    const A = { ...live(), start: T0, entries: [{ id: 'x', sets: [0, 5].map(m => ({ done: true, w: 50, r: 8, at: T0 + m * MIN })) }] }
    pauseWorkout(A, T0 + 10 * MIN)
    expect(pauseSpans(A, T0 + 30 * MIN)).toEqual([{ from: T0 + 10 * MIN, to: T0 + 30 * MIN }])
    resumeWorkout(A, T0 + 50 * MIN)
    expect(A.pauses).toEqual([{ from: T0 + 10 * MIN, to: T0 + 50 * MIN }])
    expect(pausedBetween(A.pauses, T0, T0 + 60 * MIN)).toBe(40 * MIN)
    A.entries[0].sets.push({ done: true, w: 50, r: 8, at: T0 + 55 * MIN })
    const end = sessionEnd(A, T0 + 60 * MIN)
    expect(end).toBe(T0 + 60 * MIN)
    const w = buildCompletedWorkout(A, { end })
    expect((w.end - w.start) / MIN).toBe(20)   // 60 on the clock, 40 of it paused
    expect(w.pauses).toBeUndefined()           // live bookkeeping, not part of the saved workout
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
