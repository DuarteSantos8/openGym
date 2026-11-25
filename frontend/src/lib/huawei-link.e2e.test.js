// @vitest-environment happy-dom
// The Huawei watch link end to end, both ends in the real code: the page's sync (lib/watch-sync.js:
// buildSnapshot -> huaweiSnapshot, the real event apply path) against the watch's own logic, plain
// JavaScript (watch-huawei/.../common/core.js: createCore, onPhone, pressDone, ...). Only what sits
// between them is modelled, on the native bridge (HuaweiLink.java, WatchEventQueue.java):
//
//   watch --transmit--> Wear Engine --> HuaweiLink --> queue file --drain--> page
//   watch <--onPhone--- Wear Engine <-- sendSnapshot({ huawei }) -- page
//
// What can go wrong in between is switched on per test: the watch out of range (transmit fails),
// the phone's process dead, snapshots lost on the way, a message delivered twice.
// The assertions are on the phone's state (what would be saved), not only on messages.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./health-sync.js', () => ({ loadHealth: async () => ({ on: false }), onHealthChange: () => () => {} }))

import { startWatchSync, bindWatchActions, bindWatchAppActions, patchSetIn, applyRestStep, watchTickRest, restAtFor, ensureWatchSet, ensureSetIds, _setWatchPluginForTest, _resetWatchSync } from './watch-sync.js'
import { buildCombinedEntries } from './session-merge.js'
import { logWeighIn } from './bodyweight.js'
import { withWatchForm } from './daily-form.js'
import { wireLength, HUAWEI_MAX_WIRE } from './huawei-snapshot.js'
import * as K from '../../../watch-huawei/entry/src/main/js/MainAbility/common/core.js'

const clone = v => JSON.parse(JSON.stringify(v))
const T0 = Date.UTC(2026, 10, 11, 9, 0, 0)   // a Wednesday morning

const ROUTINES = [
  { id: 'r-push', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 8 }, { id: '0001', sets: 2, reps: 10 }, { id: '0003', sets: 2, reps: 12 }] },
  { id: 'r-pull', name: 'Pull', ex: [{ id: '0027', sets: 2, reps: 10 }] },
]
const week = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, 'r-push']))
const S0 = () => ({ unit: 'kg', restSec: 90, workouts: [], routines: clone(ROUTINES), week, dayPlan: {}, queue: { ids: [] }, active: null, bodyweight: [] })

