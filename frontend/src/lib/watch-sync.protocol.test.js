// @vitest-environment happy-dom
// The watch link must never lose a set or leave the two sides apart (1.4.5, #882): every event is
// applied once whatever the transport does to it (copies, a different order, a long time offline),
// the phone tells the watch what it has (`acked`), and the end of a workout on either side ends up
// the same on both. A small phone is played here: its workout screen's actions as plain functions
// over a state, finishing as the real Finish does (an exercise without a set done is not saved).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyEvents, bindWatchActions, bindWatchAppActions, drainWatchEvents, patchSetIn, inWatchOrder, ackedIds, startWatchSync, markDiscarded, _setWatchPluginForTest, _resetWatchSync, DEFER_MAX_MS } from './watch-sync.js'

const NOW = 1_800_000_000_000

beforeEach(() => { localStorage.clear(); _resetWatchSync() })

const routine = [
  { id: '0025', target: { sets: 2, reps: 8, weight: 60 }, sets: [{ w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }] },
  { id: '0001', target: { sets: 2, reps: 10 }, sets: [{ w: 20, r: 10, done: false }, { w: 20, r: 10, done: false }] },
]
const fresh = () => JSON.parse(JSON.stringify(routine))

/** A phone: its state, the app's actions and (when `screen`) the workout screen's. */
function phone ({ active = null, workouts = [], screen = true } = {}) {
  const P = { S: { unit: 'kg', workouts, routines: [], active }, saved: 0 }
  P.get = () => ({ S: P.S, saveNow: async () => { P.saved++ } })
  P.update = fn => { const S = JSON.parse(JSON.stringify(P.S)); fn(S); P.S = S }
  P.finish = () => P.update(S => {
    const A = S.active
    S.workouts.push({ id: A.id, start: A.start, entries: A.entries.filter(e => e.sets.some(s => s.done)) })
    S.active = null
  })
  P.discard = () => { markDiscarded(P.S.active?.id, NOW); P.update(S => { S.active = null }) }
  P.app = {
    start: vi.fn((ids, { id, start }) => P.update(S => { S.active = { id, start, entries: fresh() } })),
    patchSet: vi.fn((where, fields, opts) => P.update(S => { patchSetIn(S, where, fields, w => { w.edited = NOW }, opts) })),
    openWorkout: vi.fn(() => { if (!P.screenOn) P.bindScreen() }),
  }
  P.screen = {
    setDone: vi.fn((ei, si, { w, r, at }) => P.update(S => { Object.assign(S.active.entries[ei].sets[si], { w, r, at, done: true }) })),
    finish: vi.fn(() => P.finish()),
    discard: vi.fn(() => P.discard()),
  }
  P.bindScreen = () => { P.screenOn = true; return bindWatchActions(P.screen) }
  bindWatchAppActions(P.app)
  if (screen) P.bindScreen()
  return P
}

/** What a watch sends for a workout it started: start, two sets of the first exercise, a set of the second, finish. */
function watchSession (wid = 'watch-1', t = NOW - 3600e3) {
  let seq = 0
  const ev = (type, over = {}) => ({ id: `${wid}:${++seq}`, seq, type, wid, at: t + seq * 60e3, ...over })
  return [
    ev('start', { routineIds: ['r1'] }),
    ev('setDone', { exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8 }),
    ev('setDone', { exId: '0025', entryIdx: 0, setIdx: 1, w: 62.5, r: 7 }),
    ev('setDone', { exId: '0001', entryIdx: 1, setIdx: 0, w: 20, r: 10 }),
    ev('finish'),
  ]
}

describe('the watch\'s order', () => {
  it('sorts the events that carry a seq among themselves, the others keep their places', () => {
    const evs = [{ id: 'c', seq: 3 }, { id: 'x' }, { id: 'a', seq: 1 }, { id: 'b', seq: 2 }]
    expect(inWatchOrder(evs).map(e => e.id)).toEqual(['a', 'x', 'b', 'c'])
    expect(inWatchOrder([{ id: 'x' }, { id: 'y' }]).map(e => e.id)).toEqual(['x', 'y'])
  })
})

