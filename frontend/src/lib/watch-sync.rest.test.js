// @vitest-environment happy-dom
// The phone's half of the watch-sync round (1.4.5): one rest whoever changes it (restAt, the rest
// event, a tick's restEnd), the two clocks (`now`, `off`), a set's identity (#1162: sid, addSet,
// removeSet), the later of two changes of a set by its stamp, and the snapshot sent at once and on
// the way to the background. End to end on the simulator in watch-sync.sim2.test.js.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildSnapshot, watchRestTimer, restShape, restAtFor, noteRestChange, watchTickRest, applyRestStep, phoneClock, MAX_OFF_MS,
  needsSetIds, ensureSetIds, rowBySid, addWatchSet, removeWatchSet, setStamp, editedDoneRows, patchSetIn, ensureWatchSet,
  applyEvents, bindWatchActions, bindWatchAppActions, startWatchSync, _setWatchPluginForTest, _resetWatchSync,
} from './watch-sync.js'

const T = 1_800_000_000_000
beforeEach(() => { localStorage.clear(); _resetWatchSync() })

const S1 = (over = {}) => ({
  unit: 'kg', restSec: 90, workouts: [], routines: [],
  active: { id: 'w1', start: T - 60_000, cur: 0, entries: [
    { id: '0025', target: null, sets: [{ w: 60, r: 8, done: false, sid: 'a' }, { w: 60, r: 8, done: false, sid: 'b' }] },
    { id: '0001', target: null, sets: [{ w: 20, r: 10, done: false, sid: 'c' }] },
    { id: '0025', target: null, sets: [{ w: 50, r: 10, done: false, sid: 'd' }] },
  ] },
  ...over,
})

describe('the snapshot says what the rest is', () => {
  it('running: its end and its length; paused: that it is paused and at what; and when it last changed', () => {
    expect(buildSnapshot(S1(), { timer: { endsAt: T + 5000, total: 90, left: 5 } }).active.rest).toEqual({ endsAt: T + 5000, total: 90 })
    const paused = buildSnapshot(S1(), { timer: { endsAt: T + 5000, total: 90, left: 42, paused: true } }).active
    expect(paused.rest).toBeNull()
    expect(paused).toMatchObject({ restPaused: true, restLeft: 42 })
    // a skipped (none) or run-out rest (Ready) is not paused
    expect(buildSnapshot(S1(), { timer: null }).active).not.toHaveProperty('restPaused')
    expect(buildSnapshot(S1(), { timer: { endsAt: T, ready: true } }).active).not.toHaveProperty('restPaused')
    expect(buildSnapshot(S1(), { restAt: T - 10 }).active.restAt).toBe(T - 10)
    expect(buildSnapshot(S1()).active).not.toHaveProperty('restAt')
  })

  it('a circuit\'s paused rest is paused, not gone (#1165)', () => {
    expect(watchRestTimer(null, null)).toBeNull()
    expect(watchRestTimer({ endsAt: 9 }, null)).toEqual({ endsAt: 9 })
  })

  it('each set row goes with its id, and the later of its tick and an edit here as its time', () => {
    const S = S1()
    S.active.entries[0].sets[0] = { w: 62.5, r: 8, done: true, at: T - 5000, eat: T - 1000, sid: 'a' }
    const sets = buildSnapshot(S).active.entries[0].sets
    expect(sets.map(s => s.sid)).toEqual(['a', 'b'])
    expect(sets[0].at).toBe(T - 1000)
  })
})

describe('the rest\'s stamp (restAt)', () => {
  it('a change here is stamped with now, always after the one before; running out is no change', () => {
    noteRestChange('w1', { endsAt: T + 90_000 }, T)
    expect(restAtFor('w1')).toBe(T)
    expect(restAtFor('other')).toBe(0)
    // the same rest again (a reopened app restoring it): no change
    _resetWatchSync()
    noteRestChange('w1', { endsAt: T + 90_000, left: 80 }, T + 10_000)
    expect(restAtFor('w1')).toBe(T)
    // +15 here
    noteRestChange('w1', { endsAt: T + 105_000 }, T + 20_000)
    expect(restAtFor('w1')).toBe(T + 20_000)
    // ran out: its Ready, then gone, keep the stamp
    noteRestChange('w1', { endsAt: T + 105_000, ready: true }, T + 105_200)
    noteRestChange('w1', null, T + 106_000)
    expect(restAtFor('w1')).toBe(T + 20_000)
    // a new rest, then a Skip long before its end: a change
    noteRestChange('w1', { endsAt: T + 300_000 }, T + 200_000)
    noteRestChange('w1', null, T + 210_000)
    expect(restAtFor('w1')).toBe(T + 210_000)
    // the phone's clock set back an hour: still after the last
    noteRestChange('w1', { endsAt: T + 400_000 }, T - 3600e3)
    expect(restAtFor('w1')).toBe(T + 210_001)
    expect(restShape({ endsAt: 5.4 })).toBe('r5')
    expect(restShape({ paused: true, left: 30 })).toBe('p30')
    expect(restShape({ ready: true })).toBe('')
  })

  it('a change a watch\'s event made is not stamped as the phone\'s own', () => {
    bindWatchAppActions({})
    const ui = { getState: () => ({ timer: { endsAt: T + 50_000 }, alignRest: vi.fn(), stopRest: vi.fn(), skipRest: vi.fn() }) }
    _setWatchPluginForTest(null, () => ({ S: S1() }))
    applyRestStep(ui, { align: T + 50_000 }, { wid: 'w1', at: T - 2000 })
    expect(restAtFor('w1')).toBe(T - 2000)
  })
})

