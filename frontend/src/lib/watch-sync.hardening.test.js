// @vitest-environment happy-dom
// The page's side of the watch link when something goes wrong in the page itself: an action that
// throws must not block the queue for good, a late status must not undo a newer one, and a set for
// a row the running workout does not have gets its row.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyEvents, bindWatchActions, bindWatchAppActions, drainWatchEvents, ensureWatchSet, _setWatchPluginForTest, _resetWatchSync, POISON_TRIES, RERUN_MS } from './watch-sync.js'
import { readWatchStatus } from './watch-settings.js'

beforeEach(() => { localStorage.clear(); _resetWatchSync() })
afterEach(() => { _resetWatchSync(); vi.useRealTimers() })

const active = () => ({ id: 'w-1', start: 1, entries: [{ id: '0025', target: null, sets: [{ w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }] }] })
const tick = (id, setIdx, over = {}) => ({ id, type: 'setDone', wid: 'w-1', exId: '0025', entryIdx: 0, setIdx, w: 60, r: 8, at: 10 + setIdx, ...over })

describe('an action that throws', () => {
  it('stops the run, keeps the event queued, and is let go of after a few tries so the sets behind it get through', () => {
    const S = { unit: 'kg', workouts: [], active: active() }
    const setDone = vi.fn((ei, si) => { if (si === 0) throw new Error('a screen between two workouts') })
    bindWatchActions({ setDone })
    bindWatchAppActions({ start: vi.fn(), patchSet: vi.fn() })
    const evs = [tick('a', 0), tick('b', 1)]
    for (let i = 1; i < POISON_TRIES; i++) expect(applyEvents(evs, () => ({ S }))).toEqual([])
    expect(setDone).toHaveBeenCalledTimes(POISON_TRIES - 1)
    expect(applyEvents(evs, () => ({ S }))).toEqual(['a', 'b'])
    expect(setDone).toHaveBeenLastCalledWith(0, 1, expect.objectContaining({ w: 60, r: 8 }))
  })

  it('an action that throws once and then works (the screen caught up) is applied on the drain that follows by itself', async () => {
    vi.useFakeTimers()
    const S = { unit: 'kg', workouts: [], active: active() }
    let calls = 0
    const setDone = vi.fn(() => { if (++calls === 1) throw new Error('not yet') })
    const queue = [tick('a', 0)]
    const bridge = { drain: vi.fn(async () => ({ events: queue.slice() })), ack: vi.fn(async ({ ids }) => { for (const id of ids) queue.splice(queue.findIndex(e => e.id === id), 1) }) }
    _setWatchPluginForTest(bridge, () => ({ S }))
    bindWatchActions({ setDone })
    await vi.advanceTimersByTimeAsync(0)
    expect(bridge.ack).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(RERUN_MS + 10)
    expect(bridge.ack).toHaveBeenCalledWith({ ids: ['a'] })
    expect(setDone).toHaveBeenCalledTimes(2)
    await drainWatchEvents()
  })
})

describe('what the watch says about itself', () => {
  it('an older status that arrives after a newer one does not replace it', () => {
    const get = () => ({ S: { unit: 'kg', workouts: [], active: null } })
    applyEvents([{ id: 's2', type: 'watchStatus', health: 'on', version: '1.4.5', at: 2000 }], get)
    applyEvents([{ id: 's1', type: 'watchStatus', health: 'denied', version: '1.4.4', at: 1000 }], get)
    expect(readWatchStatus()).toMatchObject({ health: 'on', version: '1.4.5' })
    applyEvents([{ id: 's3', type: 'watchStatus', health: 'off', version: '1.4.5', at: 3000 }], get)
    expect(readWatchStatus()).toMatchObject({ health: 'off' })
  })
})