describe('a whole workout from the watch while the phone was off', () => {
  it('arrives shuffled and twice over, and is saved once, complete, with nothing left running', () => {
    const P = phone()
    const evs = watchSession()
    const shuffled = [evs[3], evs[1], evs[4], evs[0], evs[2], evs[1], evs[0]]
    const done = applyEvents(shuffled, P.get, NOW)
    expect(new Set(done)).toEqual(new Set(evs.map(e => e.id)))
    expect(P.S.active).toBeNull()
    expect(P.S.workouts).toHaveLength(1)
    const [w] = P.S.workouts
    expect(w.id).toBe('watch-1')
    expect(w.entries.map(e => e.sets.filter(s => s.done).length)).toEqual([2, 1])
    expect(w.entries[0].sets[1]).toMatchObject({ w: 62.5, r: 7, done: true })
    expect(P.app.start).toHaveBeenCalledTimes(1)
  })

  it('a copy of the start that comes much later (a resend) starts nothing again', () => {
    const P = phone()
    const evs = watchSession()
    applyEvents(evs, P.get, NOW)
    // the applied list is long gone (a thousand events later), the workout is not
    localStorage.removeItem('gym_watch_applied')
    expect(applyEvents([{ ...evs[0], id: 'resent-start' }], P.get, NOW)).toEqual(['resent-start'])
    expect(P.S.active).toBeNull()
    expect(P.app.start).toHaveBeenCalledTimes(1)
  })

  it('the page restarting halfway applies the rest once, the first half not again', () => {
    const P = phone()
    const evs = watchSession()
    applyEvents(evs.slice(0, 3), P.get, NOW)
    // the page reloads: its in-memory state is gone, localStorage is not
    _resetWatchSync()
    bindWatchAppActions(P.app)
    P.bindScreen()
    const done = applyEvents(evs, P.get, NOW)
    expect(done).toHaveLength(5)
    expect(P.screen.setDone).toHaveBeenCalledTimes(3)
    expect(P.S.workouts[0].entries.map(e => e.sets.filter(s => s.done).length)).toEqual([2, 1])
  })
})

describe('events that overtake their workout\'s start', () => {
  it('wait in the queue, unacknowledged, and apply once the start is there', () => {
    const P = phone()
    const [start, s1, s2] = watchSession()
    expect(applyEvents([s1, s2], P.get, NOW)).toEqual([])
    expect(P.screen.setDone).not.toHaveBeenCalled()
    const done = applyEvents([s1, s2, start], P.get, NOW)
    expect(done).toEqual([start.id, s1.id, s2.id])
    expect(P.S.active.entries[0].sets.every(s => s.done)).toBe(true)
  })

  it('do not wait for ever: after two days, or for a workout discarded here, they are let go of', () => {
    const P = phone()
    const [, s1] = watchSession('watch-old', NOW - DEFER_MAX_MS - 3600e3)
    expect(applyEvents([s1], P.get, NOW)).toEqual([s1.id])
    const [, s2] = watchSession('watch-gone')
    markDiscarded('watch-gone', NOW)
    expect(applyEvents([s2], P.get, NOW)).toEqual([s2.id])
    expect(P.S.workouts).toHaveLength(0)
  })
})

