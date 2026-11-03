// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Logging a set from the Home Screen widget (lib/widget-logger.js): what the widget steps through,
// and the taps that come back. A tap is applied once, by its id: through the workout screen's own
// tick when it is open, straight into the stored workout when it is not, and only then acked.
const h = vi.hoisted(() => { vi.stubEnv('VITE_MOBILE', '1'); return { platform: 'android' } })
vi.mock('./mobile.js', () => ({ MOBILE: true, nativePlatform: async () => h.platform }))

const W = await import('./widget-logger.js')
const CURL = '0294'      // dumbbell biceps curl
const { buildWidgetSnapshot } = await import('./widgets.js')

const set = (over = {}) => ({ w: 60, r: 8, done: false, ...over })
const entry = (id, sets, over = {}) => ({ id, target: { mode: 'reps', inc: 2.5, ...(over.target || {}) }, sets, ...over })
const S = (active, over = {}) => ({ unit: 'kg', restSec: 90, workouts: [], routines: [], active, ...over })

// A tiny store: update(fn) on a clone, like the app's.
const store = S0 => {
  const st = { S: S0, ready: true, saveNow: vi.fn(async () => {}) }
  st.update = fn => { const next = structuredClone(st.S); fn(next); st.S = next }
  return st
}

beforeEach(() => { localStorage.clear(); W._resetWidgetActions() })
afterEach(() => W._resetWidgetActions())

describe('the logger in the widget snapshot', () => {
  it('is null with no workout, and in a saved workout being edited', () => {
    expect(W.buildLogger(S(null))).toBe(null)
    expect(buildWidgetSnapshot(S(null), { today: '2026-11-03' }).logger).toBe(null)
    expect(W.buildLogger(S({ id: 'a', editingWorkoutId: 'x', entries: [entry('0025', [set()])] }))).toBe(null)
  })

  it('carries the set now and the next ones, with the weight ladder on the exercise\'s own step', () => {
    const A = { id: 'w1', cur: 0, entries: [entry('0025', [set({ done: true }), set({ w: 60 }), set()]), entry('0043', [set({ w: 20, r: 12 })], { target: { inc: 1 } })] }
    const lg = buildWidgetSnapshot(S(A), { today: '2026-11-03' }).logger
    expect(lg.wid).toBe('w1')
    expect(lg.labels.logSet).toBe('Log set')
    expect(lg.sets.map(x => [x.entryIdx, x.setIdx])).toEqual([[0, 1], [0, 2], [1, 0]])
    const cur = lg.sets[0]
    expect(cur).toMatchObject({ k: 'w1:0:1', exId: '0025', line: 'Set 2 of 3', mode: 'reps', r: { v: 8, step: 1 } })
    expect(cur.w.v[cur.w.i]).toBe(60)
    expect(cur.w.v[cur.w.i + 1]).toBe(62.5)
    expect(cur.w.v[cur.w.i - 1]).toBe(57.5)
    expect(cur.w.t[cur.w.i]).toBe('60 kg')
    expect(lg.sets[2].w.v[lg.sets[2].w.i + 1]).toBe(21)
  })

  it('steps fine weights cleanly, never below 0, and reps in twos per side', () => {
    const A = { id: 'w', entries: [entry('0025', [set({ w: 0.2, r: 10 })], { target: { inc: 0.1, side: true } })] }
    const cur = W.buildLogger(S(A)).sets[0]
    expect(cur.w.v.slice(0, cur.w.i + 3)).toEqual([0, 0.1, 0.2, 0.3, 0.4])
    expect(cur.r.step).toBe(2)
  })

  it('walks the dumbbells you own, bell to bell', () => {
    const S0 = { unit: 'kg', dumbbells: { kg: { weights: [8, 10, 12, 14, 16], _ts: 1 } } }
    const lad = W.weightLadder(S0, { id: CURL, mode: 'reps' }, 12)
    expect(lad.v).toEqual([8, 10, 12, 14, 16])
    expect(lad.i).toBe(2)
  })

  it('a hold steps its seconds, and the widget stops at a cardio set', () => {
    const A = { id: 'w', entries: [entry('plank', [set({ sec: 45 })], { target: { mode: 'time' } }), entry('run', [{ min: 20, done: false }], { target: { mode: 'cardio' } })] }
    const lg = W.buildLogger(S(A))
    expect(lg.sets).toHaveLength(1)
    expect(lg.sets[0]).toMatchObject({ mode: 'time', sec: { v: 45, step: 5 } })
    expect(lg.sets[0].w).toBeUndefined()
  })
})

