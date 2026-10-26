// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The workout's Live Activity (lib/live-activity.js): the state the Lock Screen and the Dynamic
// Island show, and the Done taps that come back from it. A tap is applied once, by its id, through
// the workout screen's own tick, and only then taken out of the native queue.
const h = vi.hoisted(() => { vi.stubEnv('VITE_MOBILE', '1'); return { platform: 'ios' } })
vi.mock('./mobile.js', () => ({ MOBILE: true, nativePlatform: async () => h.platform }))

const L = await import('./live-activity.js')

const set = (over = {}) => ({ w: 60, r: 8, done: false, ...over })
const entry = (id, sets, over = {}) => ({ id, target: { mode: 'reps', restSec: 120 }, sets, ...over })
const S = (active, over = {}) => ({ unit: 'kg', restSec: 90, accent: 'lime', active, ...over })

describe('upcomingSets', () => {
  it('goes through the current exercise first, then the ones after it, then the ones before', () => {
    const A = { id: 'a', cur: 1, entries: [entry('0025', [set(), set()]), entry('0043', [set({ done: true }), set()]), entry('0001', [set()])] }
    expect(L.upcomingSets(S(A)).map(x => [x.entryIdx, x.setIdx])).toEqual([[1, 1], [2, 0], [0, 0], [0, 1]])
  })
  it('takes a superset round by round, resting after each round only', () => {
    const A = { id: 'a', cur: 0, entries: [entry('0025', [set(), set()], { sg: 'g' }), entry('0043', [set(), set()], { sg: 'g' })] }
    const up = L.upcomingSets(S(A))
    expect(up.map(x => [x.entryIdx, x.setIdx])).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]])
    expect(up.map(x => x.restAfter > 0)).toEqual([false, true, false, true])
  })
  it('is empty without a workout', () => {
    expect(L.upcomingSets(S(null))).toEqual([])
  })
})

describe('buildLiveActivity', () => {
  const A = { id: 'w1', name: 'Push', start: 1000, cur: 0, entries: [entry('0025', [set({ done: true }), set({ w: 62.5 }), set()]), entry('c9', [set()], { target: { name: 'Cable thing', mode: 'reps' } })] }

  it('shows the set to do now, the few after it, and how far along the session is', () => {
    const live = L.buildLiveActivity(S(A))
    expect(live.attributes).toMatchObject({ v: 2, wid: 'w1', start: 1000, accent: '#30d158' })
    for (const k of ['done', 'rest', 'next', 'allDone', 'restOver', 'nextExercise', 'skipRest', 'openApp']) expect(typeof live.attributes.labels[k], k).toBe('string')
    expect(live.state.name).toBe('Push')
    expect(live.state.cur).toMatchObject({ exId: '0025', entryIdx: 0, setIdx: 1, setLine: 'Set 2 of 3', restAfter: 120 })
    expect(live.state.cur.target).toMatch(/62[.,]5/)
    expect(live.state.ahead.map(x => [x.entryIdx, x.setIdx])).toEqual([[0, 2], [1, 0]])
    expect(live.state.ahead[1].exName).toBe('Cable thing')
    // Title-cased the way the workout screen shows it (CSS capitalize there), not the stored
    // lower-case name (Discord: lower-case on the Lock Screen).
    expect(live.state.cur.exName).toBe('Barbell Bench Press')
    expect(live.state).toMatchObject({ done: 1, total: 4, restEndsAt: null, restLeft: null })
  })
  it('carries the rest: its end while it runs, what is left while paused, nothing once over', () => {
    expect(L.buildLiveActivity(S(A), { endsAt: 5000, total: 90, left: 40 }).state).toMatchObject({ restEndsAt: 5000, restTotal: 90, restLeft: null })
    expect(L.buildLiveActivity(S(A), { endsAt: 5000, total: 90, left: 40, paused: true }).state).toMatchObject({ restEndsAt: null, restLeft: 40 })
    expect(L.buildLiveActivity(S(A), { endsAt: 5000, total: 90, left: 0, ready: true }).state.restEndsAt).toBeNull()
  })
  it('has no current set once everything is ticked', () => {
    const all = { ...A, entries: A.entries.map(e => ({ ...e, sets: e.sets.map(s => ({ ...s, done: true })) })) }
    expect(L.buildLiveActivity(S(all)).state).toMatchObject({ cur: null, ahead: [], done: 4, total: 4 })
  })
  it('says Log set, not Done, so it does not read like finishing the workout (Discord)', () => {
    expect(L.buildLiveActivity(S(A)).attributes.labels.done).toBe('Log set')
  })
  it('tags each set with its exercise unit and carries the first open set of the next exercises', () => {
    const W = { id: 'w2', cur: 1, entries: [
      entry('0025', [set({ done: true }), set()]),
      entry('0043', [set(), set()], { sg: 'g' }), entry('0001', [set(), set()], { sg: 'g' }),
      entry('0100', [set({ done: true })]),
      entry('0200', [set(), set()]),
    ] }
    const st = L.buildLiveActivity(S(W)).state
    // the superset (entries 1 and 2) is one unit, named by its first entry
    expect(st.cur).toMatchObject({ entryIdx: 1, setIdx: 0, unit: 1 })
    expect(st.ahead[0]).toMatchObject({ entryIdx: 2, setIdx: 0, unit: 1 })
    // entry 3 has nothing open; after the last one it wraps round to the first
    expect(st.unitStarts.map(x => [x.unit, x.entryIdx, x.setIdx])).toEqual([[4, 4, 0], [0, 0, 1]])
  })
  it('carries no next exercise when the current one is the only one with sets open', () => {
    const W = { id: 'w2', cur: 0, entries: [entry('0025', [set(), set()]), entry('0043', [set({ done: true })])] }
    expect(L.buildLiveActivity(S(W)).state.unitStarts).toEqual([])
  })
  it('stays inside ActivityKit\'s 4 KB with long names, dropping the farthest sets first', () => {
    const long = 'ท่าบริหารกล้ามเนื้อที่ยาวมากเป็นพิเศษ'.repeat(3)
    const W = { id: 'w3', cur: 0, entries: Array.from({ length: 10 }, (_, k) => entry('x' + k, [set(), set(), set()], { target: { name: long + k, mode: 'reps' } })) }
    const live = L.buildLiveActivity(S(W))
    expect(new TextEncoder().encode(JSON.stringify(live)).length).toBeLessThanOrEqual(3600)
    expect(live.state.cur).toBeTruthy()
    expect(live.state.unitStarts.length).toBeGreaterThan(0)
    const short = L.buildLiveActivity(S({ ...W, entries: W.entries.map(e => ({ ...e, target: { mode: 'reps' } })) }))
    expect(short.state.ahead).toHaveLength(L.LIVE_AHEAD)
    expect(short.state.unitStarts).toHaveLength(L.LIVE_UNITS)
  })
  it('is null without a running workout, and for a saved one being edited', () => {
    expect(L.buildLiveActivity(S(null))).toBeNull()
    expect(L.buildLiveActivity(S({ ...A, editingWorkoutId: 'w0' }))).toBeNull()
  })
})