describe('what the phone\'s rest does after a set from the watch (watchTickRest)', () => {
  const before = { endsAt: T + 30_000, total: 90, left: 30 }
  const started = { endsAt: T + 90_000, total: 90, left: 90 }
  it('the watch said where its rest ends: the phone\'s ends there', () => {
    expect(watchTickRest({ before, timer: started, at: T - 3000, restEnd: T + 87_000, restAt: T - 60_000, now: T })).toEqual({ align: T + 87_000 })
  })
  it('the watch started none, or its rest is over: none here', () => {
    expect(watchTickRest({ timer: started, at: T, restEnd: 0, now: T })).toEqual({ end: true })
    expect(watchTickRest({ timer: started, at: T - 200_000, restEnd: T - 110_000, now: T })).toEqual({ end: true })
    expect(watchTickRest({ timer: null, at: T, restEnd: 0, now: T })).toBeNull()
  })
  it('a rest changed here after the tick stands (a late tick from a watch that was away)', () => {
    expect(watchTickRest({ before, timer: started, at: T - 100_000, restEnd: T - 10_000, restAt: T - 50_000, now: T })).toEqual({ keep: before })
    expect(watchTickRest({ before: null, timer: started, at: T - 100_000, restAt: T - 50_000, now: T })).toEqual({ keep: null })
  })
  it('a watch that does not say: the lag rule, as before', () => {
    const just = { endsAt: T + 90_000, total: 90, left: 90 }
    expect(watchTickRest({ timer: just, at: T - 10_000, now: T })).toEqual({ lag: 10 })
    expect(watchTickRest({ timer: just, at: T - 500, now: T })).toBeNull()
    expect(watchTickRest({ timer: just, at: T - 100_000, now: T })).toEqual({ end: true })
  })
  it('keep puts the rest that ran before back, through the timer\'s own actions', () => {
    let timer = started
    const ui = { getState: () => ({ timer, putRest: vi.fn(t => { timer = t }), stopRest: vi.fn(() => { timer = null }) }) }
    const s = ui.getState()
    ui.getState = () => ({ ...s, timer })
    applyRestStep(ui, { keep: before }, { wid: 'w1', at: T })
    expect(timer).toBe(before)
    applyRestStep(ui, { keep: null }, { wid: 'w1', at: T })
    expect(timer).toBeNull()
    // and stamps nothing: the phone's own change is the newest
    expect(restAtFor('w1')).toBe(0)
  })
})

describe('the two clocks', () => {
  it('an event\'s times move onto the phone\'s clock by the watch\'s offset', () => {
    expect(phoneClock({ id: 'e', at: T + 3000, restEnd: T + 93_000, off: 3000 })).toMatchObject({ at: T, restEnd: T + 90_000 })
    expect(phoneClock({ id: 'e', type: 'rest', endsAt: T + 1000, at: T - 500, off: -2000 })).toMatchObject({ endsAt: T + 3000, at: T + 1500 })
    // no rest stays no rest; no offset or one that is not a real offset: as it is
    expect(phoneClock({ id: 'e', at: T, restEnd: 0, off: 5 }).restEnd).toBe(0)
    expect(phoneClock({ id: 'e', at: T }).at).toBe(T)
    expect(phoneClock({ id: 'e', at: T, off: MAX_OFF_MS + 1 }).at).toBe(T)
  })
})

