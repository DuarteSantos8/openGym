// @vitest-environment happy-dom
// The Garmin link end to end, both ends in code (nobody here has a Garmin, and Garmin's simulator
// cannot talk to a phone app): the page's real sync (lib/watch-sync.js, lib/garmin-snapshot.js)
// against the watch's sync as JavaScript (garmin/test/watch-model.mjs, a port of Core.mc and
// App.mc's Link that garmin-contract.test.js holds to the Monkey C), with what sits between them
// modelled on the native bridge (android/app/src/ciq GarminLink.java, GarminMessages.java and the
// queue file of WatchEventQueue.java):
//
//   watch --transmit--> Garmin Connect --broadcast--> GarminLink --> queue file --drain--> page
//   watch <--message--- Garmin Connect <--sendMessage-- GarminLink <--sendSnapshot({garmin})-- page
//
// What can go wrong in between is switched on per test: the watch out of range (transmit fails),
// openGym's process dead (Garmin Connect takes the message, nobody hears it), a transmit that
// never calls back, an ack that never arrives, a restart of either side mid-queue.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./health-sync.js', () => ({ loadHealth: async () => ({ on: false }), onHealthChange: () => () => {} }))

import { startWatchSync, bindWatchActions, bindWatchAppActions, patchSetIn, applyRestStep, watchTickRest, restAtFor, _setWatchPluginForTest, _resetWatchSync } from './watch-sync.js'
import { buildCombinedEntries } from './session-merge.js'
import { GARMIN_MAX_BYTES, GARMIN_ACKED_MAX } from './garmin-snapshot.js'
import { GarminWatch, BATCH, MAX, HARD } from '../../garmin/test/watch-model.mjs'

const clone = v => JSON.parse(JSON.stringify(v))
const T0 = Date.UTC(2026, 10, 11, 9, 0, 0)   // a Wednesday morning

// GarminMessages.toMonkey (and GarminLink.monkey on the iPhone): maps and lists, nulls left out.
const toMonkey = json => {
  const strip = v => (Array.isArray(v) ? v.filter(x => x != null).map(strip)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x != null).map(([k, x]) => [k, strip(x)])) : v)
  return strip(JSON.parse(json))
}
// What the Connect IQ SDK would put on the wire for it, generously: a type byte and up to 8 bytes
// per value, every string in full with its length and a terminator plus a 4-byte reference.
const wireBytes = v => {
  if (Array.isArray(v)) return 5 + v.reduce((n, x) => n + wireBytes(x), 0)
  if (v && typeof v === 'object') return 5 + Object.entries(v).reduce((n, [k, x]) => n + wireBytes(k) + wireBytes(x), 0)
  if (typeof v === 'string') return 5 + 3 + new TextEncoder().encode(v).length
  return 9
}

const ROUTINES = [
  { id: 'r-push', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 8 }, { id: '0001', sets: 2, reps: 10 }, { id: '0003', sets: 2, reps: 12 }] },
  { id: 'r-pull', name: 'Pull', ex: [{ id: '0027', sets: 2, reps: 10 }] },
]
const week = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, 'r-push']))
const S0 = () => ({ unit: 'kg', restSec: 90, workouts: [], routines: clone(ROUTINES), week, dayPlan: {}, queue: { ids: [] }, active: null })

