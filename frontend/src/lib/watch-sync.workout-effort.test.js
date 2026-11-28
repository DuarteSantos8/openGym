// @vitest-environment happy-dom
// The whole workout's effort from the Apple Watch's summary (lib/workout-effort.js): the phone tells
// the watch to ask, and the rating comes back as its own event onto the saved workout.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyEvents, bindWatchAppActions, watchExtras, watchAsksEffort, _resetWatchSync } from './watch-sync.js'

beforeEach(() => { localStorage.clear(); _resetWatchSync() })
afterEach(() => _resetWatchSync())

describe('whether the watch asks', () => {
  it('asks only when Settings asks', () => {
    expect(watchExtras({}).workoutEffort).toBe('ask')
    expect(watchExtras({ workoutEffort: 'ask' }).workoutEffort).toBe('ask')
    expect('workoutEffort' in watchExtras({ workoutEffort: 'auto' })).toBe(false)
    expect('workoutEffort' in watchExtras({ workoutEffort: 'never' })).toBe(false)
  })
})

describe('whether the phone leaves the question to the watch', () => {
  it('only for a workout the watch ran, and a watch that says it can rate', () => {
    // The watch ran w1 (a heart rate came with a tick), but has not said it can rate yet.
    applyEvents([{ id: 'hr', type: 'setHr', wid: 'w1', exId: '0025', entryIdx: 0, setIdx: 0, hr: { avg: 120, max: 140 } }], () => ({ S: { workouts: [] } }))
    expect(watchAsksEffort('w1')).toBe(false)
    applyEvents([{ id: 's1', type: 'watchStatus', health: 'on', version: '1', effort: true }], () => ({ S: {} }))
    expect(watchAsksEffort('w1')).toBe(true)
    expect(watchAsksEffort('other')).toBe(false)
    // An older watch app, or watchOS 10: no `effort` in its status.
    applyEvents([{ id: 's2', type: 'watchStatus', health: 'on', version: '1' }], () => ({ S: {} }))
    expect(watchAsksEffort('w1')).toBe(false)
  })
})

describe('the rating the watch sends', () => {
  it('goes onto the saved workout', () => {
    const workoutEffort = vi.fn()
    bindWatchAppActions({ workoutEffort })
    const S = { workouts: [{ id: 'w1', entries: [] }] }
    const done = applyEvents([{ id: 'e1', type: 'workoutEffort', wid: 'w1', v: 7 }], () => ({ S }))
    expect(workoutEffort).toHaveBeenCalledWith({ wid: 'w1', v: 7 })
    expect(done).toEqual(['e1'])
  })

  it('takes a rating back with null, and drops what does not hold up', () => {
    const workoutEffort = vi.fn()
    bindWatchAppActions({ workoutEffort })
    const S = { workouts: [] }
    applyEvents([
      { id: 'a', type: 'workoutEffort', wid: 'w1', v: null },
      { id: 'b', type: 'workoutEffort', wid: 'w1', v: 12 },
      { id: 'c', type: 'workoutEffort', wid: 'w1', v: 'hard' },
      { id: 'd', type: 'workoutEffort', v: 5 },
    ], () => ({ S }))
    expect(workoutEffort).toHaveBeenCalledTimes(1)
    expect(workoutEffort).toHaveBeenCalledWith({ wid: 'w1', v: null })
  })

  it('waits for the app when it is not bound yet, and is applied once', () => {
    const S = { workouts: [{ id: 'w1', entries: [] }] }
    const ev = { id: 'e1', type: 'workoutEffort', wid: 'w1', v: 4 }
    expect(applyEvents([ev], () => ({ S }))).toEqual([])
    const workoutEffort = vi.fn()
    bindWatchAppActions({ workoutEffort })
    expect(applyEvents([ev], () => ({ S }))).toEqual(['e1'])
    applyEvents([ev], () => ({ S }))
    expect(workoutEffort).toHaveBeenCalledTimes(1)
  })

  it('waits while its workout is not saved here: behind another workout on the phone', () => {
    const workoutEffort = vi.fn()
    bindWatchAppActions({ workoutEffort, start: vi.fn() })
    const now = Date.parse('2026-11-23T12:00:00Z')
    // A workout runs on the phone; the watch's own workout (start, finish, rating) waits behind it.
    const running = { S: { active: { id: 'p1', entries: [] }, workouts: [] } }
    const queue = [
      { id: 's', type: 'start', wid: 'watch-1', routineIds: [], at: now - 60e3 },
      { id: 'f', type: 'finish', wid: 'watch-1', at: now - 30e3 },
      { id: 'e', type: 'workoutEffort', wid: 'watch-1', v: 6, at: now - 20e3 },
    ]
    expect(applyEvents(queue, () => running, now)).not.toContain('e')
    expect(workoutEffort).not.toHaveBeenCalled()
    // Saved at last: the rating goes onto it.
    const saved = { S: { workouts: [{ id: 'watch-1', entries: [] }] } }
    expect(applyEvents([queue[2]], () => saved, now)).toEqual(['e'])
    expect(workoutEffort).toHaveBeenCalledWith({ wid: 'watch-1', v: 6 })
  })

  it('lets a rating go for a workout that never comes, after two days', () => {
    const workoutEffort = vi.fn()
    bindWatchAppActions({ workoutEffort })
    const now = Date.parse('2026-11-23T12:00:00Z')
    const old = { id: 'o', type: 'workoutEffort', wid: 'watch-2', v: 5, at: now - 49 * 3600e3 }
    expect(applyEvents([old], () => ({ S: { workouts: [] } }), now)).toEqual(['o'])
  })
})