describe('a watch\'s rest event', () => {
  const ui = () => {
    let timer = { endsAt: T + 60_000, total: 90, left: 60 }
    const calls = []
    const st = () => ({
      timer,
      alignRest: e => { calls.push(['align', e]); timer = { ...timer, endsAt: e } },
      skipRest: at => { calls.push(['skip', at]); timer = null },
      stopRest: () => { calls.push(['stop']); timer = null },
    })
    return { getState: st, calls }
  }
  async function linked (u, S) {
    const b = { status: async () => ({ paired: true, installed: true }), sendSnapshot: vi.fn(async () => ({ sent: true })), sendClips: async () => ({}), drain: async () => ({ events: [] }), ack: async () => ({}), addListener: async () => ({ remove () {} }) }
    _setWatchPluginForTest(b)
    const store = { getState: () => ({ S, ready: true }), subscribe: () => () => {} }
    return startWatchSync({ useStore: store, useUI: { getState: u.getState, subscribe: () => () => {} } })
  }
  it('+15 there moves the phone\'s end; Skip there skips here (with its time, for the next hold\'s count-in)', async () => {
    const S = S1(), u = ui()
    const stop = await linked(u, S)
    applyEvents([{ id: 'r1', type: 'rest', wid: 'w1', endsAt: T + 75_000, at: T - 1000 }], () => ({ S }), T)
    applyEvents([{ id: 'r2', type: 'rest', wid: 'w1', endsAt: null, at: T - 500 }], () => ({ S }), T)
    expect(u.calls).toEqual([['align', T + 75_000], ['skip', T - 500]])
    expect(restAtFor('w1')).toBe(T - 500)
    // an older one that arrives after: nothing
    applyEvents([{ id: 'r0', type: 'rest', wid: 'w1', endsAt: T + 99_000, at: T - 900 }], () => ({ S }), T)
    expect(u.calls).toHaveLength(2)
    // another workout's: nothing
    applyEvents([{ id: 'r3', type: 'rest', wid: 'w2', endsAt: T + 99_000, at: T }], () => ({ S }), T)
    expect(u.calls).toHaveLength(2)
    stop()
  })
})

describe('a set\'s identity (#1162)', () => {
  it('every row gets an id; of two rows with one id the first keeps it', () => {
    const S = S1()
    S.active.entries[0].sets.push({ ...S.active.entries[0].sets[0] })
    delete S.active.entries[1].sets[0].sid
    expect(needsSetIds(S.active)).toBe(true)
    expect(ensureSetIds(S.active)).toBe(true)
    const ids = S.active.entries.flatMap(e => e.sets.map(s => s.sid))
    expect(ids[0]).toBe('a')
    expect(new Set(ids).size).toBe(ids.length)
    expect(needsSetIds(S.active)).toBe(false)
    expect(ensureSetIds(S.active)).toBe(false)
    // not a saved workout being edited, nor one logged into the past
    expect(needsSetIds({ ...S.active, editingWorkoutId: 'x', entries: [{ sets: [{}] }] })).toBe(false)
  })

  it('a tick is applied by its id, wherever the row is now, also in the second copy of an exercise', () => {
    const S = S1()
    const setDone = vi.fn()
    bindWatchActions({ setDone })
    applyEvents([{ id: 'e1', type: 'setDone', wid: 'w1', exId: '0025', entryIdx: 0, setIdx: 0, sid: 'd', w: 50, r: 9, at: T }], () => ({ S }), T)
    expect(setDone).toHaveBeenCalledWith(2, 0, expect.objectContaining({ w: 50, r: 9 }))
    // without an id: by position, as before
    applyEvents([{ id: 'e2', type: 'setDone', wid: 'w1', exId: '0025', entryIdx: 0, setIdx: 1, w: 60, r: 8, at: T }], () => ({ S }), T)
    expect(setDone).toHaveBeenLastCalledWith(0, 1, expect.anything())
  })

  it('a tick whose row is gone gets a row of its own, never another set\'s place', () => {
    const S = S1()
    const ensureSet = vi.fn((where, fields) => ensureWatchSet(S, where, () => null, fields))
    bindWatchActions({ setDone: vi.fn() })
    bindWatchAppActions({ ensureSet })
    applyEvents([{ id: 'e1', type: 'setDone', wid: 'w1', exId: '0025', entryIdx: 0, setIdx: 0, sid: 'gone', w: 70, r: 3, at: T }], () => ({ S }), T)
    expect(S.active.entries[0].sets).toHaveLength(3)
    expect(S.active.entries[0].sets[0]).toMatchObject({ sid: 'a', done: false })
    expect(S.active.entries[0].sets[2]).toMatchObject({ sid: 'gone', done: true, w: 70, r: 3 })
  })

  it('a late tick for a saved workout finds its row by id', () => {
    const S = S1({ active: null, workouts: [{ id: 'w0', entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true, sid: 'x' }, { w: 60, r: 8, done: false, sid: 'y' }] }] }] })
    patchSetIn(S, { wid: 'w0', exId: '0025', entryIdx: 0, setIdx: 0, sid: 'y' }, { done: true, w: 62.5, r: 7 }, null)
    expect(S.workouts[0].entries[0].sets[1]).toMatchObject({ done: true, w: 62.5, r: 7 })
    expect(S.workouts[0].entries[0].sets[0]).toMatchObject({ w: 60, r: 8 })
  })

  it('a set added on the watch goes in once, after the set it names; one taken out goes only when not done', () => {
    const S = S1()
    expect(addWatchSet(S, { sid: 'w-1', exId: '0025', entryIdx: 0, after: 'a', w: 55, r: 6 })).toBe(true)
    expect(S.active.entries[0].sets.map(s => s.sid)).toEqual(['a', 'w-1', 'b'])
    expect(S.active.entries[0].sets[1]).toMatchObject({ w: 55, r: 6, done: false })
    expect(addWatchSet(S, { sid: 'w-1', exId: '0025', entryIdx: 0, after: 'a' })).toBe(false)
    // at the end of the exercise at its place when it names no set
    expect(addWatchSet(S, { sid: 'w-2', exId: '0025', entryIdx: 2 })).toBe(true)
    expect(S.active.entries[2].sets.map(s => s.sid)).toEqual(['d', 'w-2'])
    expect(removeWatchSet(S, { sid: 'w-2' })).toBe(true)
    S.active.entries[0].sets[0].done = true
    expect(removeWatchSet(S, { sid: 'a' })).toBe(false)
    expect(removeWatchSet(S, { sid: 'nope' })).toBe(false)
    // never the last row of an exercise
    expect(removeWatchSet(S, { sid: 'c' })).toBe(false)
    expect(rowBySid(S.active, 'b')).toEqual([0, 2])
  })
})

