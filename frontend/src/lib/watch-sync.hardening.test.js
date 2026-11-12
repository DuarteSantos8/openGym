// @vitest-environment happy-dom
// The page's side of the watch link when something goes wrong in the page itself: an action that
// throws must not block the queue for good, a late status must not undo a newer one, and a set for
// a row the running workout does not have gets its row.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyEvents, bindWatchActions, bindWatchAppActions, drainWatchEvents, ensureWatchSet, patchSetIn, _setWatchPluginForTest, _resetWatchSync, POISON_TRIES, RERUN_MS } from './watch-sync.js'
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

// An Apple Watch and a second watch (a Garmin in the same native queue, a Zepp watch over the
// relay) on one phone. Each numbers its own events from 1, so their `seq` collide.
describe('two watches on one phone', () => {
  const NOW = 1_800_000_000_000
  function phone (active) {
    const P = { S: { unit: 'kg', workouts: [], active } }
    P.update = fn => { const S = JSON.parse(JSON.stringify(P.S)); fn(S); P.S = S }
    P.get = () => ({ S: P.S })
    const fresh = () => active().entries
    bindWatchAppActions({
      start: (ids, { id, start }) => P.update(S => { S.active = { id, start, entries: fresh() } }),
      patchSet: (where, fields, opts) => P.update(S => { patchSetIn(S, where, fields, null, opts) }),
      ensureSet: (where, fields) => { let ok = false; P.update(S => { ok = ensureWatchSet(S, where, id => ({ id, target: null, sets: [] }), fields) }); return ok },
    })
    bindWatchActions({
      setDone: (ei, si, { w, r, at }) => P.update(S => { const set = S.active.entries[ei].sets[si]; if (set.done && at && set.at > at) return; Object.assign(set, { w, r, at, done: true }) }),
      finish: ({ end } = {}) => P.update(S => { S.workouts.push({ id: S.active.id, start: S.active.start, end, entries: S.active.entries.filter(e => e.sets.some(s => s.done)) }); S.active = null }),
      discard: () => P.update(S => { S.active = null }),
    })
    return P
  }
  const from = (watch, wid) => { let seq = 0; return (type, at, over = {}) => ({ id: `${watch}:${++seq}`, seq, type, wid, at, ...over }) }

  it('both tick sets of the phone\'s workout, their seq colliding: every set lands, the later tick of a shared set wins', () => {
    const P = phone(null)
    P.S = { unit: 'kg', workouts: [], active: { ...active(), entries: [{ id: '0025', target: null, sets: [0, 1, 2].map(() => ({ w: 60, r: 8, done: false })) }] } }
    const apple = from('apple', 'w-1'), garmin = from('garmin', 'w-1')
    const evs = [
      garmin('setDone', NOW + 2000, { exId: '0025', entryIdx: 0, setIdx: 1, w: 61, r: 7 }),
      apple('setDone', NOW + 1000, { exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8 }),
      apple('setDone', NOW + 5000, { exId: '0025', entryIdx: 0, setIdx: 2, w: 65, r: 5 }),
      garmin('setDone', NOW + 4000, { exId: '0025', entryIdx: 0, setIdx: 2, w: 64, r: 4 }),
    ]
    expect(applyEvents(evs, P.get, NOW + 6000).sort()).toEqual(['apple:1', 'apple:2', 'garmin:1', 'garmin:2'])
    expect(P.S.active.entries[0].sets.map(s => [s.w, s.r])).toEqual([[60, 8], [61, 7], [65, 5]])
    // the other order of arrival ends the same
    const Q = phone(null)
    Q.S = { unit: 'kg', workouts: [], active: { ...active(), entries: [{ id: '0025', target: null, sets: [0, 1, 2].map(() => ({ w: 60, r: 8, done: false })) }] } }
    localStorage.clear()
    applyEvents([evs[2], evs[3], evs[1], evs[0]].map(e => ({ ...e, seq: undefined })), Q.get, NOW + 6000)
    expect(Q.S.active.entries[0].sets.map(s => [s.w, s.r])).toEqual([[60, 8], [61, 7], [65, 5]])
  })

  it('each starts a workout of its own with the phone away: both are saved, one after the other, with their own sets', () => {
    const P = phone(() => ({ entries: [{ id: '0025', target: null, sets: [{ w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }] }] }))
    P.S.active = null
    const apple = from('apple', 'watch-A'), garmin = from('garmin', 'watch-G')
    const evs = [
      apple('start', NOW, { routineIds: ['r1'] }),
      garmin('start', NOW + 100, { routineIds: ['r1'] }),
      apple('setDone', NOW + 1000, { exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8 }),
      garmin('setDone', NOW + 1100, { exId: '0025', entryIdx: 0, setIdx: 0, w: 40, r: 12 }),
      apple('finish', NOW + 2000),
      garmin('finish', NOW + 2100),
    ]
    // the second watch's workout waits for the first to end: one drain may not finish everything
    for (let i = 0; i < 3; i++) applyEvents(evs, P.get, NOW + 3000)
    expect(P.S.active).toBeNull()
    expect(P.S.workouts.map(w => w.id).sort()).toEqual(['watch-A', 'watch-G'])
    expect(P.S.workouts.find(w => w.id === 'watch-A').entries[0].sets[0]).toMatchObject({ w: 60, r: 8, done: true })
    expect(P.S.workouts.find(w => w.id === 'watch-G').entries[0].sets[0]).toMatchObject({ w: 40, r: 12, done: true })
    expect(P.S.workouts.find(w => w.id === 'watch-A').end).toBe(NOW + 2000)
  })

  it('one finishes the workout while the other still has sets on their way: they land in the saved workout', () => {
    const P = phone(null)
    P.S = { unit: 'kg', workouts: [], active: active() }
    const apple = from('apple', 'w-1'), garmin = from('garmin', 'w-1')
    applyEvents([apple('setDone', NOW + 1000, { exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8 }), apple('finish', NOW + 2000)], P.get, NOW + 3000)
    expect(P.S.active).toBeNull()
    applyEvents([garmin('setDone', NOW + 1500, { exId: '0025', entryIdx: 0, setIdx: 1, w: 55, r: 9 }), garmin('finish', NOW + 2500)], P.get, NOW + 4000)
    expect(P.S.workouts).toHaveLength(1)
    expect(P.S.workouts[0].entries[0].sets.map(s => [s.w, s.r, s.done])).toEqual([[60, 8, true], [55, 9, true]])
  })
})