describe('the end of a workout', () => {
  it('finished on the phone while the watch was away: the watch\'s later sets land in the saved workout, also for an exercise the phone left empty', () => {
    const active = { id: 'w-1', start: NOW - 3600e3, entries: fresh() }
    active.entries[0].sets[0] = { w: 60, r: 8, done: true, at: NOW - 3000e3 }
    const P = phone({ active })
    P.finish()
    expect(P.S.workouts[0].entries).toHaveLength(1)
    const late = [
      { id: 'l1', seq: 7, type: 'setDone', wid: 'w-1', exId: '0025', entryIdx: 0, setIdx: 1, w: 62.5, r: 6, at: NOW - 2000e3 },
      { id: 'l2', seq: 8, type: 'setDone', wid: 'w-1', exId: '0001', entryIdx: 1, setIdx: 1, w: 22.5, r: 9, at: NOW - 1900e3 },
      { id: 'l3', seq: 9, type: 'finish', wid: 'w-1', at: NOW - 1800e3 },
    ]
    expect(applyEvents(late, P.get, NOW)).toEqual(['l1', 'l2', 'l3'])
    const w = P.S.workouts[0]
    expect(P.S.active).toBeNull()
    expect(P.S.workouts).toHaveLength(1)
    expect(w.entries[0].sets[1]).toMatchObject({ w: 62.5, r: 6, done: true })
    expect(w.entries[1].id).toBe('0001')
    expect(w.entries[1].sets[1]).toMatchObject({ w: 22.5, r: 9, done: true })
    expect(w.entries[1].sets[0].done).toBe(false)
    expect(w.edited).toBe(NOW)
  })

  it('finished on the watch while the phone app was killed: the phone opens the workout, then saves it', () => {
    const active = { id: 'w-1', start: NOW - 3600e3, entries: fresh() }
    const P = phone({ active, screen: false })
    const evs = [
      { id: 'a', seq: 1, type: 'setDone', wid: 'w-1', exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8, at: NOW - 600e3 },
      { id: 'b', seq: 2, type: 'finish', wid: 'w-1', at: NOW - 500e3 },
    ]
    // no workout screen yet: the first event opens it and everything waits, in order
    _resetWatchSync()
    bindWatchAppActions({ ...P.app, openWorkout: vi.fn() })
    expect(applyEvents(evs, P.get, NOW)).toEqual([])
    P.bindScreen()
    expect(applyEvents(evs, P.get, NOW)).toEqual(['a', 'b'])
    expect(P.S.active).toBeNull()
    expect(P.S.workouts[0].entries[0].sets[0]).toMatchObject({ w: 60, r: 8, done: true })
  })

  it('discarded on the watch: gone on the phone too, and its late sets do not bring it back', () => {
    const active = { id: 'w-1', start: NOW - 3600e3, entries: fresh() }
    const P = phone({ active })
    expect(applyEvents([{ id: 'd', seq: 3, type: 'discard', wid: 'w-1', at: NOW }], P.get, NOW)).toEqual(['d'])
    expect(P.S.active).toBeNull()
    expect(applyEvents([{ id: 'late', seq: 2, type: 'setDone', wid: 'w-1', exId: '0025', entryIdx: 0, setIdx: 0, w: 1, r: 1, at: NOW - 1 }], P.get, NOW)).toEqual(['late'])
    expect(P.S.workouts).toHaveLength(0)
    expect(P.S.active).toBeNull()
  })

  it('a workout started on the watch while another ran on the phone waits for that one, then is kept too', () => {
    const P = phone({ active: { id: 'phone-1', start: NOW - 3600e3, entries: fresh() } })
    const evs = watchSession('watch-2', NOW - 1800e3)
    expect(applyEvents(evs, P.get, NOW)).toEqual([])
    expect(P.S.active.id).toBe('phone-1')
    P.screen.setDone(0, 0, { w: 50, r: 5, at: NOW - 100 })
    P.finish()
    expect(applyEvents(evs, P.get, NOW)).toHaveLength(5)
    expect(P.S.workouts.map(w => w.id)).toEqual(['phone-1', 'watch-2'])
    expect(P.S.active).toBeNull()
  })
})