function world (S = S0()) {
  const w = {
    inRange: true,        // Bluetooth between the watch and the phone
    alive: false,         // openGym's process on the phone: GarminLink only hears while it lives
    swallow: 0,           // transmits that never call back at all
    ackFails: 0,          // the page's ack to the queue file fails (the app died right then)
    queue: [],            // the queue file: survives the process
    last: null,           // GarminLink.lastSnapshot: gone with the process
    toWatch: [],          // every snapshot that reached the watch
    transmits: [],        // every message the watch put on the radio
    setDone: [],          // every tick the workout screen applied, as "exId/setIdx"
    starts: 0, finishes: 0, discards: 0,
    listeners: {},
  }
  let seq = 0
  let st = { S, ready: true }
  const subs = new Set()
  const store = {
    // (update: the page gives every row its id, `sid`, through it)
    getState: () => ({ ...st, saveNow: async () => {}, update: fn => update(fn) }),
    subscribe: fn => { subs.add(fn); return () => subs.delete(fn) },
  }
  const update = mut => { const prev = { ...st, saveNow: async () => {} }; const S2 = clone(st.S); mut(S2); st = { ...st, S: S2 }; subs.forEach(fn => fn({ ...st, saveNow: async () => {} }, prev)) }
  // The phone's rest timer, by store/useUI.js's rules (the parts the watch link touches; the same
  // as lib/watch-sim.js's). w.restSec > 0: the phone starts a rest for every tick, as it does.
  const uiSubs = new Set()
  w.timer = null
  w.restSec = 0
  const setTimer = t => { const prev = { timer: w.timer }; w.timer = t; for (const f of [...uiSubs]) f({ timer: t }, prev) }
  const leftOf = endsAt => Math.max(1, Math.round((endsAt - Date.now()) / 1000))
  const timerActions = {
    startRest (sec) { setTimer(sec > 0 ? { left: sec, total: sec, endsAt: Date.now() + sec * 1000 } : null) },
    stopRest () { if (w.timer) setTimer(null) },
    skipRest () { if (w.timer) setTimer(null) },
    addRest (sec) {
      const t = w.timer
      if (!t || t.ready || t.paused) return
      const endsAt = t.endsAt + sec * 1000
      if (endsAt <= Date.now()) { timerActions.skipRest(); return }
      setTimer({ ...t, endsAt, left: leftOf(endsAt), total: Math.max(t.total, leftOf(endsAt)) })
    },
    pauseRest () { const t = w.timer; if (t && !t.ready && !t.paused) setTimer({ ...t, paused: true, left: leftOf(t.endsAt) }) },
    resumeRest () { const t = w.timer; if (t?.paused) { const { paused, ...rest } = t; setTimer({ ...rest, endsAt: Date.now() + t.left * 1000 }) } },
    alignRest (endsAt) {
      if (!(endsAt > Date.now() + 500)) { timerActions.stopRest(); return }
      const t = w.timer && !w.timer.ready ? w.timer : null
      const { paused, ...rest } = t || {}
      setTimer({ ...rest, endsAt, left: leftOf(endsAt), total: Math.max(t?.total || 0, leftOf(endsAt)) })
    },
    putRest (tm) { setTimer(tm && !tm.ready ? clone(tm) : null) },
  }
  const ui = { getState: () => ({ timer: w.timer, ...timerActions }), subscribe: fn => { uiSubs.add(fn); return () => uiSubs.delete(fn) } }
  w.ui = timerActions
  const fire = name => { for (const fn of w.listeners[name] || []) fn({}) }

  // phone → watch
  const deliver = snap => { if (w.inRange) setTimeout(() => { if (!w.inRange) return; w.toWatch.push(snap); w.watch.onPhone(clone(snap)) }, 300) }
  // watch → phone (GarminLink.onMessage)
  const onMessage = msg => {
    const evs = (Array.isArray(msg?.events) ? msg.events : []).filter(e => e && typeof e.id === 'string' && e.id)
    if (evs.some(e => e.type === 'hello')) { if (w.last) deliver(w.last); fire('watchState') }
    let any = false
    for (const e of evs) {
      if (e.type === 'hello' || w.queue.some(r => r.event.id === e.id)) continue
      w.queue.push({ seq: e.at > 0 ? e.at : ++seq, event: e })
      w.queue = w.queue.map((r, i) => [r, i]).sort((a, b) => a[0].seq - b[0].seq || a[1] - b[1]).map(x => x[0])
      any = true
    }
    if (any) fire('watchEvent')
  }
  const radio = {
    transmit (msg, l) {
      w.transmits.push(clone(msg))
      // a Connect IQ message is small: the phone's Garmin Connect has no trouble with four events
      expect(msg.events.length).toBeLessThanOrEqual(BATCH)
      if (w.swallow > 0) { w.swallow -= 1; return }
      const copy = clone(msg)
      setTimeout(() => {
        if (!w.inRange) return l.onError()
        l.onComplete()                 // Garmin Connect took it …
        if (w.alive) onMessage(copy)   // … and only a living openGym hears it
      }, 300)
    },
  }
  const bridge = {
    status: async () => ({ supported: true, activated: true, paired: true, installed: true, reachable: w.inRange, garmin: true }),
    sendSnapshot: async ({ garmin }) => {
      if (garmin) {
        expect(new TextEncoder().encode(garmin).length).toBeLessThanOrEqual(GARMIN_MAX_BYTES)
        w.last = toMonkey(garmin)
        expect(wireBytes(w.last)).toBeLessThan(16384)
        deliver(w.last)
      }
      return { sent: true }
    },
    drain: async () => ({ events: w.queue.map(r => clone(r.event)) }),
    ack: async ({ ids }) => { if (w.ackFails > 0) { w.ackFails -= 1; throw new Error('gone') } w.queue = w.queue.filter(r => !ids.includes(r.event.id)) },
    addListener: async (name, fn) => { (w.listeners[name] ||= new Set()).add(fn); return { remove: () => w.listeners[name].delete(fn) } },
    sendClips: async () => ({}), dropClips: async () => ({}), openOnWatch: async () => ({ ok: true }),
  }

  // the app (App.jsx bindWatchAppActions) and the workout screen (Workout.jsx bindWatchActions), in short
  const screen = {
    setDone: (idx, i, { w: kg, r, at, hr, restEnd }) => {
      const wid = st.S.active.id
      const was = st.S.active.entries[idx].sets[i]
      const before = w.timer
      // the rest the watch started for it (Workout.jsx: watchTickRest, applyRestStep)
      const restFor = () => { if (restEnd !== undefined) applyRestStep(ui, watchTickRest({ before, timer: w.timer, at, restEnd, restAt: restAtFor(wid) }), { wid, at: at || Date.now() }) }
      if (was.done && at && Number(was.at) > at) { restFor(); return }   // the later tick wins
      update(s => {
        const set = s.active.entries[idx].sets[i]
        w.setDone.push(s.active.entries[idx].id + '/' + i)
        Object.assign(set, { done: true, ...(kg != null ? { w: kg } : {}), ...(r != null ? { r } : {}), ...(at ? { at } : {}), ...(hr ? { hr } : {}) })
      })
      if (!was.done && w.restSec > 0) timerActions.startRest(w.restSec)
      restFor()
    },
    finish: () => { w.finishes += 1; update(s => { s.workouts.push({ ...s.active, end: Date.now() }); s.active = null }) },
    discard: () => { w.discards += 1; update(s => { s.active = null }) },
  }
  const appActions = {
    start: (ids, { id, start }) => { w.starts += 1; update(s => { s.active = { id, start, cur: 0, name: 'Push', entries: clone(buildCombinedEntries(s, ids).entries) } }) },
    patchSet: (where, fields, opts = {}) => update(s => { patchSetIn(s, where, fields, null, opts) }),
    openWorkout: () => {},
  }
  let stop = null
  let unbind = []
  Object.assign(w, {
    S: () => st.S,
    update,
    /** openGym starts on the phone (and its page with it). */
    async launch () {
      _resetWatchSync()
      _setWatchPluginForTest(bridge, () => store.getState())
      w.alive = true
      stop = await startWatchSync({ useStore: store, useUI: ui })
      unbind = [bindWatchAppActions(appActions), bindWatchActions(screen)]
      await vi.advanceTimersByTimeAsync(1000)
    },
    /** Android kills the app: the page, GarminLink and its last snapshot are gone, the queue file stays. */
    kill () { stop?.(); unbind.forEach(fn => fn()); w.alive = false; w.last = null; w.listeners = {}; _resetWatchSync() },
    /** The watch back in reach: GarminLink sends the last snapshot again (onDevice CONNECTED). */
    reconnect () { w.inRange = true; if (w.alive && w.last) deliver(w.last) },
    /** `sec` seconds pass: the watch's once-a-second tick runs each of them. */
    async run (sec) { for (let i = 0; i < sec; i++) { w.watch.second(); await vi.advanceTimersByTimeAsync(1000) } },
    /** `skew`: how far the watch's clock is ahead of the phone's (ms). */
    newWatch (stored = null, skew = 0) { w.watch = new GarminWatch({ radio, stored, now: () => Date.now() + skew }).launch(); return w.watch },
    /** The phone starts today's routine (Start on the phone). */
    startOnPhone () { update(s => { s.active = { id: 'w-phone', start: Date.now(), cur: 0, name: 'Push', entries: clone(buildCombinedEntries(s, ['r-push']).entries) } }) },
    done: () => (st.S.active || st.S.workouts.at(-1)).entries.flatMap(e => e.sets.filter(x => x.done).map(() => e.id)),
  })
  w.newWatch()
  return w
}

