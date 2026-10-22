import { describe, expect, it } from 'vitest'
import { HR_HOLD_SEC, hrReadyOf, lastWorkoutTarget, readiness, suggestedTarget } from './hr-readiness.js'

// Ready for the next set once the heart rate is back down: never before the floor, only on a
// fresh reading, and only when nothing in the last few seconds was above the target.
const T0 = 1_790_000_000_000
const at = sec => T0 + sec * 1000
const run = (pairs, over = {}) => readiness({ samples: pairs.map(([s, bpm]) => ({ t: at(s), bpm })), restStartedAt: T0, now: at(60), targetBpm: 110, floorSec: 45, holdSec: HR_HOLD_SEC, ...over })

describe('readiness', () => {
  it('is ready once the last readings are all under the target, since the first of them', () => {
    expect(run([[40, 130], [50, 115], [54, 108], [57, 104], [59, 101]])).toEqual({ ready: true, since: at(54) })
  })
  it('waits for the floor, however low the heart rate', () => {
    expect(run([[10, 90], [20, 90], [30, 90]], { now: at(30) })).toEqual({ ready: false, since: null })
    expect(run([[10, 90], [44, 90]], { now: at(45) })).toEqual({ ready: true, since: at(10) })
  })
  it('is not ready while a reading in the hold window is over the target', () => {
    expect(run([[50, 100], [56, 112], [59, 100]]).ready).toBe(false)
    expect(run([[50, 100], [54, 112], [55, 100], [59, 100]]).ready).toBe(true)
  })
  it('wants the readings under the target for the whole hold, not one dip', () => {
    expect(run([[50, 120], [59, 100]]).ready).toBe(false)
    expect(run([[50, 120], [55, 100], [59, 100]])).toEqual({ ready: true, since: at(55) })
  })
  it('counts a reading at the target as under it', () => {
    expect(run([[53, 110], [58, 110]]).ready).toBe(true)
    expect(run([[53, 110], [58, 110]], { targetBpm: 109 }).ready).toBe(false)
  })
  it('wants a reading at most 10 s old', () => {
    expect(run([[45, 90], [49, 90]], { holdSec: 15 }).ready).toBe(false)
    expect(run([[45, 90], [50, 90]], { holdSec: 15 }).ready).toBe(true)
  })
  it('wants the run under the target to be at least the hold long', () => {
    expect(run([[57, 90]], { holdSec: 5 }).ready).toBe(false)
    expect(run([[52, 90], [57, 90]], { holdSec: 5 }).ready).toBe(true)
    expect(run([[52, 90], [57, 90]], { holdSec: 10 }).ready).toBe(false)
  })
  it('is not ready without readings, and ignores ones from before the rest or not numbers', () => {
    expect(run([])).toEqual({ ready: false, since: null })
    expect(readiness({ samples: [{ t: at(-5), bpm: 90 }, { t: at(58), bpm: NaN }], restStartedAt: T0, now: at(60) }).ready).toBe(false)
    expect(readiness({ restStartedAt: T0, now: at(60) }).ready).toBe(false)
  })
  it('defaults to 110 bpm, 45 s and a 5 s hold, and takes the readings in any order', () => {
    expect(readiness({ samples: [{ t: at(59), bpm: 100 }, { t: at(55), bpm: 105 }], restStartedAt: T0, now: at(60) })).toEqual({ ready: true, since: at(55) })
    expect(readiness({ samples: [{ t: at(44), bpm: 100 }], restStartedAt: T0, now: at(44) }).ready).toBe(false)
    expect(readiness({ samples: [{ t: at(59), bpm: 111 }], restStartedAt: T0, now: at(60) }).ready).toBe(false)
  })
})

describe('suggestedTarget', () => {
  it('puts the target a third of the way from the lowest to the average', () => {
    expect(suggestedTarget({ avg: 130, min: 80 })).toBe(98)
    expect(suggestedTarget({ avg: 120, min: 90, max: 170 })).toBe(101)
  })
  it('stays between 80 and 150', () => {
    expect(suggestedTarget({ avg: 80, min: 60 })).toBe(80)
    expect(suggestedTarget({ avg: 200, min: 160 })).toBe(150)
  })
  it('is null without a usable summary', () => {
    expect(suggestedTarget(null)).toBeNull()
    expect(suggestedTarget({ avg: 120 })).toBeNull()
    expect(suggestedTarget({ avg: 'x', min: 80 })).toBeNull()
  })
})

describe('hrReadyOf', () => {
  it('is off at 110 bpm and 45 s for a profile that never set it', () => {
    expect(hrReadyOf({})).toEqual({ on: false, bpm: 110, floorSec: 45 })
    expect(hrReadyOf(null)).toEqual({ on: false, bpm: 110, floorSec: 45 })
    expect(hrReadyOf({ hrReady: 'yes' })).toEqual({ on: false, bpm: 110, floorSec: 45 })
  })
  it('keeps what was set, inside the ranges the steppers allow', () => {
    expect(hrReadyOf({ hrReady: { on: true, bpm: 120, floorSec: 60 } })).toEqual({ on: true, bpm: 120, floorSec: 60 })
    expect(hrReadyOf({ hrReady: { on: true, bpm: 400, floorSec: 1 } })).toEqual({ on: true, bpm: 180, floorSec: 15 })
    expect(hrReadyOf({ hrReady: { on: 1, bpm: null, floorSec: 'x' } })).toEqual({ on: false, bpm: 110, floorSec: 45 })
  })
})

describe('lastWorkoutTarget', () => {
  it('takes the latest workout that has a heart rate', () => {
    const workouts = [
      { id: 'a', d: '2026-10-01', start: 1, hr: { avg: 130, min: 80 } },
      { id: 'b', d: '2026-10-03', start: 3, hr: { avg: 120, min: 90 } },
      { id: 'c', d: '2026-10-04', start: 4 },
      { id: 'd', d: '2026-10-02', start: 2, hr: { avg: 150, min: 100 } },
    ]
    expect(lastWorkoutTarget(workouts)).toBe(101)
  })
  it('is null when none has one', () => {
    expect(lastWorkoutTarget([{ id: 'a', d: '2026-10-01' }])).toBeNull()
    expect(lastWorkoutTarget(undefined)).toBeNull()
  })
})