describe('the Done taps', () => {
  let state, calls
  const A = () => ({ id: 'w1', cur: 0, entries: [entry('0025', [set(), set()]), entry('0043', [set()])] })
  const getState = () => ({ S: state })
  const ev = (id, over = {}) => ({ id, type: 'setDone', wid: 'w1', exId: '0025', entryIdx: 0, setIdx: 0, at: 1234, ...over })
  let unbind = null
  const bind = () => {
    unbind = L.bindLiveActions({ setDone: (idx, i, opts) => { calls.push([idx, i, opts]); state.active.entries[idx].sets[i].done = true } })
  }
  beforeEach(() => { localStorage.clear(); L._resetLiveActivity(); state = S(A()); calls = [] })
  afterEach(() => { unbind?.(); unbind = null })

  it('ticks through the workout screen once per event, whatever the queue sends twice', () => {
    bind()
    expect(L.applyLiveEvents([ev('e1')], getState)).toEqual(['e1'])
    expect(L.applyLiveEvents([ev('e1')], getState)).toEqual(['e1'])
    expect(calls).toEqual([[0, 0, { at: 1234 }]])
  })
  it('finds the exercise when the list moved, and leaves a set already ticked alone', () => {
    bind()
    L.applyLiveEvents([ev('e1', { exId: '0043', entryIdx: 0 })], getState)
    expect(calls).toEqual([[1, 0, { at: 1234 }]])
    state.active.entries[0].sets[1].done = true
    L.applyLiveEvents([ev('e2', { setIdx: 1 })], getState)
    expect(calls).toHaveLength(1)
  })
  it('drops an event about another workout, or one that ended', () => {
    bind()
    expect(L.applyLiveEvents([ev('e1', { wid: 'old' })], getState)).toEqual(['e1'])
    state.active = null
    expect(L.applyLiveEvents([ev('e2')], getState)).toEqual(['e2'])
    expect(calls).toEqual([])
  })
  it('keeps the events queued, in order, until the workout screen is there', () => {
    expect(L.applyLiveEvents([ev('e1'), ev('e2', { setIdx: 1 })], getState)).toEqual([])
    bind()
    expect(L.applyLiveEvents([ev('e1'), ev('e2', { setIdx: 1 })], getState)).toEqual(['e1', 'e2'])
    expect(calls.map(c => c[1])).toEqual([0, 1])
  })
  it('applies nothing before the store has its copy back, and acknowledges only after the save', async () => {
    const order = []
    let ready = false
    const saveNow = async () => { order.push('saved') }
    L._setLivePluginForTest({ drain: async () => ({ events: [ev('e1')] }), ack: async ({ ids }) => { order.push('ack:' + ids) } }, () => ({ S: ready ? state : { active: null }, ready, saveNow }))
    unbind = L.bindLiveActions({ setDone: (idx, i) => { order.push('applied'); state.active.entries[idx].sets[i].done = true } })
    expect(await L.drainLiveEvents()).toEqual([])
    expect(order).toEqual([])
    ready = true
    expect(await L.drainLiveEvents()).toEqual(['e1'])
    expect(order).toEqual(['applied', 'saved', 'ack:e1'])
  })
  it('drains the native queue and acknowledges what it applied', async () => {
    const acked = []
    const queue = [ev('e1')]
    L._setLivePluginForTest({ drain: async () => ({ events: queue }), ack: async ({ ids }) => { acked.push(...ids) } }, getState)
    bind()
    await L.drainLiveEvents()
    expect(calls).toHaveLength(1)
    expect(acked).toEqual(['e1'])
  })
})