function world (S = S0()) {
  const w = {
    inRange: true,        // Bluetooth between the watch and the phone
    alive: false,         // openGym's process: HuaweiLink only hears while it lives
    lose: false,          // snapshots lost on the way to the watch
    twice: false,         // every message the watch sends reaches the phone two times
    queue: [],            // the queue file: survives the process
    last: null,           // HuaweiLink.lastSnapshot
    toWatch: [], transmits: [], setDone: [],
    starts: 0, finishes: 0, discards: 0,
    bpm: 0,               // the watch's heart-rate sensor, read once a second while set
    skew: 0, stored: null, listeners: {},
  }
  let seq = 0
  let st = { S, ready: true }
  const subs = new Set()
  const store = {
    getState: () => ({ ...st, saveNow: async () => {}, update: fn => update(fn) }),
    subscribe: fn => { subs.add(fn); return () => subs.delete(fn) },
  }
  const update = mut => { const prev = { ...st, saveNow: async () => {} }; const S2 = clone(st.S); mut(S2); ensureSetIds(S2.active); st = { ...st, S: S2 }; subs.forEach(fn => fn({ ...st, saveNow: async () => {} }, prev)) }
  const uiSubs = new Set()
  w.timer = null
  const setTimer = t => { const prev = { timer: w.timer }; w.timer = t; for (const f of [...uiSubs]) f({ timer: t }, prev) }
  const leftOf = endsAt => Math.max(1, Math.round((endsAt - Date.now()) / 1000))
  const timerActions = {
    startRest (sec) { setTimer(sec > 0 ? { left: sec, total: sec, endsAt: Date.now() + sec * 1000 } : null) },
    stopRest () { if (w.timer) setTimer(null) },
    skipRest () { if (w.timer) setTimer(null) },
    addRest (sec) { const t = w.timer; if (!t || t.ready || t.paused) return; const endsAt = t.endsAt + sec * 1000; if (endsAt <= Date.now()) { timerActions.skipRest(); return } setTimer({ ...t, endsAt, left: leftOf(endsAt), total: Math.max(t.total, leftOf(endsAt)) }) },
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
  const fire = name => { for (const fn of w.listeners[name] || []) fn({}) }

  // phone -> watch
  const deliver = snap => { if (w.inRange) setTimeout(() => { if (!w.inRange || w.lose || !w.c) return; w.toWatch.push(snap); K.onPhone(w.c, clone(snap)) }, 300) }
  // watch -> phone (HuaweiLink.onMessage, after the frames are joined)
  const onMessage = msg => {
    const evs = (Array.isArray(msg?.events) ? msg.events : []).filter(e => e && typeof e.id === 'string' && e.id && typeof e.type === 'string')
    if (evs.some(e => e.type === 'hello')) { if (w.last) deliver(w.last); fire('watchState') }
    let any = false
    for (const e of evs) {
      if (e.type === 'hello' || w.queue.some(r => r.event.id === e.id)) continue
      w.queue.push({ seq: ++seq, event: e })
      any = true
    }
    if (any) fire('watchEvent')
  }
  const radio = {
    transmit (msg, l) {
      w.transmits.push(clone(msg))
      expect(msg.events.length).toBeLessThanOrEqual(K.BATCH)
      const copy = clone(msg)
      setTimeout(() => {
        if (!w.inRange) return l.onError()
        l.onComplete()
        if (w.alive) { onMessage(copy); if (w.twice) onMessage(clone(copy)) }
      }, 300)
    },
  }
  const bridge = {
    status: async () => ({ supported: true, activated: true, paired: true, installed: true, reachable: w.inRange, huawei: true, wear: { supported: false, paired: false, installed: false, reachable: false } }),
    sendSnapshot: async ({ huawei, garmin }) => {
      expect(garmin).toBeUndefined()
      if (huawei) {
        // the frames hold 16 x 960 characters; the page keeps under 12,000 on the wire
        expect(wireLength(huawei)).toBeLessThanOrEqual(HUAWEI_MAX_WIRE)
        w.last = JSON.parse(huawei)
        deliver(w.last)
      }
      return { sent: true }
    },
    drain: async () => ({ events: w.queue.map(r => clone(r.event)) }),
    ack: async ({ ids }) => { w.queue = w.queue.filter(r => !ids.includes(r.event.id)) },
    addListener: async (name, fn) => { (w.listeners[name] ||= new Set()).add(fn); return { remove: () => w.listeners[name].delete(fn) } },
    sendClips: async () => ({}), dropClips: async () => ({}), openOnWatch: async () => ({ ok: true }),
  }

  // the workout screen (Workout.jsx bindWatchActions) and the app (App.jsx bindWatchAppActions), in short
  const screen = {
    setDone: (idx, i, { w: kg, r, at, hr, restEnd, side }) => {
      const wid = st.S.active.id
      const was = st.S.active.entries[idx].sets[i]
      const before = w.timer
      const restFor = () => { if (restEnd !== undefined) applyRestStep(ui, watchTickRest({ before, timer: w.timer, at, restEnd, restAt: restAtFor(wid) }), { wid, at: at || Date.now() }) }
      if (was.done && at && Number(was.at) > at) { restFor(); return }
      update(s => {
        const set = s.active.entries[idx].sets[i]
        w.setDone.push(s.active.entries[idx].id + '/' + i + (side ? '/' + side : ''))
        if (side && set.sides) {
          set.sides[side] = { ...set.sides[side], ...(kg != null ? { w: kg } : {}), ...(r != null ? { r } : {}), done: true }
          if (set.sides.L.done && set.sides.R.done) Object.assign(set, { done: true, r: (set.sides.L.r || 0) + (set.sides.R.r || 0), w: Math.max(set.sides.L.w || 0, set.sides.R.w || 0), ...(at ? { at } : {}) })
        } else Object.assign(set, { done: true, ...(kg != null ? { w: kg } : {}), ...(r != null ? { r } : {}), ...(at ? { at } : {}), ...(hr ? { hr } : {}) })
      })
      if (!was.done) timerActions.startRest(90)
      restFor()
    },
    finish: () => { w.finishes += 1; update(s => { s.workouts.push({ ...s.active, end: Date.now() }); s.active = null }) },
    discard: () => { w.discards += 1; update(s => { s.active = null }) },
  }
  const appActions = {
    start: (ids, { id, start, bw }) => { w.starts += 1; update(s => { s.active = { id, start, cur: 0, name: 'Push', entries: clone(buildCombinedEntries(s, ids).entries) } }) },
    weighIn: ({ w: kg, at }) => update(s => { logWeighIn(s, kg, at) }),
    dailyForm: ({ form, at }) => { const d = new Date(at).toISOString().slice(0, 10); update(s => { s.dayForm = withWatchForm(s.dayForm, d, form) || s.dayForm }) },
    patchSet: (where, fields, opts = {}) => update(s => { patchSetIn(s, where, fields, null, opts) }),
    ensureSet: (where, fields) => { let ok = false; update(s => { ok = ensureWatchSet(s, where, () => null, fields) }); return ok },
    edit: fn => { let ok = false; update(s => { ok = !!fn(s) }); return ok },
    stillHere: () => {},
    openWorkout: () => {},
  }
  let stop = null
  let unbind = []
  Object.assign(w, {
    S: () => st.S,
    update,
    async launch () {
      _resetWatchSync()
      _setWatchPluginForTest(bridge, () => store.getState())
      w.alive = true
      stop = await startWatchSync({ useStore: store, useUI: ui })
      unbind = [bindWatchAppActions(appActions), bindWatchActions(screen)]
      await vi.advanceTimersByTimeAsync(1000)
    },
    kill () { stop?.(); unbind.forEach(fn => fn()); w.alive = false; w.last = null; w.listeners = {}; _resetWatchSync() },
    reconnect () { w.inRange = true; if (w.alive && w.last) deliver(w.last) },
    /** `sec` seconds pass: the watch's tick, and its heart-rate sensor while a workout runs. */
    async run (sec) { for (let i = 0; i < sec; i++) { if (w.bpm && w.c.s.w) K.hrSample(w.c, w.bpm); K.second(w.c); await vi.advanceTimersByTimeAsync(1000) } },
    /** The watch app opens (a fresh core on what the last one saved). */
    newWatch (stored = null, skew = 0) {
      if (w.c) K.stop(w.c)
      w.skew = skew
      const env = { radio, now: () => Date.now() + w.skew, random: Math.random, save: s => { w.stored = clone(s) }, version: '0.1.0', today: () => new Date(Date.now()).toISOString().slice(0, 10) }
      w.c = K.createCore(env, stored)
      K.launch(w.c)
      return w.c
    },
    startOnPhone (S2) { update(s => { s.active = S2 || { id: 'w-phone', start: Date.now(), cur: 0, name: 'Push', entries: clone(buildCombinedEntries(s, ['r-push']).entries) } }) },
    /** Done on the watch's set page (the boxes as they stand). */
    tick (over = {}) { const cur = K.current(w.c); return K.pressDone(w.c, over.w ?? cur.row.w, over.r ?? cur.row.r) },
    doneRows: () => (st.S.active || st.S.workouts.at(-1)).entries.flatMap(e => e.sets.filter(x => x.done).map(() => e.id)),
  })
  w.newWatch()
  return w
}

beforeEach(() => { localStorage.clear(); _resetWatchSync(); vi.useFakeTimers(); vi.setSystemTime(T0) })
afterEach(() => { _resetWatchSync(); vi.useRealTimers() })

const ids = es => es.map(e => e.id)

describe('a workout from the phone, logged on the watch', () => {
  it('the whole workout is on the watch; each set lands once with its numbers, and leaves the outbox when named', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone()
    await w.run(2)
    expect(w.c.s.w).toMatchObject({ id: 'w-phone', count: 3 })
    // no window: every exercise, with its place in the workout
    expect(w.c.s.w.entries.map(e => [e.id, e.i])).toEqual([['0025', 0], ['0001', 1], ['0003', 2]])
    expect(K.hasMore(w.c.s)).toBe(false)
    expect(w.tick({ r: 7 })).toBe('tick')
    expect(K.waiting(w.c.s)).toBe(1)
    await w.run(3)
    expect(w.S().active.entries[0].sets[0]).toMatchObject({ done: true, r: 7 })
    expect(w.setDone).toEqual(['0025/0'])
    expect(w.c.s.ob).toEqual([])
    expect(K.waiting(w.c.s)).toBe(0)
    expect(w.queue).toEqual([])
    expect(w.c.s.w.progress).toEqual([1, 7])
  })

  it('a workout done in a row with the phone out of reach drains later, in order, each once', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone()
    await w.run(2)
    w.inRange = false
    for (let i = 0; i < 7; i++) { expect(w.tick()).toBe('tick'); await w.run(5) }
    expect(w.c.s.ob.length).toBeGreaterThanOrEqual(7)
    expect(w.setDone).toEqual([])
    w.reconnect()
    await w.run(120)
    expect(w.doneRows()).toEqual(['0025', '0025', '0025', '0001', '0001', '0003', '0003'])
    expect(w.setDone).toHaveLength(7)
    expect(w.c.s.ob).toEqual([])
    expect(w.queue).toEqual([])
  })
})