describe('telling the watch what the phone has', () => {
  function store (initial) {
    let st = initial
    const subs = new Set()
    return { getState: () => st, setState: patch => { const prev = st; st = { ...st, ...patch }; subs.forEach(fn => fn(st, prev)) }, subscribe: fn => { subs.add(fn); return () => subs.delete(fn) } }
  }
  function bridge (queue) {
    return {
      status: vi.fn(async () => ({ paired: true, installed: true })),
      sendSnapshot: vi.fn(async () => ({ sent: true })),
      sendClips: vi.fn(async () => ({})), dropClips: vi.fn(async () => ({})), openOnWatch: vi.fn(async () => ({ ok: true })),
      drain: vi.fn(async () => ({ events: queue.splice(0) })),
      ack: vi.fn(async () => ({})),
      listeners: {},
      addListener: vi.fn(async function (name, fn) { this.listeners[name] = fn; return { remove: () => {} } }),
    }
  }

  it('the next snapshot names the applied ids, also when the event changed nothing (a set of another workout)', async () => {
    vi.useFakeTimers()
    try {
      const queue = []
      const b = bridge(queue)
      _setWatchPluginForTest(b)
      const st = store({ S: { unit: 'kg', workouts: [], routines: [], active: null } })
      const stop = await startWatchSync({ useStore: st, useUI: store({ timer: null }) })
      await vi.advanceTimersByTimeAsync(1000)
      b.sendSnapshot.mockClear()
      queue.push({ id: 'meaningless', type: 'setDone', wid: 'w-gone', exId: '0025', entryIdx: 0, setIdx: 0, at: 1 })
      await drainWatchEvents()
      expect(b.ack).toHaveBeenCalledWith({ ids: ['meaningless'] })
      await vi.advanceTimersByTimeAsync(1000)
      expect(b.sendSnapshot).toHaveBeenCalledTimes(1)
      expect(JSON.parse(b.sendSnapshot.mock.calls[0][0].json).acked).toEqual(['meaningless'])
      expect(ackedIds()).toEqual(['meaningless'])
      stop()
    } finally { vi.useRealTimers() }
  })

  // REDDIT-146: a set from the watch that landed while a drain ran waited for the next event.
  it('a drain asked for while one runs runs again right after, so a set landing meanwhile is applied', async () => {
    const queue = []
    const b = bridge(queue)
    let release
    const gate = new Promise(r => { release = r })
    let first = true
    // The first drain has read the queue already when the set lands, and is still busy.
    b.drain = vi.fn(async () => {
      const events = queue.splice(0)
      if (first) { first = false; await gate }
      return { events }
    })
    _setWatchPluginForTest(b, () => ({ S: { unit: 'kg', workouts: [], routines: [], active: null } }))
    const running = drainWatchEvents()
    await Promise.resolve()
    queue.push({ id: 'late', type: 'setDone', wid: 'w-gone', exId: '0025', entryIdx: 0, setIdx: 0, at: 1 })
    expect(drainWatchEvents()).toBe(running)
    release()
    await running
    await vi.waitFor(() => expect(b.ack).toHaveBeenCalledWith({ ids: ['late'] }))
    expect(b.drain).toHaveBeenCalledTimes(2)
  })
})

// REDDIT-146: the snapshot comes as a message and as the application context, which travel apart.
// The watch applies each through one door that skips a stamp older than the newest applied.
describe('the Apple Watch never applies an older snapshot over a newer one', () => {
  it('every snapshot the watch gets goes through receive(), which checks the phone stamp', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const store = readFileSync(resolve('ios/App/Watch/SessionStore.swift'), 'utf8')
    expect(store).not.toMatch(/\["snapshot"\] as\? String \{ (self\.)?apply\(json/)
    expect(store.match(/receive\((applicationContext|message|session\.receivedApplicationContext|WCSession\.default\.receivedApplicationContext)\)/g)).toHaveLength(4)
    expect(store).toMatch(/SnapshotOrder\.accept\(at, after: self\.snapshotAt\)/)
    const bridge = readFileSync(resolve('ios/App/App/WatchBridgePlugin.swift'), 'utf8')
    // stamped in sending order whatever the phone's clock does (a clock that went back an hour
    // used to leave the watch deaf until it had caught up)
    expect(bridge).toMatch(/"snapshot": json, "at": WatchBridgePlugin\.stampSnapshot\(\)/)
    expect(bridge).toMatch(/return max\(now, last \+ 0\.001\)/)
  })
})
