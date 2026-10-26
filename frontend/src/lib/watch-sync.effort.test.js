// @vitest-environment happy-dom
// RPE / RIR from the Apple Watch: the phone says which scale the profile logs, the watch's set
// page offers it, and the rating rides along on the setDone event into the set.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyEvents, bindWatchActions, bindWatchAppActions, effortFrom, patchSetIn, watchExtras, _resetWatchSync } from './watch-sync.js'

beforeEach(() => { localStorage.clear(); _resetWatchSync() })
afterEach(() => _resetWatchSync())

describe('the scale the watch is told about', () => {
  it('only a profile that tracks effort gets the effort tile', () => {
    expect(watchExtras({ effort: 'rpe' }).effort).toBe('rpe')
    expect(watchExtras({ effort: 'rir' }).effort).toBe('rir')
    expect(watchExtras({ showRir: true }).effort).toBe('rir')
    expect('effort' in watchExtras({ effort: 'none' })).toBe(false)
    expect('effort' in watchExtras({})).toBe(false)
  })
})

describe('the rating on a watch event', () => {
  it('takes RPE or RIR on the half-point grid and drops what does not hold up', () => {
    expect(effortFrom({ rpe: 8.5 })).toEqual({ rpe: 8.5 })
    expect(effortFrom({ rir: 2 })).toEqual({ rir: 2 })
    expect(effortFrom({ rpe: 7.74 })).toEqual({ rpe: 7.5 })
    expect(effortFrom({ rir: 0 })).toEqual({ rir: 0 })
    expect(effortFrom({ rpe: 11 })).toEqual({})
    expect(effortFrom({ rir: -1 })).toEqual({})
    expect(effortFrom({ rpe: 'x' })).toEqual({})
    expect(effortFrom({})).toEqual({})
  })

  it('goes to the workout screen\'s tick with the numbers', () => {
    const setDone = vi.fn()
    bindWatchActions({ setDone, finish: vi.fn() })
    const S = { active: { id: 'w', entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: false }] }] } }
    applyEvents([{ id: 'e1', type: 'setDone', wid: 'w', exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8, at: 5, rpe: 9 }], () => ({ S }))
    expect(setDone).toHaveBeenCalledWith(0, 0, expect.objectContaining({ w: 60, r: 8, rpe: 9 }))
    applyEvents([{ id: 'e2', type: 'setDone', wid: 'w', exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8, at: 6 }], () => ({ S }))
    expect(setDone.mock.calls[1][2]).not.toHaveProperty('rpe')
  })

  it('lands in a workout already saved, and on a set rated on the phone only when it has none', () => {
    const patchSet = vi.fn()
    bindWatchAppActions({ start: vi.fn(), patchSet })
    const S = { active: null, workouts: [{ id: 'w-old', entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: false }] }] }] }
    applyEvents([{ id: 'late', type: 'setDone', wid: 'w-old', exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8, at: 900, rir: 1 }], () => ({ S }))
    expect(patchSet.mock.calls[0][1]).toMatchObject({ done: true, rir: 1 })

    const s = { active: null, workouts: [{ id: 'w', entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true, at: 2000 }, { w: 60, r: 8, done: true, at: 2000, rpe: 7 }] }] }] }
    // the phone's edit is later: its numbers stay, the watch's rating fills the empty set
    patchSetIn(s, { wid: 'w', exId: '0025', entryIdx: 0, setIdx: 0 }, { done: true, w: 50, r: 5, at: 1000, rpe: 9 }, vi.fn(), { ifNewer: 1000 })
    expect(s.workouts[0].entries[0].sets[0]).toEqual({ w: 60, r: 8, done: true, at: 2000, rpe: 9 })
    patchSetIn(s, { wid: 'w', exId: '0025', entryIdx: 0, setIdx: 1 }, { done: true, w: 50, r: 5, at: 1000, rpe: 9 }, vi.fn(), { ifNewer: 1000 })
    expect(s.workouts[0].entries[0].sets[1].rpe).toBe(7)
  })

  it('a per-side set keeps the rating on its side', () => {
    const s = { active: { id: 'w', entries: [{ id: '0025', sets: [{ w: 20, r: 8, done: false, sides: { L: { w: 20, r: 8, done: false }, R: { w: 20, r: 8, done: false } } }] }] } }
    patchSetIn(s, { wid: 'w', exId: '0025', entryIdx: 0, setIdx: 0, side: 'L' }, { done: true, w: 20, r: 8, rir: 2 }, vi.fn())
    expect(s.active.entries[0].sets[0].sides.L).toMatchObject({ done: true, rir: 2 })
    expect(s.active.entries[0].sets[0].sides.R.rir).toBeUndefined()
  })
})
