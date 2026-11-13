import { describe, expect, it } from 'vitest'
import { sessionEnd, FORGOTTEN_GAP_MS } from './session-end.js'
import { makeSideSet, setSideField, toggleSide } from './workout-model.js'

describe('sessionEnd: a workout finished long after its last set', () => {
  const MIN = 60 * 1000
  const T0 = 1_000_000_000_000
  const at = (...mins) => ({ entries: [{ id: 'x', sets: mins.map(m => ({ done: true, w: 50, r: 8, at: T0 + m * MIN })) }] })

  it('keeps the Finish tap when it comes right after the last set', () => {
    expect(sessionEnd(at(0, 15, 30, 45), T0 + 50 * MIN)).toBe(T0 + 50 * MIN)
  })

  it('ends at the last set when Finish is tapped the next day', () => {
    expect(sessionEnd(at(0, 15, 30, 45), T0 + 30 * 60 * MIN)).toBe(T0 + 45 * MIN)
  })

  it('does not let a set ticked after a long break stretch the session', () => {
    // 45 minutes of work, then one leftover set ticked the next morning just before Finish.
    expect(sessionEnd(at(0, 15, 30, 45, 24 * 60), T0 + 24 * 60 * MIN + 1)).toBe(T0 + 45 * MIN)
  })

  it('ignores unticked sets and sets from builds that did not stamp them', () => {
    const active = { entries: [{ id: 'x', sets: [
      { done: true, w: 50, r: 8, at: T0 },
      { done: false, w: 50, r: 8, at: T0 + 30 * MIN },
      { done: true, w: 50, r: 8 },
    ] }] }
    expect(sessionEnd(active, T0 + 5 * 60 * MIN)).toBe(T0)
    expect(sessionEnd({ entries: [{ id: 'x', sets: [{ done: true, w: 50, r: 8 }] }] }, 42)).toBe(42)
  })

  it('does not cut a long cardio finisher or hold off as a forgotten break', () => {
    // Bench 0 to 40 min, a 30-minute treadmill row ticked at 72, Finish at 73.
    const active = { entries: [
      { id: 'x', sets: [0, 20, 40].map(m => ({ done: true, w: 50, r: 8, at: T0 + m * MIN })) },
      { id: 'run', sets: [{ done: true, min: 30, speed: 10, at: T0 + 72 * MIN }] },
    ] }
    expect(sessionEnd(active, T0 + 73 * MIN)).toBe(T0 + 73 * MIN)
    // Its own length is all it is credited: the same row ticked the next morning still is a break.
    active.entries[1].sets[0].at = T0 + 24 * 60 * MIN
    expect(sessionEnd(active, T0 + 24 * 60 * MIN + 1)).toBe(T0 + 40 * MIN)
    // A long per-side hold counts both sides.
    const hold = { entries: [
      { id: 'x', sets: [{ done: true, w: 50, r: 8, at: T0 }] },
      { id: 'plank', sets: [{ done: true, at: T0 + 30 * MIN, sides: { L: { sec: 330, done: true }, R: { sec: 330, done: true } } }] },
    ] }
    expect(sessionEnd(hold, T0 + 31 * MIN)).toBe(T0 + 31 * MIN)
  })

  it('does not cut a cardio row ticked when it started and finished more than the gap later', () => {
    // Bench 0 and 20, a 30-minute run ticked at 25 when it began, Finish at 56 after it.
    const active = { entries: [
      { id: 'x', sets: [0, 20].map(m => ({ done: true, w: 50, r: 8, at: T0 + m * MIN })) },
      { id: 'run', sets: [{ done: true, min: 30, speed: 10, at: T0 + 25 * MIN }] },
    ] }
    expect(sessionEnd(active, T0 + 56 * MIN)).toBe(T0 + 56 * MIN)
    // The same session left open overnight ends where the run could have, not at its tick.
    expect(sessionEnd(active, T0 + 24 * 60 * MIN)).toBe(T0 + 55 * MIN)
    // A hold started and ticked before a 25-minute stretch is the same.
    const hold = { entries: [{ id: 'plank', sets: [{ done: true, sec: 300, at: T0 }] }] }
    expect(sessionEnd(hold, T0 + 25 * MIN)).toBe(T0 + 25 * MIN)
  })

  it('counts a per-side set once one side is done', () => {
    const active = { entries: [{ id: 'x', sets: [{
      w: 20, r: 8, done: false, at: T0,
      sides: { L: { w: 20, r: 8, done: true }, R: { w: 20, r: 8, done: false } },
    }] }] }
    expect(sessionEnd(active, T0 + FORGOTTEN_GAP_MS + 1)).toBe(T0)
  })
})