beforeEach(() => { localStorage.clear(); _resetWatchSync(); vi.useFakeTimers(); vi.setSystemTime(T0) })
afterEach(() => { _resetWatchSync(); vi.useRealTimers() })

describe('pairing: the first hello', () => {
  it('a watch app opened next to a running openGym gets today\'s routine at once', async () => {
    const w = world()
    expect(w.watch.s.sy).toBe(false)
    await w.launch()
    await w.run(2)
    expect(w.transmits[0].events[0]).toMatchObject({ type: 'hello' })
    expect(w.watch.s.sy).toBe(true)
    expect(w.watch.ask).toBe(false)
    expect(w.watch.s.rd.today).toMatchObject({ name: 'Push', routineIds: ['r-push'] })
    expect(w.watch.s.rd.today.entries.map(e => e.id)).toEqual(['0025', '0001', '0003'])
    // by name only: the watch asks the phone to start these
    expect(w.watch.s.rd.others).toEqual([{ routineIds: ['r-pull'], name: 'Pull', entries: [] }])
    // nothing null went over the link, and the hello was never queued for the page
    expect(JSON.stringify(w.toWatch)).not.toContain('null')
    expect(w.queue).toEqual([])
  })

  it('openGym not running: the hello goes nowhere, and the watch asks again until it is heard', async () => {
    const w = world()
    await w.run(5)
    expect(w.watch.s.sy).toBe(false)
    expect(w.transmits).toHaveLength(1)
    // again after a minute, then after two more, four more … (never a storm)
    await w.run(60)
    expect(w.transmits.length).toBe(2)
    await w.run(60)
    expect(w.transmits.length).toBe(2)
    await w.run(65)
    expect(w.transmits.length).toBe(3)
    await w.launch()
    await w.run(3)
    // (the page sends by itself when it starts; the next hello would have fetched it too)
    expect(w.watch.s.sy).toBe(true)
    await w.run(600)
    expect(w.transmits.length).toBe(3)   // answered: no more asking
  })

  it('a phone that never answers (no openGym with the Garmin link on it) does not cost the watch its battery', async () => {
    const w = world()
    // a workout's worth of sets that Garmin Connect took and nobody heard
    for (let i = 0; i < 20; i++) w.watch.send({ id: 'x' + i, type: 'setDone', wid: 'w', exId: 'e' + i, setIdx: 0, at: Date.now() })
    await w.run(10)
    expect(w.watch.unsent()).toBe(0)
    const before = w.transmits.length
    await w.run(3600)
    // an hour with the app open: a handful of rounds, each one later than the last
    // (every minute, it was 300 messages an hour for these 20 sets)
    expect(w.transmits.length - before).toBeLessThan(60)
    expect(w.watch.s.ob).toHaveLength(20)   // and nothing was let go of
    // the day openGym answers, everything goes at once
    await w.launch()
    await w.run(5)
    expect(w.watch.s.ob).toEqual([])
    expect(w.watch.quiet).toBe(0)
  })

  it('the watch out of range when its app opens: asked again once it is back', async () => {
    const w = world()
    w.inRange = false
    await w.launch()
    await w.run(10)
    expect(w.watch.s.sy).toBe(false)
    w.reconnect()
    await w.run(3)
    // the phone had its snapshot ready and sent it when the watch connected
    expect(w.watch.s.sy).toBe(true)
  })

  it('the app relaunched on the phone has nothing kept yet: a hello makes the page send again', async () => {
    const w = world()
    await w.launch()
    await w.run(2)
    w.kill()
    w.alive = true   // the process is back (the plugin loaded), the page not yet sending
    _setWatchPluginForTest(null)
    const before = w.toWatch.length
    w.newWatch(w.watch.stored())
    await w.run(2)
    expect(w.toWatch.length).toBe(before)   // nothing to answer with
    await w.launch()
    await w.run(2)
    expect(w.toWatch.length).toBeGreaterThan(before)
  })
})