describe('Next exercise and Skip rest', () => {
  let state, calls, timer
  const A = () => ({ id: 'w1', cur: 0, entries: [entry('0025', [set(), set()]), entry('0043', [set({ done: true })]), entry('0001', [set()])] })
  const getState = () => ({ S: state })
  let unbind = null
  const bind = () => {
    unbind = L.bindLiveActions({
      setDone: (idx, i) => { calls.push(['setDone', idx, i]); state.active.entries[idx].sets[i].done = true },
      next: idx => { calls.push(['next', idx]); state.active.cur = idx },
      restSkip: () => { calls.push(['restSkip']); timer = null },
      timer: () => timer,
    })
  }
  beforeEach(() => { localStorage.clear(); L._resetLiveActivity(); state = S(A()); calls = []; timer = null })
  afterEach(() => { unbind?.(); unbind = null })

  it('moves on to the next exercise with sets open, without ticking, and only once', () => {
    bind()
    const ev = { id: 'n1', type: 'next', wid: 'w1', fromEntryIdx: 0, at: 1 }
    expect(L.applyLiveEvents([ev], getState)).toEqual(['n1'])
    expect(L.applyLiveEvents([{ ...ev, id: 'n2' }], getState)).toEqual(['n2'])
    // the second tap was from exercise 0, which the page already left: nothing happens
    expect(calls).toEqual([['next', 2]])
    expect(state.active.entries.flatMap(e => e.sets).filter(s => s.done)).toHaveLength(1)
  })
  it('ignores a Next for another workout, and one with nowhere to go', () => {
    bind()
    L.applyLiveEvents([{ id: 'n1', type: 'next', wid: 'old', fromEntryIdx: 0 }], getState)
    state.active.entries[2].sets[0].done = true
    L.applyLiveEvents([{ id: 'n2', type: 'next', wid: 'w1', fromEntryIdx: 0 }], getState)
    expect(calls).toEqual([])
  })
  it('applies a Next after the Done taps before it, in order', () => {
    bind()
    L.applyLiveEvents([
      { id: 'd1', type: 'setDone', wid: 'w1', exId: '0025', entryIdx: 0, setIdx: 0, at: 1 },
      { id: 'n1', type: 'next', wid: 'w1', fromEntryIdx: 0, at: 2 },
    ], getState)
    expect(calls).toEqual([['setDone', 0, 0], ['next', 2]])
  })
  it('skips the rest the tap was about, not one that started after it', () => {
    bind()
    const now = 1_000_000
    timer = { endsAt: now + 60_000, total: 90, left: 60 }   // started 30 s before now
    L.applyLiveEvents([{ id: 's1', type: 'restSkip', wid: 'w1', at: now }], getState)
    expect(calls).toEqual([['restSkip']])
    timer = { endsAt: now + 90_000 + 20_000, total: 90, left: 90 }   // started 20 s after the tap
    L.applyLiveEvents([{ id: 's2', type: 'restSkip', wid: 'w1', at: now }], getState)
    L.applyLiveEvents([{ id: 's1', type: 'restSkip', wid: 'w1', at: now + 30_000 }], getState)
    expect(calls).toHaveLength(1)
    expect(timer).not.toBeNull()
  })
  it('leaves a side switch and another workout\'s rest alone, and has nothing to skip without a rest', () => {
    bind()
    timer = { endsAt: 5000, total: 5, left: 5, kind: 'switch' }
    L.applyLiveEvents([{ id: 's1', type: 'restSkip', wid: 'w1', at: 9000 }], getState)
    timer = { endsAt: 5000, total: 5, left: 5 }
    L.applyLiveEvents([{ id: 's2', type: 'restSkip', wid: 'old', at: 9000 }], getState)
    expect(calls).toEqual([])
    expect(L.restSkipApplies(null, 1)).toBe(false)
    expect(L.restSkipApplies({ left: 30, total: 90, paused: true }, 1)).toBe(true)
  })
  it('keeps them queued until the workout screen is there', () => {
    const evs = [{ id: 'n1', type: 'next', wid: 'w1', fromEntryIdx: 0 }, { id: 's1', type: 'restSkip', wid: 'w1', at: 1 }]
    expect(L.applyLiveEvents(evs, getState)).toEqual([])
    bind()
    expect(L.applyLiveEvents(evs, getState)).toEqual(['n1', 's1'])
  })
})