describe('a link that drops snapshots', () => {
  it('the phone\'s answers lost on the way: the watch sends again, the phone applies each set once and names it in the end', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone()
    await w.run(2)
    w.lose = true
    for (let i = 0; i < 3; i++) { w.tick(); await w.run(4) }
    expect(w.setDone).toHaveLength(3)
    // nothing was named: the outbox still holds them
    expect(w.c.s.ob.length).toBeGreaterThanOrEqual(3)
    w.lose = false
    await w.run(150)
    expect(w.setDone).toHaveLength(3)
    expect(w.doneRows()).toEqual(['0025', '0025', '0025'])
    expect(w.c.s.ob).toEqual([])
  })
})

describe('a workout started on the watch with the phone away', () => {
  it('sets logged at the wrist, then the phone back: its start, its sets, its finish', async () => {
    const w = world()
    await w.launch()
    await w.run(2)
    expect(w.c.s.rd.today.entries.map(e => e.id)).toEqual(['0025', '0001', '0003'])
    w.inRange = false
    const ev = K.startWorkout(w.c, w.c.s.rd.today)
    expect(ev.type).toBe('start')
    for (let i = 0; i < 4; i++) { w.tick(); await w.run(5) }
    K.finishWorkout(w.c, false)
    expect(w.S().active).toBe(null)
    w.reconnect()
    await w.run(180)
    expect(w.starts).toBe(1)
    expect(w.finishes).toBe(1)
    // what would be saved: one workout, with the four sets the wrist ticked
    expect(w.S().workouts).toHaveLength(1)
    expect(w.S().workouts[0].id).toBe(ev.wid)
    expect(w.doneRows()).toEqual(['0025', '0025', '0025', '0001'])
    expect(w.c.s.ob).toEqual([])
    expect(w.queue).toEqual([])
  })
})

