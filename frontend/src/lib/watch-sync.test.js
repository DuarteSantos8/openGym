import { beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetWatchSync, bindWatchDone, handleWatchAction, PENDING_MS, snapshotFor } from './watch-sync.js'

// The iPhone app's side of the Apple Watch app: what an action from the watch does, and the set
// done that waits for the workout screen. The plugin itself is native and is not played here.
const bench = { id: '0025', target: { mode: 'reps' }, sets: [{ w: 60, r: 8 }, { w: 60, r: 8 }] }
const S = { unit: 'kg', active: { name: 'Push', cur: 0, entries: [bench] } }
const store = { getState: () => ({ S }) }
const ui = () => {
  const U = { stopRest: vi.fn(), addRest: vi.fn(), pauseRest: vi.fn(), resumeRest: vi.fn() }
  return { U, ui: { getState: () => U } }
}
const done = { type: 'done', entryIdx: 0, setIdx: 0, reps: 10, weight: 62.5 }

beforeEach(() => { _resetWatchSync(); vi.useRealTimers() })

describe('an action from the watch', () => {
  it('skips, lengthens, holds and carries on the rest through the UI store', () => {
    const { U, ui: u } = ui()
    handleWatchAction({ type: 'skipRest' }, store, u)
    handleWatchAction({ type: 'addRest', sec: 15 }, store, u)
    handleWatchAction({ type: 'pauseRest' }, store, u)
    handleWatchAction({ type: 'resumeRest' }, store, u)
    expect(U.stopRest).toHaveBeenCalledTimes(1)
    expect(U.addRest).toHaveBeenCalledWith(15)
    expect(U.pauseRest).toHaveBeenCalledTimes(1)
    expect(U.resumeRest).toHaveBeenCalledTimes(1)
  })
  it('hands a set done to the workout screen', () => {
    const tick = vi.fn()
    bindWatchDone(tick)
    expect(handleWatchAction(done, store, ui().ui)).toBe(true)
    expect(tick).toHaveBeenCalledWith(done)
  })
  it('keeps the latest one for a workout screen that opens later', () => {
    handleWatchAction(done, store, ui().ui)
    const tick = vi.fn()
    bindWatchDone(tick)
    expect(tick).toHaveBeenCalledWith(done)
  })
  it('drops one that waited too long', () => {
    vi.useFakeTimers()
    handleWatchAction(done, store, ui().ui)
    vi.advanceTimersByTime(PENDING_MS + 1)
    const tick = vi.fn()
    bindWatchDone(tick)
    expect(tick).not.toHaveBeenCalled()
  })
  it('ignores one for a set that is not the next', () => {
    const tick = vi.fn()
    bindWatchDone(tick)
    expect(handleWatchAction({ ...done, setIdx: 1 }, store, ui().ui)).toBe(false)
    expect(tick).not.toHaveBeenCalled()
  })
  it('unbinds only its own screen', () => {
    const a = vi.fn(), b = vi.fn()
    const offA = bindWatchDone(a)
    bindWatchDone(b)
    offA()
    handleWatchAction(done, store, ui().ui)
    expect(b).toHaveBeenCalled()
  })
})

describe('the snapshot sent', () => {
  it('carries the set label and the words the watch prints', () => {
    const snap = snapshotFor(S, null)
    expect(snap.set.label).toBe('Set 1 / 2')
    expect(snap.labels).toMatchObject({ done: 'Done', weight: 'Weight (kg)', onPhone: 'Log this set on your iPhone' })
  })
})
