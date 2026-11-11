// @vitest-environment happy-dom
// The watch and the phone apart (the fable round, 1.4.5). A whole workout logged on a Wear OS
// watch with no phone at all comes back later through the phone's native queue: out of order, in
// pieces, twice over, with the app killed in the middle. Nothing may be lost and no set may count
// twice. The events are not made up here: `offline-workout.json` is what the watch's own code
// sends for that workout (android/wear OfflineSyncTest.kt builds it and compares), so this is the
// two halves of the link meeting in one file.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyEvents, bindWatchActions, bindWatchAppActions, drainWatchEvents, patchSetIn, ackedIds, markDiscarded, restLagSec, _setWatchPluginForTest, _resetWatchSync } from './watch-sync.js'
import { readWatchStatus } from './watch-settings.js'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'android', 'wear', 'src', 'test', 'resources')
const offline = () => JSON.parse(readFileSync(join(fixtures, 'offline-workout.json'), 'utf8'))
const T0 = 1_800_000_000_000
const NOW = T0 + 3 * 3600e3   // the phone comes back three hours later

// The phone's clock: three hours after the workout (only Date is faked, the drains' promises run as they are).
beforeEach(() => { localStorage.clear(); _resetWatchSync(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => vi.useRealTimers())

// The routine the watch started from, as starting it on the phone builds it.
const pushDay = () => [
  { id: '0025', target: { sets: 2, reps: 8, weight: 60, restSec: 45 }, sets: [{ w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }] },
  { id: '0007', target: { sets: 1, sec: 20, mode: 'time' }, sets: [{ sec: 20, done: false }] },
  { id: '0001', sg: 'g1', target: { sets: 2, reps: 10 }, sets: [{ w: 20, r: 10, done: false }, { w: 20, r: 10, done: false }] },
  { id: '0009', sg: 'g1', target: { sets: 2, reps: 12 }, sets: [{ w: 15, r: 12, done: false }, { w: 15, r: 12, done: false }] },
]

/** Drains until nothing is in flight (a bind starts a drain of its own; one asked meanwhile runs right after). */
const settle = async () => { for (let i = 0; i < 4; i++) await drainWatchEvents() }

/** The phone's native queue (WatchEventQueue.java): one row per id, in the watch's order, until acknowledged. */
function nativeQueue () {
  let rows = []
  const Q = {
    failAck: 0,
    put: (...evs) => { for (const ev of evs) if (!rows.some(r => r.id === ev.id)) rows.push(ev); rows.sort((a, b) => (a.seq || 0) - (b.seq || 0)) },
    ids: () => rows.map(r => r.id),
    plugin: {
      status: async () => ({ paired: true, installed: true }),
      drain: async () => ({ events: JSON.parse(JSON.stringify(rows)) }),
      ack: async ({ ids }) => { if (Q.failAck-- > 0) throw new Error('killed before the ack'); rows = rows.filter(r => !ids.includes(r.id)) },
    },
  }
  return Q
}

/** A phone: its state, the app's actions and the workout screen's, as the real ones behave. */
function phone ({ active = null } = {}) {
  const P = { S: { unit: 'kg', workouts: [], routines: [], bodyweight: [], active }, ticked: 0, saves: 0 }
  P.get = () => ({ S: P.S, saveNow: async () => { P.saves++ } })
  P.update = fn => { const S = JSON.parse(JSON.stringify(P.S)); fn(S); P.S = S }
  P.app = {
    start: vi.fn((ids, { id, start, bw }) => P.update(S => { S.active = { id, start, entries: pushDay(), ...(bw ? { bw } : {}) } })),
    patchSet: vi.fn((where, fields, opts) => P.update(S => { patchSetIn(S, where, fields, w => { w.edited = NOW }, opts) })),
    // today's weigh-in replaces today's, as the phone's check-in does
    weighIn: vi.fn(({ w, at }) => P.update(S => { const d = new Date(at).toISOString().slice(0, 10); S.bodyweight = [...S.bodyweight.filter(x => x.d !== d), { d, w }] })),
    openWorkout: vi.fn(),
  }
  P.screen = {
    // Workout.jsx's own rule: of two ticks of a set the later wins, the heart rate lands either way.
    setDone: vi.fn((ei, si, f) => P.update(S => {
      const set = S.active.entries[ei].sets[si]
      if (set.done && f.at && Number(set.at) > f.at) { if (f.hr) set.hr = f.hr; return }
      if (!set.done) P.ticked++
      for (const k of ['w', 'r', 'sec', 'at', 'hr', 'rpe', 'rir']) if (f[k] != null) set[k] = f[k]
      set.done = true
    })),
    finish: vi.fn(() => P.update(S => {
      const A = S.active
      S.workouts.push({ id: A.id, start: A.start, entries: A.entries.filter(e => e.sets.some(s => s.done)) })
      S.active = null
    })),
    discard: vi.fn(() => { markDiscarded(P.S.active?.id, NOW); P.update(S => { S.active = null }) }),
  }
  P.bind = () => { bindWatchAppActions(P.app); bindWatchActions(P.screen) }
  P.bind()
  return P
}

/** What the lifter did at the wrist, as it must stand in the phone's history. */
function expectTheWorkout (P) {
  expect(P.S.active).toBeNull()
  expect(P.S.workouts).toHaveLength(1)
  const w = P.S.workouts[0]
  expect(w.id).toBe('watch-off-1')
  expect(w.start).toBe(T0 + 1000)
  const done = id => (w.entries.find(e => e.id === id)?.sets || []).filter(s => s.done)
  expect(done('0025')).toHaveLength(2)
  expect(done('0025')[0]).toMatchObject({ w: 60, r: 8, hr: { avg: 121, max: 134 } })
  // the second set as it was fixed on the watch (6 reps, RIR 2), with the heart rate of the set and of its rest
  expect(done('0025')[1]).toMatchObject({ w: 62.5, r: 6, rir: 2, hr: { avg: 130, max: 148 }, restHr: { avg: 118, max: 126 } })
  expect(done('0007')).toEqual([expect.objectContaining({ sec: 18, done: true })])
  expect(done('0001').map(s => [s.w, s.r])).toEqual([[20, 10], [20, 9]])
  expect(done('0009').map(s => [s.w, s.r])).toEqual([[15, 12]])
  // seven set events, six sets (one was a fix of a set already done): none lost, none twice
  expect(w.entries.flatMap(e => e.sets).filter(s => s.done)).toHaveLength(6)
  expect(P.S.bodyweight).toEqual([{ d: new Date(T0).toISOString().slice(0, 10), w: 80.5 }])
}

describe('the fixture', () => {
  it('is a whole workout as the Wear OS watch sends it: numbered, one id each', () => {
    const evs = offline()
    expect(evs.map(e => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(new Set(evs.map(e => e.id)).size).toBe(11)
    expect(evs.map(e => e.type)).toEqual(['weighIn', 'start', 'setDone', 'setDone', 'setDone', 'setHr', 'setDone', 'setDone', 'setDone', 'setDone', 'finish'])
    expect(evs[1]).toMatchObject({ routineIds: ['r-push'], wid: 'watch-off-1', bw: 80.5 })
  })
})

describe('a workout logged on the watch with no phone at all', () => {
  it('lands in the history complete when it all arrives at once, in order', async () => {
    const P = phone(), Q = nativeQueue()
    _setWatchPluginForTest(Q.plugin, P.get)
    Q.put(...offline())
    await settle()
    expectTheWorkout(P)
    expect(Q.ids()).toEqual([])
    expect(P.app.start).toHaveBeenCalledTimes(1)
    expect(P.screen.finish).toHaveBeenCalledTimes(1)
    expect(P.saves).toBeGreaterThan(0)
  })

  it('in pieces, out of order and twice over: sets before their start wait, the finish overtakes sets, the end is the same', async () => {
    const P = phone(), Q = nativeQueue()
    _setWatchPluginForTest(Q.plugin, P.get)
    const ev = Object.fromEntries(offline().map(e => [e.seq, e]))
    // two sets get through before the start: they wait, unacknowledged
    Q.put(ev[4], ev[3])
    await settle()
    expect(P.S.active).toBeNull()
    expect(Q.ids()).toHaveLength(2)
    expect(ackedIds()).toEqual([])
    // then the start and the finish, with only some of the sets between them
    Q.put(ev[11], ev[2], ev[1], ev[7], ev[3])
    await settle()
    expect(P.S.active).toBeNull()
    expect(P.S.workouts).toHaveLength(1)
    // and at last the rest, with copies of what was applied long ago
    Q.put(ev[10], ev[5], ev[9], ev[6], ev[8], ev[2], ev[11], ev[4])
    await settle()
    expectTheWorkout(P)
    expect(Q.ids()).toEqual([])
    expect(P.app.start).toHaveBeenCalledTimes(1)
    expect(P.screen.finish).toHaveBeenCalledTimes(1)
    // the watch hears of every one of them, so its outbox empties
    expect(new Set(ackedIds())).toEqual(new Set(offline().map(e => e.id)))
  })

  it('the app killed between applying and acknowledging: the queue hands everything over again, nothing counts twice', async () => {
    const P = phone(), Q = nativeQueue()
    _setWatchPluginForTest(Q.plugin, P.get)
    Q.put(...offline())
    Q.failAck = 5
    await settle()
    expect(Q.ids()).toHaveLength(11)   // nothing acknowledged
    // the page starts again: its memory is gone, localStorage (the state, the applied ids) is not
    _resetWatchSync()
    Q.failAck = 0
    _setWatchPluginForTest(Q.plugin, P.get)
    P.bind()
    await settle()
    expectTheWorkout(P)
    expect(Q.ids()).toEqual([])
    expect(P.ticked).toBe(6)
    expect(P.app.start).toHaveBeenCalledTimes(1)
    expect(P.screen.finish).toHaveBeenCalledTimes(1)
  })

  it('killed mid-drain, before the list of applied ids was written: applying it all again changes nothing', async () => {
    const P = phone()
    applyEvents(offline(), P.get, NOW)
    applyEvents(offline(), P.get, NOW)
    const first = JSON.stringify(P.S)
    // the state made it to disk, the applied list did not
    localStorage.removeItem('gym_watch_applied')
    _resetWatchSync()
    P.bind()
    const done = applyEvents(offline(), P.get, NOW)
    expect(done).toHaveLength(11)
    expectTheWorkout(P)
    expect(P.S).toEqual(JSON.parse(first))
    expect(P.app.start).toHaveBeenCalledTimes(1)
  })

  it('the workout screen not open yet: the queue keeps everything until it is, then drains', async () => {
    const P = phone(), Q = nativeQueue()
    _resetWatchSync()
    bindWatchAppActions(P.app)          // the app is up, the workout screen is not
    _setWatchPluginForTest(Q.plugin, P.get)
    Q.put(...offline())
    await settle()
    expect(P.S.active?.id).toBe('watch-off-1')
    expect(P.app.openWorkout).toHaveBeenCalled()
    expect(Q.ids()).toHaveLength(9)     // the weigh-in and the start went through, the sets wait in order
    bindWatchActions(P.screen)          // binding drains
    await settle()
    expectTheWorkout(P)
  })
})

describe('a set logged at the wrist whose row the phone no longer has', () => {
  const running = () => ({ id: 'w-1', start: T0, entries: pushDay().slice(0, 2) })
  const tick = (id, exId, entryIdx, setIdx, over = {}) => ({ id, type: 'setDone', wid: 'w-1', exId, entryIdx, setIdx, w: 20, r: 10, at: NOW - 60e3, ...over })

  it('waits while the workout runs and lands in it when it is saved: the exercise the phone swapped out comes back with its set', async () => {
    const P = phone({ active: running() }), Q = nativeQueue()
    _setWatchPluginForTest(Q.plugin, P.get)
    // the watch still had the curl (removed on the phone since) and a third bench set (taken off)
    Q.put(tick('late-1', '0001', 2, 0, { seq: 1 }), tick('late-2', '0025', 0, 2, { seq: 2, w: 65, r: 5 }), tick('ok-3', '0025', 0, 0, { seq: 3, w: 60, r: 8 }))
    await settle()
    expect(Q.ids()).toEqual(['late-1', 'late-2'])                 // kept, not acknowledged away
    expect(P.S.active.entries[0].sets[0].done).toBe(true)         // the set behind them got through
    expect(ackedIds()).toEqual(['ok-3'])
    P.screen.finish()
    await settle()
    const w = P.S.workouts[0]
    expect(w.entries.find(e => e.id === '0001').sets[0]).toMatchObject({ w: 20, r: 10, done: true })
    expect(w.entries.find(e => e.id === '0025').sets[2]).toMatchObject({ w: 65, r: 5, done: true })
    expect(Q.ids()).toEqual([])
  })

  it('goes with a workout that is discarded, and does not wait for ever', async () => {
    const P = phone({ active: running() })
    expect(applyEvents([tick('late-1', '0001', 2, 0)], P.get, NOW)).toEqual([])
    // two days on, the workout still open: let go of
    expect(applyEvents([tick('late-1', '0001', 2, 0)], P.get, NOW + 49 * 3600e3)).toEqual(['late-1'])
    const P2 = phone({ active: running() })
    expect(applyEvents([tick('late-9', '0001', 2, 0)], P2.get, NOW)).toEqual([])
    P2.screen.discard()
    expect(applyEvents([tick('late-9', '0001', 2, 0)], P2.get, NOW)).toEqual(['late-9'])
    expect(P2.S.workouts).toEqual([])
  })
})

describe('an event that cannot be applied', () => {
  it('holds the queue for two drains, then is let go of so the sets behind it get through', () => {
    const P = phone({ active: { id: 'w-1', start: T0, entries: pushDay() } })
    const bad = { id: 'bad', seq: 1, type: 'setDone', wid: 'w-1', exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8, at: NOW }
    const good = { id: 'good', seq: 2, type: 'setDone', wid: 'w-1', exId: '0025', entryIdx: 0, setIdx: 1, w: 60, r: 8, at: NOW }
    const real = P.screen.setDone.getMockImplementation()
    P.screen.setDone.mockImplementation((ei, si, f) => { if (si === 0) throw new Error('boom'); return real(ei, si, f) })
    expect(applyEvents([bad, good], P.get, NOW)).toEqual([])
    expect(applyEvents([bad, good], P.get, NOW)).toEqual([])
    expect(P.S.active.entries[0].sets[1].done).toBe(false)        // order held: nothing overtook it
    expect(applyEvents([bad, good], P.get, NOW)).toEqual(['bad', 'good'])
    expect(P.S.active.entries[0].sets[1].done).toBe(true)
  })

  it('that fails once and then works is applied once, in order', () => {
    const P = phone({ active: { id: 'w-1', start: T0, entries: pushDay() } })
    const a = { id: 'a', seq: 1, type: 'setDone', wid: 'w-1', exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8, at: NOW }
    const real = P.screen.setDone.getMockImplementation()
    P.screen.setDone.mockImplementationOnce(() => { throw new Error('not now') })
    expect(applyEvents([a], P.get, NOW)).toEqual([])
    P.screen.setDone.mockImplementation(real)
    expect(applyEvents([a], P.get, NOW)).toEqual(['a'])
    expect(P.ticked).toBe(1)
  })
})

describe('two watches on one phone', () => {
  it('each numbers its own events; both land, and the same set ticked on both is one set with the later numbers', () => {
    const P = phone({ active: { id: 'w-1', start: T0, entries: pushDay() } })
    const wear = (seq, setIdx, at, over = {}) => ({ id: 'wear-' + seq, seq, type: 'setDone', wid: 'w-1', exId: '0025', entryIdx: 0, setIdx, w: 60, r: 8, at, ...over })
    const garmin = (seq, exId, entryIdx, setIdx, at, over = {}) => ({ id: 'garmin-' + seq, seq, type: 'setDone', wid: 'w-1', exId, entryIdx, setIdx, w: 20, r: 10, at, ...over })
    const evs = [
      garmin(2, '0001', 2, 0, T0 + 5000), wear(2, 1, T0 + 4000),
      wear(1, 0, T0 + 1000), garmin(1, '0025', 0, 0, T0 + 3000, { w: 62.5, r: 7 }),
    ]
    const done = applyEvents(evs, P.get, NOW)
    expect(new Set(done)).toEqual(new Set(['wear-1', 'wear-2', 'garmin-1', 'garmin-2']))
    const [bench, , curl] = P.S.active.entries
    expect(bench.sets[0]).toMatchObject({ w: 62.5, r: 7, at: T0 + 3000, done: true })   // the later tick
    expect(bench.sets[1].done).toBe(true)
    expect(curl.sets[0].done).toBe(true)
    expect(P.ticked).toBe(3)                                       // three sets, not four
    // both watches find their ids in the next snapshot
    expect(new Set(ackedIds())).toEqual(new Set(done))
    // the older tick of the shared set arriving again later does not take the set back
    applyEvents([{ ...wear(1, 0, T0 + 1000), id: 'wear-1-again' }], P.get, NOW)
    expect(P.S.active.entries[0].sets[0]).toMatchObject({ w: 62.5, r: 7 })
  })

  it('one starts a workout while the other\'s is running on the phone: it waits, then is kept too', () => {
    const P = phone({ active: { id: 'w-1', start: T0, entries: pushDay() } })
    const start = { id: 's', seq: 1, type: 'start', wid: 'watch-b', routineIds: ['r-push'], at: NOW - 600e3 }
    const set = { id: 't', seq: 2, type: 'setDone', wid: 'watch-b', exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8, at: NOW - 500e3 }
    expect(applyEvents([start, set], P.get, NOW)).toEqual([])
    expect(P.S.active.id).toBe('w-1')
    P.screen.finish()
    expect(applyEvents([start, set], P.get, NOW)).toEqual(['s', 't'])
    expect(P.S.active.id).toBe('watch-b')
    expect(P.S.active.entries[0].sets[0].done).toBe(true)
  })
})

describe('the Wear OS watch checking in', () => {
  it('is what Settings shows as "Last heard from the watch"', () => {
    const P = phone()
    expect(readWatchStatus()).toBeNull()
    expect(applyEvents([{ id: 'c1', seq: 1, type: 'watchStatus', version: '1.4.5', platform: 'wear', at: NOW - 5000 }], P.get, NOW)).toEqual(['c1'])
    expect(readWatchStatus()).toMatchObject({ version: '1.4.5', at: NOW - 5000, health: null })
  })
})

describe('the rest the phone starts for a set ticked on the watch', () => {
  const started = (now, total = 90) => ({ left: total, total, endsAt: now + total * 1000 })
  it('gives back the time since the tick', () => {
    expect(restLagSec(started(NOW), NOW - 30_000, NOW)).toBe(30)
    expect(restLagSec(started(NOW), NOW - 20 * 60_000, NOW)).toBe(1200)
  })
  it('leaves alone a tick heard at once, one from a clock ahead, and a rest that is not this tick\'s', () => {
    expect(restLagSec(started(NOW), NOW - 900, NOW)).toBe(0)
    expect(restLagSec(started(NOW), NOW + 60_000, NOW)).toBe(0)
    expect(restLagSec(started(NOW - 40_000), NOW - 30_000, NOW)).toBe(0)   // running since before
    expect(restLagSec({ ...started(NOW), paused: true }, NOW - 30_000, NOW)).toBe(0)
    expect(restLagSec({ ...started(NOW), ready: true }, NOW - 30_000, NOW)).toBe(0)
    expect(restLagSec(null, NOW - 30_000, NOW)).toBe(0)
    expect(restLagSec(started(NOW), null, NOW)).toBe(0)
  })
})
