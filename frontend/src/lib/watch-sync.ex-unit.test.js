// @vitest-environment happy-dom
// An exercise in a weight unit of its own (#657) on the Apple Watch and the Lock Screen: sent in
// that unit with the unit named, and what the watch logs is stored in the profile's.
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSnapshot, patchSetIn, _resetWatchSync } from './watch-sync.js'
import { buildLiveActivity } from './live-activity.js'
import { withExUnit } from './ex-unit.js'

const BENCH = '0025'   // barbell bench press
const SQUAT = '0043'   // barbell squat

const state = () => ({
  unit: 'kg', restSec: 90, routines: [], exUnit: withExUnit({}, BENCH, 'lb', 1),
  workouts: [{ id: 'old', d: '2026-10-01', start: 1, entries: [{ id: BENCH, target: { sets: 1, reps: 5 }, sets: [{ w: 61.235, r: 5, done: true }] }] }],
  active: {
    id: 'w-1', name: 'Push day', cur: 0, d: '2026-10-13', start: 2,
    entries: [
      { id: BENCH, target: { sets: 2, reps: 5, weight: 63.5029, mode: 'reps' }, sets: [{ w: 63.5029, r: 5, done: false }, { w: 63.5029, r: 5, done: false }] },
      { id: SQUAT, target: { sets: 1, reps: 5, weight: 100, mode: 'reps' }, sets: [{ w: 100, r: 5, done: false }] },
    ],
  },
})

beforeEach(() => { localStorage.clear(); _resetWatchSync() })

describe('the watch', () => {
  it('gets a pinned exercise in its unit, the unit named, and the rest as before', () => {
    const snap = buildSnapshot(state())
    const [bench, squat] = snap.active.entries
    expect(snap.active.unit).toBe('kg')
    expect(bench.unit).toBe('lb')
    expect(bench.sets.map(s => s.w)).toEqual([140, 140])
    expect(bench.step).toBe(5)
    expect(bench.last).toBe('135×5')
    expect(bench.best.w).toBe(135)
    expect('unit' in squat).toBe(false)
    expect(squat.sets[0].w).toBe(100)
    expect(squat.step).toBe(5)   // a heavy lift's kg default
  })

  it('a weight the watch logged in lb is stored as the exact kg, and an unchanged one as it was', () => {
    const s = state()
    s.workouts.push({ ...s.active, id: 'w-2', active: undefined })
    patchSetIn(s, { wid: 'w-2', exId: BENCH, entryIdx: 0, setIdx: 0 }, { w: 145, r: 5, done: true }, () => {})
    expect(s.workouts[1].entries[0].sets[0].w).toBe(65.7709)
    patchSetIn(s, { wid: 'w-2', exId: BENCH, entryIdx: 0, setIdx: 1 }, { w: 140, r: 4, done: true }, () => {})
    expect(s.workouts[1].entries[0].sets[1].w).toBe(63.5029)
    patchSetIn(s, { wid: 'w-2', exId: SQUAT, entryIdx: 1, setIdx: 0 }, { w: 102.5, r: 5, done: true }, () => {})
    expect(s.workouts[1].entries[1].sets[0].w).toBe(102.5)
  })
})

describe('the Lock Screen', () => {
  it('names the set in the exercise’s unit', () => {
    const live = buildLiveActivity(state())
    expect(live.state.cur.target).toBe('140×5 (lb)')
    expect(live.state.unitStarts[0].target).toBe('100×5')
  })
})