describe('applying the widget\'s taps', () => {
  const tap = (over = {}) => ({ id: 'e1', type: 'setDone', wid: 'w1', exId: '0025', entryIdx: 0, setIdx: 0, w: 62.5, r: 6, at: 1234, ...over })
  const A = () => ({ id: 'w1', entries: [entry('0025', [set(), set()])] })

  it('without the workout screen: the numbers and the tick go straight into the workout, once', () => {
    const st = store(S(A()))
    expect(W.applyWidgetEvents([tap()], () => st)).toEqual(['e1'])
    expect(st.S.active.entries[0].sets[0]).toMatchObject({ w: 62.5, r: 6, done: true, at: 1234 })
    // The same tap again (an ack that got lost) changes nothing.
    st.S.active.entries[0].sets[0].r = 7
    expect(W.applyWidgetEvents([tap()], () => st)).toEqual(['e1'])
    expect(st.S.active.entries[0].sets[0].r).toBe(7)
  })

  it('with the workout screen open: its own tick runs, after the numbers are in', () => {
    const st = store(S(A()))
    const setDone = vi.fn((idx, i) => { st.update(s => { s.active.entries[idx].sets[i].done = true }) })
    W._setWidgetActionsForTest(null, () => st)
    const unbind = W.bindWidgetActions({ setDone })
    W.applyWidgetEvents([tap({ id: 'e2', setIdx: 1, w: 65, r: 5 })], () => st)
    expect(setDone).toHaveBeenCalledWith(0, 1, { at: 1234 })
    expect(st.S.active.entries[0].sets[1]).toMatchObject({ w: 65, r: 5, done: true })
    unbind()
  })

  it('leaves another workout, a set already done and an unknown event alone, and still acks them', () => {
    const st = store(S({ id: 'w1', entries: [entry('0025', [set({ done: true, w: 50 })])] }))
    const out = W.applyWidgetEvents([tap({ id: 'a', wid: 'other' }), tap({ id: 'b' }), { id: 'c', type: 'what' }, { nope: 1 }], () => st)
    expect(out).toEqual(['a', 'b', 'c'])
    expect(st.S.active.entries[0].sets[0].w).toBe(50)
  })

  it('finds the exercise when the entries moved, and logs both sides of a per-side set', () => {
    const side = { w: 10, r: 10, done: false, sides: { L: { w: 10, r: 5, done: false }, R: { w: 10, r: 5, done: false } } }
    const st = store(S({ id: 'w1', entries: [entry('0043', [set()]), entry('0025', [side])] }))
    W.applyWidgetEvents([tap({ entryIdx: 0, r: 12, w: 12 })], () => st)
    const row = st.S.active.entries[1].sets[0]
    expect(row.done).toBe(true)
    expect(row.sides.L).toMatchObject({ w: 12, r: 6, done: true })
    expect(row.sides.R).toMatchObject({ w: 12, r: 6, done: true })
    expect(st.S.active.entries[0].sets[0].done).toBe(false)
  })

  it('drains the native queue and acks only once the change is saved', async () => {
    const st = store(S(A()))
    const bridge = { drain: vi.fn(async () => ({ events: [tap()] })), ack: vi.fn(async () => {}) }
    W._setWidgetActionsForTest(bridge, () => st)
    expect(await W.drainWidgetEvents()).toEqual(['e1'])
    expect(st.saveNow).toHaveBeenCalled()
    expect(bridge.ack).toHaveBeenCalledWith({ ids: ['e1'] })
  })

  it('waits while the store has not got its copy back', async () => {
    const st = { ...store(S(A())), ready: false }
    const bridge = { drain: vi.fn(async () => ({ events: [tap()] })), ack: vi.fn() }
    W._setWidgetActionsForTest(bridge, () => st)
    expect(await W.drainWidgetEvents()).toEqual([])
    expect(bridge.ack).not.toHaveBeenCalled()
  })
})
