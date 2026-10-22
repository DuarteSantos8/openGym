// @vitest-environment happy-dom

/* A set logged on the Apple Watch (Completed): it goes through the workout screen's own set-done
   flow, and the watch is always sent the set that is current on the phone. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ watch: null, sent: [], ok: true, ui: null }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => h.ui } }))
vi.mock('../lib/watch-link.js', () => ({
  initWatchLink: opts => { h.watch = opts },
  watchSet: async p => { h.sent.push(p); return h.ok },
}))

import { DEF, useStore, followWatchSet } from './useStore.js'

const clone = v => JSON.parse(JSON.stringify(v))
const SQUAT = '3593'
const BENCH = '0289'
const row = (over = {}) => ({ w: 100, r: 5, done: false, ...over })
const ex = (id, sets, over = {}) => ({ id, target: { sets: sets.length, reps: 5 }, sets, ...over })
const active = (entries, over = {}) => ({ id: 'w1', name: 'Legs', start: 1, cur: 0, entries, ...over })
const ev = (over = {}) => ({ type: 'set', action: 'done', id: 'w1', entryId: SQUAT, idx: 0, i: 0, w: 105, r: 6, at: 1234, ...over })
const A = () => useStore.getState().S.active
const flush = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
  localStorage.clear()
  h.sent = []; h.ok = true
  h.ui = { timer: null, toast: vi.fn(), startRest: vi.fn(), stopRest: vi.fn() }
  useStore.setState({ user: null, ready: true, S: { ...clone(DEF), restSec: 90, active: active([ex(SQUAT, [row(), row()]), ex(BENCH, [row()])]) } })
})
afterEach(() => { localStorage.clear(); vi.useRealTimers() })

describe('logWatchSet', () => {
  it('is what the watch link hands a Completed to', async () => {
    h.watch.onSetDone(ev())
    await flush(); await flush()
    expect(A().entries[0].sets[0]).toMatchObject({ done: true, w: 105, r: 6, at: 1234 })
  })

  it('logs the load, reps and time, rests, and says so', async () => {
    expect(await useStore.getState().logWatchSet(ev())).toBe(true)
    expect(A().entries[0].sets[0]).toMatchObject({ done: true, w: 105, r: 6, at: 1234 })
    expect(A().entries[0].sets[1].done).toBe(false)
    expect(h.ui.startRest).toHaveBeenCalledWith(90, 0, { forSet: 0 })
    expect(h.ui.toast).toHaveBeenCalledWith('Set logged from your watch')
  })

  it('keeps the planned numbers when the watch sends none, and takes a bodyweight 0', async () => {
    await useStore.getState().logWatchSet(ev({ w: undefined, r: undefined }))
    expect(A().entries[0].sets[0]).toMatchObject({ w: 100, r: 5 })
    await useStore.getState().logWatchSet(ev({ i: 1, w: 0, r: -3 }))
    expect(A().entries[0].sets[1]).toMatchObject({ done: true, w: 0, r: 5 })
  })

  it('records the top weight and stops the rest when the exercise is done', async () => {
    await useStore.getState().logWatchSet(ev({ w: 100 }))
    await useStore.getState().logWatchSet(ev({ i: 1, w: 110 }))
    expect(A().entries[0].topW).toBe(110)
    expect(h.ui.stopRest).toHaveBeenCalled()
  })

  it('ignores another workout, a set already done, and a set that moved, and re-sends the current set', async () => {
    const before = useStore.getState().S
    expect(await useStore.getState().logWatchSet(ev({ id: 'other' }))).toBe(false)
    expect(h.sent).toEqual([])
    expect(await useStore.getState().logWatchSet(ev({ entryId: BENCH }))).toBe(false)
    expect(await useStore.getState().logWatchSet(ev({ idx: 5 }))).toBe(false)
    expect(useStore.getState().S).toBe(before)
    await flush()
    expect(h.sent).toHaveLength(2)
    expect(h.sent[0]).toMatchObject({ entryId: SQUAT, idx: 0, i: 0 })
    useStore.getState().update(s => { s.active.entries[0].sets[0].done = true })
    h.sent = []
    expect(await useStore.getState().logWatchSet(ev())).toBe(false)
    await flush()
    expect(h.sent[0]).toMatchObject({ i: 1 })
  })

  it('leaves a past workout being logged, or a saved one being edited, alone', async () => {
    useStore.getState().update(s => { s.active.backfill = true })
    expect(await useStore.getState().logWatchSet(ev())).toBe(false)
    useStore.getState().update(s => { s.active.backfill = false; s.active.editingWorkoutId = 'x' })
    expect(await useStore.getState().logWatchSet(ev())).toBe(false)
    expect(A().entries[0].sets[0].done).toBe(false)
  })
})

describe('the current set on the watch', () => {
  it('follows the active workout, debounced, and only when it changed', async () => {
    vi.useFakeTimers()
    const stop = followWatchSet(300)
    useStore.getState().update(s => { s.active.entries[0].sets[0].w = 102.5 })
    useStore.getState().update(s => { s.active.entries[0].sets[0].w = 105 })
    await vi.advanceTimersByTimeAsync(299)
    expect(h.sent).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]).toMatchObject({ entryId: SQUAT, i: 0, w: 105, setNo: 1, setCount: 2 })
    useStore.getState().update(s => { s.active.entries[0].sets[0].note = 'x' })
    await vi.advanceTimersByTimeAsync(300)
    expect(h.sent).toHaveLength(1)
    useStore.getState().update(s => { s.active = null })
    await vi.advanceTimersByTimeAsync(300)
    expect(h.sent[1]).toBeNull()
    stop()
  })

  it('tries again on the next change when the watch could not be told', async () => {
    vi.useFakeTimers()
    const stop = followWatchSet(300)
    h.ok = false
    useStore.getState().update(s => { s.active.entries[0].sets[0].w = 90 })
    await vi.advanceTimersByTimeAsync(300)
    h.ok = true
    useStore.getState().update(s => { s.active.name = 'Legs!' })
    await vi.advanceTimersByTimeAsync(300)
    expect(h.sent).toHaveLength(2)
    expect(h.sent[1]).toEqual(h.sent[0])
    stop()
  })

  it('is sent at once when the watch session starts running', async () => {
    h.watch.onRunning('w1')
    await flush()
    expect(h.sent[0]).toMatchObject({ id: 'w1', entryId: SQUAT })
  })
})