describe('startLiveActivitySync', () => {
  let state, timer, storeSubs, uiSubs, calls
  const useStore = { getState: () => ({ S: state }), subscribe: fn => { storeSubs.push(fn); return () => {} } }
  const useUI = { getState: () => ({ timer }), subscribe: fn => { uiSubs.push(fn); return () => {} } }
  const plugin = (supported = true) => ({
    status: async () => ({ supported }),
    update: async arg => { calls.push(['update', arg.wid, JSON.parse(arg.state)]) },
    end: async () => { calls.push(['end']) },
    drain: async () => ({ events: [] }),
    ack: async () => {},
    addListener: async () => ({ remove () {} }),
  })
  const active = () => ({ id: 'w1', name: 'Push', cur: 0, entries: [entry('0025', [set(), set()])] })
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); L._resetLiveActivity(); state = S(active()); timer = null; storeSubs = []; uiSubs = []; calls = [] })
  afterEach(() => { vi.useRealTimers(); L._resetLiveActivity() })

  it('at launch, an empty copy not restored yet does not end the running workout\'s activity', async () => {
    let ready = false
    const blank = { ...state, active: null }
    const store = { getState: () => ({ S: ready ? state : blank, ready }), subscribe: useStore.subscribe }
    L._setLivePluginForTest(plugin())
    const stop = await L.startLiveActivitySync({ useStore: store, useUI })
    await vi.runAllTimersAsync()
    expect(calls).toEqual([])
    ready = true
    storeSubs.forEach(fn => fn({ S: state, ready: true }, { S: blank, ready: false }))
    await vi.runAllTimersAsync()
    expect(calls).toEqual([['update', 'w1', expect.objectContaining({ name: 'Push' })]])
    stop()
  })
  it('shows the workout, updates it on a change, and ends it with the workout', async () => {
    L._setLivePluginForTest(plugin())
    const stop = await L.startLiveActivitySync({ useStore, useUI })
    await vi.runAllTimersAsync()
    expect(calls).toEqual([['update', 'w1', expect.objectContaining({ name: 'Push', done: 0, total: 2 })]])
    // a rest starts: the end goes out once, not every second it counts
    timer = { endsAt: 99000, total: 90, left: 90 }
    uiSubs.forEach(fn => fn({ timer }, { timer: null }))
    await vi.runAllTimersAsync()
    const ticking = { ...timer, left: 89 }
    uiSubs.forEach(fn => fn({ timer: ticking }, { timer }))
    await vi.runAllTimersAsync()
    expect(calls).toHaveLength(2)
    expect(calls[1][2].restEndsAt).toBe(99000)
    // the workout is finished
    const prev = state; state = { ...state, active: null }
    storeSubs.forEach(fn => fn({ S: state }, { S: prev }))
    await vi.runAllTimersAsync()
    expect(calls.at(-1)).toEqual(['end'])
    stop()
  })

  it('sends nothing where iOS has no Live Activities, and nothing off the iPhone app', async () => {
    L._setLivePluginForTest(plugin(false))
    const stop = await L.startLiveActivitySync({ useStore, useUI })
    await vi.runAllTimersAsync()
    expect(calls).toEqual([])
    stop()
    L._resetLiveActivity()
    h.platform = 'android'
    const stop2 = await L.startLiveActivitySync({ useStore, useUI })
    await vi.runAllTimersAsync()
    expect(calls).toEqual([])
    stop2()
    h.platform = 'ios'
  })
})