// A workout left open on the phone for days (forgotten workouts switched off, the phone in a drawer).
describe('a workout from the watch that has to wait for the phone\'s own to end', () => {
  const DAY = 24 * 3600e3
  const NOW = 1_800_000_000_000
  it('waits as long as it takes, heart rates included, and is saved with its own dates once the phone\'s workout ends', () => {
    let S = { unit: 'kg', workouts: [], active: { id: 'phone-1', start: NOW - 6 * DAY, entries: [{ id: '0027', target: null, sets: [{ w: 80, r: 6, done: true, at: NOW - 6 * DAY + 60e3 }] }] } }
    const update = fn => { const next = JSON.parse(JSON.stringify(S)); fn(next); S = next }
    const get = () => ({ S })
    bindWatchAppActions({
      start: (ids, { id, start }) => update(s => { s.active = { id, start, entries: active().entries } }),
      patchSet: (where, fields, opts) => update(s => { patchSetIn(s, where, fields, null, opts) }),
    })
    const finish = vi.fn(({ end } = {}) => update(s => { s.workouts.push({ id: s.active.id, start: s.active.start, end: end ?? NOW, entries: s.active.entries }); s.active = null }))
    bindWatchActions({
      setDone: (ei, si, { w, r, at }) => update(s => { Object.assign(s.active.entries[ei].sets[si], { w, r, at, done: true }) }),
      finish, discard: vi.fn(),
    })
    const t = NOW - 4 * DAY
    const evs = [
      { id: 'w1', seq: 1, type: 'start', wid: 'watch-A', at: t, routineIds: ['r1'] },
      { id: 'w2', seq: 2, type: 'setDone', wid: 'watch-A', exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8, at: t + 60e3 },
      { id: 'w3', seq: 3, type: 'setHr', wid: 'watch-A', exId: '0025', entryIdx: 0, setIdx: 0, restHr: { avg: 110, max: 131 } },
      { id: 'w4', seq: 4, type: 'finish', wid: 'watch-A', at: t + 30 * 60e3 },
    ]
    // four days on, the phone's own workout still open: nothing is let go of
    for (let i = 0; i < 3; i++) expect(applyEvents(evs, get, NOW)).toEqual([])
    expect(S.active.id).toBe('phone-1')
    // the phone's workout ends at last
    update(s => { s.workouts.push({ id: 'phone-1', entries: s.active.entries }); s.active = null })
    expect(applyEvents(evs, get, NOW)).toEqual(['w1', 'w2', 'w3', 'w4'])
    expect(S.active).toBeNull()
    const w = S.workouts.find(x => x.id === 'watch-A')
    expect(w.start).toBe(t)
    expect(w.end).toBe(t + 30 * 60e3)
    expect(w.entries[0].sets[0]).toMatchObject({ w: 60, r: 8, done: true, restHr: { avg: 110, max: 131 } })
  })

  it('a set that came before its start in the same queue is applied on the drain that follows by itself', async () => {
    vi.useFakeTimers()
    let S = { unit: 'kg', workouts: [], active: null }
    const update = fn => { const next = JSON.parse(JSON.stringify(S)); fn(next); S = next }
    const queue = [
      { id: 's', type: 'setDone', wid: 'watch-B', exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8, at: Date.now() - 1000 },
      { id: 'st', type: 'start', wid: 'watch-B', at: Date.now() - 2000, routineIds: ['r1'] },
    ]
    const bridge = { drain: vi.fn(async () => ({ events: queue.slice() })), ack: vi.fn(async ({ ids }) => { for (const id of ids) queue.splice(queue.findIndex(e => e.id === id), 1) }) }
    _setWatchPluginForTest(bridge, () => ({ S }))
    bindWatchActions({ setDone: (ei, si, { w, r, at }) => update(s => { Object.assign(s.active.entries[ei].sets[si], { w, r, at, done: true }) }) })
    bindWatchAppActions({ start: (ids, { id, start }) => update(s => { s.active = { id, start, entries: active().entries } }), patchSet: vi.fn() })
    await vi.advanceTimersByTimeAsync(RERUN_MS + 50)
    expect(queue).toEqual([])
    expect(S.active.entries[0].sets[0]).toMatchObject({ done: true, w: 60, r: 8 })
  })
})