describe('the set menu: add and remove', () => {
  it('a set added and a set removed on the watch are on the phone, and the watch keeps the phone\'s answer', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone()
    await w.run(2)
    const before = w.S().active.entries[0].sets.length
    const add = K.addSet(w.c, 0)
    expect(add.type).toBe('addSet')
    await w.run(4)
    expect(w.S().active.entries[0].sets).toHaveLength(before + 1)
    expect(w.S().active.entries[0].sets.at(-1).sid).toBe(add.sid)
    expect(w.c.s.w.entries[0].sets).toHaveLength(before + 1)
    // remove the second exercise's last set
    const e1 = w.c.s.w.entries[1]
    const rm = K.removeSet(w.c, 1, e1.sets.length - 1, K.setId(w.c.s, 1, e1.sets.length - 1))
    expect(rm.type).toBe('removeSet')
    await w.run(4)
    expect(w.S().active.entries[1].sets).toHaveLength(e1.sets.length)
    expect(w.c.s.w.entries[1].sets).toHaveLength(e1.sets.length)
    expect(w.c.s.ob).toEqual([])
    // the work-set total moved with both
    expect(w.c.s.w.progress[1]).toBe(7)
  })

  it('a removal the phone refuses (the set was ticked there meanwhile): the set stays, done, and the watch shows it again', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone()
    await w.run(2)
    w.inRange = false
    const gone = K.setId(w.c.s, 0, 2)
    // on the phone the set is ticked while the watch, out of reach, takes it out
    w.update(s => { Object.assign(s.active.entries[0].sets[2], { done: true, at: Date.now(), r: 8 }) })
    expect(K.removeSet(w.c, 0, 2, gone)).not.toBe(null)
    await w.run(5)
    w.reconnect()
    await w.run(60)
    expect(w.S().active.entries[0].sets).toHaveLength(3)
    expect(w.S().active.entries[0].sets[2]).toMatchObject({ done: true, sid: gone })
    // the phone's snapshot brought it back on the watch, ticked
    expect(w.c.s.w.entries[0].sets).toHaveLength(3)
    expect(w.c.s.w.entries[0].sets[2]).toMatchObject({ done: true })
    expect(w.c.s.ob).toEqual([])
  })
})