describe('a workout from the phone, logged on the watch', () => {
  it('each set lands once, with the watch\'s numbers and heart rate, and leaves the outbox when the phone names it', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone()
    await w.run(2)
    expect(w.watch.s.w).toMatchObject({ id: 'w-phone', count: 3, progress: [0, 7] })
    // the window: the exercise up now and the next
    expect(w.watch.entries().map(e => [e.id, e.i])).toEqual([['0025', 0], ['0001', 1]])
    const ev = w.watch.tick(0, 0, 62.5, 7, { hr: [128, 141] })
    expect(w.watch.waiting()).toBe(1)
    await w.run(3)
    // at: the tick's time on the phone's clock (the watch takes the link's 300 ms for its offset)
    expect(w.S().active.entries[0].sets[0]).toMatchObject({ done: true, w: 62.5, r: 7, at: ev.at - ev.off, hr: { avg: 128, max: 141 } })
    expect(ev.off).toBe(300)
    expect(w.setDone).toEqual(['0025/0'])
    expect(w.watch.s.ob).toEqual([])
    expect(w.watch.waiting()).toBe(0)
    expect(w.queue).toEqual([])
    expect(w.watch.s.w.progress).toEqual([1, 7])
  })

  it('offline: sets logged with the phone out of reach drain later, in order, each once', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone()
    await w.run(2)
    w.inRange = false
    const ids = []
    for (let i = 0; i < 5; i++) { ids.push(w.watch.tickNext({ r: 8 - i }).id); await w.run(40) }
    // the window had two exercises: 3 + 2 sets, then the watch waits for the phone
    expect(w.watch.tickNext()).toBe(null)
    expect(w.watch.hasMore()).toBe(true)
    expect(w.watch.unsent()).toBe(5)
    expect(w.setDone).toEqual([])
    w.reconnect()
    await w.run(45)
    expect(w.setDone).toEqual(['0025/0', '0025/1', '0025/2', '0001/0', '0001/1'])
    expect(w.S().active.entries[0].sets.map(s => s.r)).toEqual([8, 7, 6])
    expect(w.watch.s.ob).toEqual([])
    // the phone moved the window on: the third exercise is on the watch now
    expect(w.watch.entries().map(e => e.id)).toContain('0003')
    expect(w.watch.s.w.progress).toEqual([5, 7])
    // sent again while unconfirmed, applied once
    expect(new Set(w.transmits.flatMap(m => m.events).filter(e => e.type === 'setDone').map(e => e.id))).toEqual(new Set(ids))
  })

  it('more sets waiting than fit in one message, and more than the phone names at once', async () => {
    const big = S0()
    big.routines[0].ex = Array.from({ length: 6 }, (_, i) => ({ id: ['0025', '0001', '0003', '0027', '0030', '0031'][i], sets: 5, reps: 8 }))
    const w = world(big)
    await w.launch()
    // started on the watch from today's routine, so it has all 30 sets with the phone away
    await w.run(2)
    w.inRange = false
    w.watch.start(w.watch.s.rd.today)
    let n = 0
    while (w.watch.tickNext()) { n += 1; await w.run(2) }
    w.watch.finish()
    expect(n).toBe(30)
    expect(w.watch.s.ob).toHaveLength(32)
    expect(GARMIN_ACKED_MAX).toBeLessThan(32)
    w.reconnect()
    await w.run(60)
    expect(w.starts).toBe(1)
    expect(w.finishes).toBe(1)
    expect(w.setDone).toHaveLength(30)
    expect(new Set(w.setDone).size).toBe(30)
    expect(w.S().active).toBe(null)
    expect(w.S().workouts[0].entries.every(e => e.sets.every(s => s.done))).toBe(true)
    // every message was small, and the watch let go of everything within the minute
    expect(w.watch.s.ob).toEqual([])
    expect(w.queue).toEqual([])
    expect(w.watch.s.w).toBe(null)
  })

  it('the phone\'s answer naming the applied events is lost: sent again, named again, applied once', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone()
    await w.run(2)
    w.watch.tick(0, 0, 60, 8)
    // the event is on its way (300 ms); the watch walks off before the answer comes back
    await vi.advanceTimersByTimeAsync(400)
    w.inRange = false
    await w.run(10)
    expect(w.setDone).toEqual(['0025/0'])
    expect(w.watch.s.ob).toHaveLength(1)
    expect(w.watch.unsent()).toBe(0)   // sent, not confirmed
    // back in reach, and (the worst case) Garmin Connect never says so: no connect event, so
    // nothing makes the bridge send its last snapshot again
    w.inRange = true
    await w.run(70)
    expect(w.setDone).toEqual(['0025/0'])
    expect(w.watch.s.ob).toEqual([])
    expect(w.queue).toEqual([])
  })

  it('a transmit that never calls back does not stop the link for good', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone()
    await w.run(2)
    w.swallow = 1
    w.watch.tick(0, 0, 60, 8)
    w.watch.tick(0, 1, 60, 8)
    await w.run(30)
    expect(w.watch.busy).toBe(true)
    expect(w.setDone).toEqual([])
    await w.run(60)
    expect(w.setDone).toEqual(['0025/0', '0025/1'])
    expect(w.watch.s.ob).toEqual([])
  })
})