describe('a set for a row the running workout does not have', () => {
  it('gets the rows up to it, like the last one there and not done, with the set in the one it names', () => {
    const S = { unit: 'kg', workouts: [], active: active() }
    S.active.entries[0].sets[1] = { w: 60, r: 8, done: true, at: 5, hr: { avg: 120 }, rpe: 8, note: 'x' }
    expect(ensureWatchSet(S, { exId: '0025', setIdx: 3 }, null, { done: true, w: 65, r: 5, at: 99 })).toBe(true)
    expect(S.active.entries[0].sets).toHaveLength(4)
    expect(S.active.entries[0].sets[2]).toEqual({ w: 60, r: 8, done: false })
    expect(S.active.entries[0].sets[3]).toEqual({ w: 65, r: 5, done: true, at: 99 })
  })

  it('a per-side exercise gets a per-side row, and the tick of one side lands on that side', () => {
    const S = { unit: 'kg', workouts: [], active: { id: 'w-1', entries: [{ id: 'split', target: null, sets: [{ w: 20, r: 16, done: true, sides: { L: { w: 20, r: 8, done: true }, R: { w: 20, r: 8, done: true } } }] }] } }
    expect(ensureWatchSet(S, { exId: 'split', setIdx: 1, side: 'L' }, null, { done: true, w: 22, r: 7, at: 50 })).toBe(true)
    const row = S.active.entries[0].sets[1]
    expect(row.sides.L).toMatchObject({ w: 22, r: 7, done: true })
    expect(row.sides.R).toMatchObject({ w: 20, r: 8, done: false })
    expect(row.done).toBe(false)
  })

  it('an exercise the workout does not have is built and put at the end; one that cannot be built changes nothing', () => {
    const S = { unit: 'kg', workouts: [], active: active() }
    const build = vi.fn(id => (id === '0001' ? { target: { sets: 2, reps: 10 }, plan: null, sets: [{ w: 20, r: 10, done: false }, { w: 20, r: 10, done: false }] } : null))
    expect(ensureWatchSet(S, { exId: '0001', setIdx: 1 }, build, { done: true, w: 22.5, r: 9, at: 7 })).toBe(true)
    expect(S.active.entries.map(e => e.id)).toEqual(['0025', '0001'])
    expect(S.active.entries[1].sets).toEqual([{ w: 20, r: 10, done: false }, { w: 22.5, r: 9, done: true, at: 7 }])
    expect(ensureWatchSet(S, { exId: 'gone', setIdx: 0 }, build, { done: true })).toBe(false)
    expect(ensureWatchSet(S, { exId: '0025', setIdx: 500 }, build, { done: true })).toBe(false)
    expect(S.active.entries).toHaveLength(2)
  })

  it('never touches a saved workout that is open in the editor', () => {
    const S = { unit: 'kg', workouts: [], active: { ...active(), editingWorkoutId: 'w-0' } }
    expect(ensureWatchSet(S, { exId: '0025', setIdx: 5 }, null, { done: true })).toBe(false)
    expect(S.active.entries[0].sets).toHaveLength(2)
  })

  it('through the queue: applied in one go, acknowledged, and the screen\'s own tick is not asked for a row it has not drawn', () => {
    let S = { unit: 'kg', workouts: [], active: active() }
    const setDone = vi.fn()
    const ensureSet = vi.fn((where, fields) => { S = JSON.parse(JSON.stringify(S)); return ensureWatchSet(S, where, id => ({ id, target: null, sets: [] }), fields) })
    bindWatchActions({ setDone })
    bindWatchAppActions({ start: vi.fn(), patchSet: vi.fn(), ensureSet })
    const evs = [tick('a', 2, { w: 70, r: 3 }), { id: 'b', type: 'setDone', wid: 'w-1', exId: '0033', entryIdx: 4, setIdx: 0, w: 10, r: 12, at: 20 }]
    expect(applyEvents(evs, () => ({ S }))).toEqual(['a', 'b'])
    expect(setDone).not.toHaveBeenCalled()
    expect(S.active.entries[0].sets[2]).toMatchObject({ w: 70, r: 3, done: true })
    expect(S.active.entries[1]).toMatchObject({ id: '0033', sets: [{ w: 10, r: 12, done: true, at: 20 }] })
  })
})