describe('the later of two changes of one set', () => {
  it('a done set edited here carries the edit\'s time', () => {
    expect(setStamp({ at: 5 })).toBe(5)
    expect(setStamp({ at: 5, eat: 9 })).toBe(9)
    expect(setStamp({})).toBe(0)
    const a = S1().active
    a.entries[0].sets[0] = { ...a.entries[0].sets[0], done: true, at: T }
    const b = JSON.parse(JSON.stringify(a))
    b.entries[0].sets[0].w = 65
    b.entries[0].sets[1].w = 70   // not done: not an edit of a logged set
    expect(editedDoneRows(a, b)).toEqual([[0, 0]])
    expect(editedDoneRows(a, JSON.parse(JSON.stringify(a)))).toEqual([])
  })

  it('a saved workout keeps a phone edit over an older tick from the watch', () => {
    const S = S1({ active: null, workouts: [{ id: 'w0', entries: [{ id: '0025', sets: [{ w: 65, r: 8, done: true, at: T - 10_000, eat: T, sid: 'x' }] }] }] })
    expect(patchSetIn(S, { wid: 'w0', exId: '0025', entryIdx: 0, setIdx: 0, sid: 'x' }, { done: true, w: 60, r: 8, at: T - 5000 }, null, { ifNewer: T - 5000 })).toBe(false)
    expect(S.workouts[0].entries[0].sets[0].w).toBe(65)
  })
})

describe('the snapshot goes at once, and on the way to the background', () => {
  function store (initial) {
    let st = initial
    const subs = new Set()
    return { getState: () => st, setState: patch => { const prev = st; st = { ...st, ...patch }; subs.forEach(fn => fn(st, prev)) }, subscribe: fn => { subs.add(fn); return () => subs.delete(fn) } }
  }
  const bridge = () => ({ status: vi.fn(async () => ({ paired: true, installed: true })), sendSnapshot: vi.fn(async () => ({ sent: true })), sendClips: vi.fn(async () => ({})), dropClips: vi.fn(async () => ({})), drain: vi.fn(async () => ({ events: [] })), ack: vi.fn(async () => ({})), addListener: vi.fn(async () => ({ remove: () => {} })) })
  it('a tick goes without waiting; a Finish followed at once by the lock button goes before the app sleeps', async () => {
    vi.useFakeTimers({ now: T })
    const visible = { v: 'visible' }
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible.v })
    try {
      const b = bridge()
      _setWatchPluginForTest(b)
      const S = S1()
      const st = store({ S, ready: true })
      const stop = await startWatchSync({ useStore: st, useUI: store({ timer: null }) })
      await vi.advanceTimersByTimeAsync(1000)
      const n = b.sendSnapshot.mock.calls.length
      // a tick, a second after the last snapshot: out in the next turn, not 400 ms later
      st.setState({ S: { ...S, active: { ...S.active, cur: 1 } } })
      await vi.advanceTimersByTimeAsync(1)
      expect(b.sendSnapshot.mock.calls.length).toBe(n + 1)
      // within 400 ms of it: Finish, then hidden at once
      st.setState({ S: { ...S, active: null } })
      visible.v = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
      expect(b.sendSnapshot.mock.calls.length).toBe(n + 2)
      expect(JSON.parse(b.sendSnapshot.mock.calls.at(-1)[0].json).active).toBeNull()
      stop()
    } finally { delete document.visibilityState; vi.useRealTimers() }
  })
})