describe('either side restarting', () => {
  it('the watch app closed mid-queue and opened again: what was stored goes, nothing twice', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone()
    await w.run(2)
    w.inRange = false
    for (let i = 0; i < 5; i++) w.watch.tickNext()
    await vi.advanceTimersByTimeAsync(500)
    expect(w.watch.unsent()).toBe(5)
    w.inRange = true
    // the first message of four is out and marked sent; the app closes before the fifth event
    // is through and before the phone has named anything
    await vi.advanceTimersByTimeAsync(31000)
    w.watch.second()
    await vi.advanceTimersByTimeAsync(350)
    expect(w.watch.s.obn).toBe(4)
    const stored = w.watch.stored()
    expect(stored.ob).toHaveLength(5)
    // (only the outbox is stored after a send: the count of sent ones on disk is the older one)
    expect(stored.s.obn).toBe(0)
    w.newWatch(stored)
    expect(w.watch.s.w.id).toBe('w-phone')
    await w.run(70)
    expect(w.setDone).toEqual(['0025/0', '0025/1', '0025/2', '0001/0', '0001/1'])
    expect(w.watch.s.ob).toEqual([])
  })

  it('openGym killed on the phone while the watch logs: Garmin Connect takes the sets, nobody hears, they come again', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone()
    await w.run(2)
    w.kill()
    w.watch.tick(0, 0, 60, 8)
    w.watch.tick(0, 1, 60, 8)
    await w.run(5)
    // "delivered" as far as the watch can tell, yet nothing arrived
    expect(w.watch.unsent()).toBe(0)
    expect(w.watch.s.ob).toHaveLength(2)
    expect(w.queue).toEqual([])
    // the lifter sees it: two sets waiting
    expect(w.watch.waiting()).toBe(2)
    await w.run(10)
    // openGym is opened again: its first snapshot tells the watch it is there, and what the watch
    // had "sent" to nobody goes again at once, not at the next minute
    await w.launch()
    await w.run(4)
    expect(w.setDone).toEqual(['0025/0', '0025/1'])
    expect(w.watch.s.ob).toEqual([])
  })

  it('openGym killed mid-drain, after applying and before the queue file heard: not applied a second time', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone()
    await w.run(2)
    w.ackFails = 1
    w.watch.tick(0, 0, 60, 8)
    await w.run(2)
    expect(w.setDone).toEqual(['0025/0'])
    expect(w.queue).toHaveLength(1)   // still in the file
    w.kill()
    await w.launch()
    await w.run(5)
    expect(w.setDone).toEqual(['0025/0'])
    expect(w.queue).toEqual([])
    expect(w.watch.s.ob).toEqual([])
  })
})