describe('heart rate', () => {
  it('a set ticked on the phone gets the watch\'s heart rate, and a rest heart rate after the rest', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone()
    await w.run(2)
    w.bpm = 120
    await w.run(10)
    // ticked on the phone: the watch, which measured, sends setHr for it
    w.update(s => { Object.assign(s.active.entries[0].sets[0], { done: true, at: Date.now(), w: 60, r: 8 }) })
    w.bpm = 130
    await w.run(30)
    const set0 = w.S().active.entries[0].sets[0]
    expect(set0.hr).toMatchObject({ avg: expect.any(Number), max: expect.any(Number) })
    expect(set0.hr.avg).toBeGreaterThanOrEqual(25)
    expect(w.c.s.ob).toEqual([])
    // a set ticked on the watch: its rest's heart rate follows once the rest is over
    w.bpm = 110
    w.tick()
    await w.run(100)
    const set1 = w.S().active.entries[0].sets[1]
    expect(set1.done).toBe(true)
    expect(set1.restHr).toBeTruthy()
    expect(w.c.s.ob).toEqual([])
  })
})

describe('before a start: check-in and weigh-in', () => {
  it('the check-in and the weigh-in asked at the wrist are on the phone, and the start carries the weight', async () => {
    const S = S0()
    S.dailyForm = true
    const w = world(S)
    await w.launch()
    await w.run(2)
    expect(w.c.s.set.checkin).toBe(true)
    expect(K.startFlow(w.c, w.c.s.rd.today)).toBe('checkin')
    K.checkinAnswer(w.c, 4); K.checkinAnswer(w.c, 3)
    expect(K.checkinAnswer(w.c, 2)).toBe('weighin')
    K.weighInSet(w.c, 81.4)
    expect(K.weighInDone(w.c, true)).toBe('count')
    const p = K.preState(w.c)
    const ev = K.startWorkout(w.c, p.session, p.bw)
    expect(ev.bw).toBe(81.4)
    await w.run(6)
    const day = new Date(Date.now()).toISOString().slice(0, 10)
    expect(w.S().dayForm?.[day]).toBeTruthy()
    expect(w.S().bodyweight.at(-1)).toMatchObject({ w: 81.4 })
    expect(w.starts).toBe(1)
    expect(w.c.s.ob).toEqual([])
  })
})

describe('the same event twice', () => {
  it('a message delivered two times is applied once, and named', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone()
    await w.run(2)
    w.twice = true
    w.tick({ r: 6 })
    await w.run(6)
    expect(w.setDone).toEqual(['0025/0'])
    expect(w.S().active.entries[0].sets[0].r).toBe(6)
    expect(w.c.s.ob).toEqual([])
    // and one that arrives again after it was named (the watch never heard the answer): still once
    const ev = w.transmits.flatMap(m => m.events).find(e => e.type === 'setDone')
    w.queue.push({ seq: 99, event: clone(ev) })
    for (const fn of w.listeners.watchEvent || []) fn({})
    await w.run(5)
    expect(w.setDone).toEqual(['0025/0'])
  })
})