describe('ending the workout', () => {
  it('finished on the watch with the phone away: start, sets and finish arrive in that order', async () => {
    const w = world()
    await w.launch()
    await w.run(2)
    w.inRange = false
    const start = w.watch.start(w.watch.s.rd.today)
    await w.run(3)
    for (let i = 0; i < 7; i++) { w.watch.tickNext(); await w.run(3) }
    w.watch.finish()
    w.reconnect()
    await w.run(30)
    expect([w.starts, w.setDone.length, w.finishes]).toEqual([1, 7, 1])
    const saved = w.S().workouts[0]
    expect(saved.id).toBe(start.wid)
    expect(saved.start).toBe(start.at)
    expect(saved.entries.flatMap(e => e.sets.map(s => s.done))).toEqual(Array(7).fill(true))
    expect(w.S().active).toBe(null)
    expect(w.watch.s.w).toBe(null)
    expect(w.watch.s.ob).toEqual([])
  })

  it('finished on the phone while the watch still holds sets: the summary comes up, the sets land in the saved workout', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone()
    await w.run(2)
    w.inRange = false
    w.watch.tick(0, 0, 61, 9)
    w.watch.tick(0, 1, 61, 8)
    await w.run(2)
    // the phone finishes without knowing of them
    w.update(s => { s.workouts.push({ ...s.active, end: Date.now() }); s.active = null })
    await w.run(2)
    w.reconnect()
    await w.run(40)
    expect(w.watch.ended).toMatchObject({ ended: true })
    expect(w.watch.s.w).toBe(null)
    const saved = w.S().workouts[0]
    expect(saved.entries[0].sets.slice(0, 2)).toMatchObject([{ done: true, w: 61, r: 9 }, { done: true, w: 61, r: 8 }])
    expect(w.watch.s.ob).toEqual([])
    expect(w.S().active).toBe(null)
  })

  it('discarded on the watch: the phone drops it, and a stale snapshot does not bring it back', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone()
    await w.run(2)
    w.watch.tick(0, 0, 60, 8)
    w.watch.finish(true)
    // the snapshot of the tick is still on its way: it shows the workout the watch just ended
    await w.run(5)
    expect(w.discards).toBe(1)
    expect(w.S().active).toBe(null)
    expect(w.S().workouts).toEqual([])
    expect(w.watch.s.w).toBe(null)
    expect(w.watch.s.ob).toEqual([])
  })

  it('started on the watch while the phone runs another workout: the watch keeps its own, the phone takes it after', async () => {
    const w = world()
    await w.launch()
    await w.run(2)
    w.startOnPhone()
    // the watch has not heard yet and starts today's routine itself
    w.inRange = false
    const start = w.watch.start(w.watch.s.rd.today)
    w.watch.tick(0, 0, 60, 8)
    w.reconnect()
    await w.run(10)
    expect(w.watch.s.w.id).toBe(start.wid)   // not replaced by the phone's
    expect(w.S().active.id).toBe('w-phone')
    expect(w.starts).toBe(0)
    // the phone's workout is discarded there: now the watch's one starts, with its set
    w.update(s => { s.active = null })
    await w.run(70)
    expect(w.starts).toBe(1)
    expect(w.S().active.id).toBe(start.wid)
    expect(w.setDone).toEqual(['0025/0'])
    expect(w.watch.s.ob).toEqual([])
  })
})

describe('both sides changing the same set', () => {
  it('ticked on the watch, then changed on the phone: the phone\'s later copy wins on both', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone()
    await w.run(2)
    w.inRange = false
    const ev = w.watch.tick(0, 0, 60, 8)
    await w.run(5)
    // the lifter logs the same set on the phone a little later, with other numbers
    w.update(s => { Object.assign(s.active.entries[0].sets[0], { done: true, w: 65, r: 5, at: ev.at + 4000 }) })
    w.reconnect()
    await w.run(40)
    expect(w.S().active.entries[0].sets[0]).toMatchObject({ w: 65, r: 5 })
    expect(w.setDone).toEqual([])   // the older tick changed nothing
    expect(w.watch.entryAt(0).sets[0]).toMatchObject({ done: true, w: 65, r: 5 })
    expect(w.watch.s.p).toEqual({})
    expect(w.watch.s.ob).toEqual([])
  })

  it('a set fixed on the watch after the phone has it: the fix is later, so it wins', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone()
    await w.run(2)
    w.watch.tick(0, 0, 60, 8)
    await w.run(3)
    const fix = w.watch.fix(0, 0, 62.5, 6)
    expect(fix.at).toBeGreaterThan(w.S().active.entries[0].sets[0].at)
    expect(fix.hr).toBeUndefined()
    await w.run(3)
    expect(w.S().active.entries[0].sets[0]).toMatchObject({ done: true, w: 62.5, r: 6 })
    expect(w.setDone).toEqual(['0025/0', '0025/0'])
    expect(w.watch.s.ob).toEqual([])
  })

  it('a snapshot that arrives while a set is logged here does not undo it', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone()
    await w.run(2)
    // the phone changes something else (a set of the next exercise) twice: the first goes at once,
    // the second waits out the 400 ms after it and is on the way …
    w.update(s => { s.active.entries[1].sets[0].w = 10 })
    await vi.advanceTimersByTimeAsync(50)
    w.update(s => { s.active.entries[1].sets[0].w = 12.5 })
    // (the first has landed, the second left at 400 ms and takes 300 ms to get there)
    await vi.advanceTimersByTimeAsync(450)
    // … while the watch ticks, before that snapshot lands
    const before = w.toWatch.length
    w.watch.tick(0, 0, 60, 8)
    await vi.advanceTimersByTimeAsync(250)
    expect(w.toWatch.length).toBe(before + 1)
    // the snapshot was made before the tick: it shows the set open
    expect(w.toWatch.at(-1).active.entries[0].sets[0].done).toBe(false)
    expect(w.watch.entryAt(0).sets[0]).toMatchObject({ done: true, w: 60, r: 8 })
    expect(w.watch.entryAt(1).sets[0].w).toBe(12.5)
    await w.run(3)
    expect(w.S().active.entries[0].sets[0]).toMatchObject({ done: true, w: 60, r: 8 })
    expect(w.watch.s.p).toEqual({})
  })
})

describe('limits', () => {
  it('the outbox of a watch the phone never answers stays bounded, a workout\'s start kept longest', async () => {
    const w = world()
    await w.launch()
    await w.run(2)
    // openGym gone for good (uninstalled, or a phone app without the Garmin link): Garmin Connect
    // takes every message, so they count as sent and the oldest go first
    w.kill()
    w.watch.start(w.watch.s.rd.today)
    for (let i = 0; i < 150; i++) { w.watch.send({ id: 'x' + i, type: 'setDone', wid: 'w', at: Date.now() }); await w.run(1) }
    expect(w.watch.s.ob.length).toBeLessThanOrEqual(MAX)
    // out of range instead: nothing is ever sent, the outbox grows to its hard end and stays there
    const v = world()
    v.inRange = false
    v.watch.send({ id: 'st', type: 'start', wid: 'w', at: 1 })
    for (let i = 0; i < 150; i++) v.watch.send({ id: 'y' + i, type: 'setDone', wid: 'w', at: 2 })
    expect(v.watch.s.ob).toHaveLength(HARD)
    expect(unpackId(v.watch.s.ob[0])).toBe('st')
    expect(unpackId(v.watch.s.ob.at(-1))).toBe('y149')
  })

  it('the biggest workout still fits a Connect IQ message, and the watch can go on from it', async () => {
    const big = S0()
    const ids = ['0025', '0001', '0003', '0027', '0030', '0031', '0032', '0033', '0034', '0035', '0036', '0037']
    big.routines = [{ id: 'r-push', name: 'A very long routine name that goes on and on and on', ex: ids.map(id => ({ id, sets: 8, reps: 12 })) },
      ...Array.from({ length: 12 }, (_, i) => ({ id: 'r' + i, name: 'Routine number ' + i + ' with a long name', ex: [{ id: '0025', sets: 3, reps: 8 }] }))]
    const w = world(big)
    await w.launch()
    await w.run(2)
    // (sendSnapshot above checks every snapshot: at most 4 KB as JSON, far under 16384 on the wire)
    expect(w.watch.s.rd.today.name).toContain('A very long routine name')
    w.startOnPhone()
    await w.run(2)
    expect(w.watch.s.w.count).toBe(12)
    expect(w.watch.entries().length).toBeGreaterThanOrEqual(1)
    expect(w.watch.tickNext()).not.toBe(null)
    await w.run(3)
    expect(w.setDone).toHaveLength(1)
  })
})

const unpackId = ev => (Array.isArray(ev) ? ev[0] : ev.id)