describe('a per-side set and a superset', () => {
  it('each side is ticked on its own, and the set is done once both are', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone({
      id: 'w-side', start: Date.now(), cur: 0, name: 'Legs',
      entries: [{ id: '0025', target: { side: true }, sets: [
        { w: 20, r: 10, sides: { L: { w: 20, r: 10 }, R: { w: 20, r: 10 } } },
        { w: 20, r: 10, sides: { L: { w: 20, r: 10 }, R: { w: 20, r: 10 } } },
      ] }],
    })
    await w.run(2)
    expect(w.c.s.w.entries[0].perSide).toBe(true)
    w.tick({ r: 9 }); await w.run(4)
    expect(w.S().active.entries[0].sets[0].sides.L.done).toBe(true)
    expect(w.S().active.entries[0].sets[0].done).toBeFalsy()
    w.tick({ r: 10 }); await w.run(4)
    expect(w.S().active.entries[0].sets[0]).toMatchObject({ done: true, r: 19 })
    expect(w.setDone).toEqual(['0025/0/L', '0025/0/R'])
    expect(w.c.s.ob).toEqual([])
  })

  it('a superset is done in turns, and every set reaches the phone', async () => {
    const w = world()
    await w.launch()
    w.startOnPhone()
    w.update(s => { s.active.entries[1].sg = 'b'; s.active.entries[2].sg = 'b' })
    await w.run(2)
    expect(w.c.s.w.entries.map(e => e.group)).toEqual([undefined, 'b', 'b'])
    w.inRange = false
    for (let i = 0; i < 7; i++) { expect(w.tick()).toBe('tick'); await w.run(5) }
    w.reconnect()
    await w.run(120)
    expect(w.doneRows()).toEqual(['0025', '0025', '0025', '0001', '0001', '0003', '0003'])
    // the superset alternated: 0001, 0003, 0001, 0003
    const sent = new Map(w.transmits.flatMap(m => m.events).filter(e => e.type === 'setDone').map(e => [e.id, e]))
    const order = [...sent.values()].sort((a, b) => a.at - b.at).map(e => e.exId)
    expect(order.slice(3)).toEqual(['0001', '0003', '0001', '0003'])
    expect(w.c.s.ob).toEqual([])
  })
})

describe('a workout too big for one snapshot', () => {
  it('the snapshot is cut to part of it; count and each i stay right, and every set still gets through', async () => {
    const w = world()
    await w.launch()
    // 70 exercises with long names: more than the frames carry
    const lib = ['0025', '0001', '0003', '0027', '0030', '0031', '0010', '0011']
    const entries = Array.from({ length: 70 }, (_, k) => ({ id: lib[k % lib.length], sg: undefined, sets: Array.from({ length: 6 }, () => ({ w: 60, r: 8 })) }))
    w.startOnPhone({ id: 'w-big', start: Date.now(), cur: 0, name: 'Big', entries })
    await w.run(2)
    expect(w.last.active.count).toBe(70)
    expect(w.last.active.entries.length).toBeLessThan(70)
    expect(w.c.s.w.count).toBe(70)
    expect(w.c.s.w.entries.every(e => w.S().active.entries[e.i].id === e.id)).toBe(true)
    expect(wireLength(JSON.stringify(w.last))).toBeLessThanOrEqual(HUAWEI_MAX_WIRE)
    // log the first 12 sets at the wrist: each one lands on the right row of the phone
    for (let i = 0; i < 12; i++) { expect(w.tick()).toBe('tick'); await w.run(4) }
    await w.run(10)
    expect(w.S().active.entries.slice(0, 2).every(e => e.sets.every(s => s.done))).toBe(true)
    expect(w.setDone).toHaveLength(12)
    expect(w.c.s.ob).toEqual([])
    // the next snapshot moved the part on: the watch holds the exercise it is on, with a right i
    const cur = K.current(w.c)
    expect(cur.e.i).toBe(2)
    expect(w.S().active.entries[cur.e.i].id).toBe(cur.e.id)
  })
})