describe('one rest, the two clocks, set ids (protocol 2, docs/WATCH_SYNC.md)', () => {
  // the phone's rest end against the watch's, both on the phone's clock
  const apart = w => Math.abs(w.timer.endsAt - (w.watch.s.rest - w.watch.off()))

  it('a rest started on the watch is the phone\'s: +15 and -15 there move it, Skip there ends it', async () => {
    const w = world()
    w.restSec = 120   // the phone's own rule would start a longer one
    await w.launch()
    w.startOnPhone()
    await w.run(2)
    // every row has its id, and the watch names the set by it
    expect(w.watch.entries()[0].sets.every(x => typeof x.sid === 'string')).toBe(true)
    const ev = w.watch.tick(0, 0, 60, 8, { rest: 90 })
    expect(ev).toMatchObject({ sid: w.watch.entries()[0].sets[0].sid, restEnd: ev.at + 90000 })
    await w.run(2)
    expect(w.setDone).toEqual(['0025/0'])
    expect(apart(w)).toBeLessThan(1000)
    w.watch.addRest(15)
    await w.run(2)
    expect(apart(w)).toBeLessThan(1000)
    w.watch.addRest(15)   // twice within the same second: both count
    await w.run(2)
    expect(apart(w)).toBeLessThan(1000)
    expect(w.timer.endsAt - Date.now()).toBeGreaterThan(110000)
    w.watch.addRest(-15)
    await w.run(2)
    expect(apart(w)).toBeLessThan(1000)
    const end = w.watch.s.rest
    // the snapshots that came back in between never moved the watch's own rest
    await w.run(5)
    expect(w.watch.s.rest).toBe(end)
    w.watch.skipRest()
    await w.run(2)
    expect(w.timer).toBe(null)
    expect(w.watch.s.rest).toBe(null)
    // the phone's snapshot of it, sent again (a reconnect), brings nothing back
    w.reconnect()
    await w.run(2)
    expect(w.watch.s.rest).toBe(null)
    expect(w.queue).toEqual([])
  })

  it('Skip on the phone ends the watch\'s rest, a pause there holds it, +15 there moves it (#1149)', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone()
    await w.run(2)
    w.watch.tick(0, 0, 60, 8, { rest: 90 })
    await w.run(3)
    w.ui.skipRest()
    await w.run(2)
    expect(w.watch.s.rest).toBe(null)
    expect(w.watch.rx).toBe(true)
    w.watch.tick(0, 1, 60, 8, { rest: 90 })
    await w.run(3)
    w.ui.pauseRest()
    await w.run(2)
    expect(w.watch.s.rest).toBe(null)
    expect(w.watch.restLeft()).toBe(w.timer.left)
    // held: the seconds do not run on the watch either
    await w.run(10)
    expect(w.watch.restLeft()).toBe(w.timer.left)
    w.ui.resumeRest()
    await w.run(2)
    expect(apart(w)).toBeLessThan(1000)
    w.ui.addRest(15)
    await w.run(2)
    expect(apart(w)).toBeLessThan(1000)
  })

  it('a watch 90 s ahead (or behind) of the phone: the rest still ends together, and the set is stamped in the phone\'s time', async () => {
    for (const skew of [90000, -90000, 3000]) {
      localStorage.clear()
      _resetWatchSync()
      const w = world()
      await w.launch()
      w.newWatch(null, skew)
      w.startOnPhone()
      await w.run(3)
      expect(Math.abs(w.watch.off() - skew)).toBeLessThan(1000)
      const ev = w.watch.tick(0, 0, 60, 8, { rest: 60 })
      await w.run(3)
      expect(Math.abs(w.timer.endsAt - (Date.now() - 3000 + 60000))).toBeLessThan(1500)
      expect(Math.abs(w.S().active.entries[0].sets[0].at - (ev.at - skew))).toBeLessThan(1000)
      // a fix of that set is later on the phone's clock, so it wins there
      const fix = w.watch.fix(0, 0, 62.5, 8)
      await w.run(3)
      expect(w.S().active.entries[0].sets[0].w).toBe(62.5)
      expect(fix.at - fix.off).toBeGreaterThan(ev.at - ev.off)
      w.kill()
    }
  })

  it('a long workout logged offline drains without the watch jumping back to an exercise it has done', async () => {
    const big = S0()
    big.routines[0].ex = [{ id: '0025', sets: 5, reps: 8 }, { id: '0001', sets: 2, reps: 10 }, { id: '0003', sets: 3, reps: 12 }, { id: '0027', sets: 3, reps: 10 }]
    const w = world(big)
    await w.launch()
    await w.run(2)
    // started on the watch with the phone away: it has the whole routine, the phone none of it yet
    w.inRange = false
    w.watch.start(w.watch.s.rd.today)
    for (let i = 0; i < 8; i++) { w.watch.tickNext({ rest: 0 }); await w.run(1) }
    expect(w.watch.entryAt(w.watch.s.pos).id).toBe('0003')
    expect(w.watch.waiting()).toBe(8)
    w.reconnect()
    const seen = []
    for (let i = 0; i < 120; i++) { await w.run(1); seen.push(w.watch.entryAt(w.watch.s.pos)?.id) }
    expect(w.watch.waiting()).toBe(0)
    expect(w.setDone).toHaveLength(8)
    // the phone's window followed what it had applied (the bench press first): the watch stayed
    // on the third exercise all along, not even a second back on one it had done
    expect(seen.filter(id => id !== '0003')).toEqual([])
    expect(w.watch.setIndex(w.watch.s.pos)).toBe(1)
  })

  it('a set ticked on the phone moves the watch on, also on another exercise', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone()
    await w.run(2)
    expect(w.watch.s.pos).toBe(0)
    // the phone ticks the sit-up's first set while the watch shows the bench press
    w.update(s => { Object.assign(s.active.entries[1].sets[0], { done: true, at: Date.now() }) })
    await w.run(2)
    expect(w.watch.entryAt(w.watch.s.pos).id).toBe('0001')
    // its own tick, confirmed, is not one of the phone's
    w.watch.tick(1, 1, 0, 10)
    await w.run(3)
    expect(w.watch.ptick).toBe(null)
  })
})
