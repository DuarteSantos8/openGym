// @vitest-environment happy-dom
// A workout done at the wrist with the phone away, merged when the phone hears of it: the real
// store, the real Start (beginWorkout) and Finish (finishWorkoutNow), and the app's own watch
// actions as App.jsx binds them. It ends when Finish was tapped on the watch, and a set the watch
// logged for an exercise or a row the phone's routine no longer has is still in what is saved.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { beginWorkout, finishWorkoutNow } from './sheets.jsx'
import { applyEvents, bindWatchActions, bindWatchAppActions, ensureWatchSet, patchSetIn, _resetWatchSync } from './lib/watch-sync.js'
import { buildSessionEntry } from './lib/session-start.js'
import { pickedExerciseConfig } from './lib/history.js'
import { EXIDX } from './lib/exercises.js'
import { migratedFixture } from './lib/test-fixtures.js'
import { savedEntries } from './lib/watch-sim.js'
import { uid } from './lib/format.js'

const clone = v => JSON.parse(JSON.stringify(v))
// The profile, with the running workout (the store's own `A`) as `active`; and a saved workout's rows.
const S = () => ({ ...useStore.getState().S, active: useStore.getState().A })
const withEntries = w => w && { ...w, entries: savedEntries(w) }
const T0 = Date.UTC(2026, 10, 10, 9, 0, 0)
const MIN = 60_000

function install () {
  const st = clone(DEF)
  st.sound = false
  st.weighIn = false
  st.routines = migratedFixture({ routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 2, reps: 8, weight: 60 }] }] }).routines
  st.workouts = []
  useStore.setState({ S: st, A: null, user: null })
}

/** The app's actions for the watch, as App.jsx and views/Workout.jsx bind them. */
function bind () {
  bindWatchAppActions({
    start: (ids, { bw = null, ...opts } = {}) => beginWorkout(ids, bw, opts),
    patchSet: (where, fields, opts = {}) => {
      const st = useStore.getState()
      if (st.A && st.A.id === where.wid) { st.updateActive(A => { patchSetIn({ active: A }, where, fields, null, opts) }); return }
      st.update(s => { patchSetIn(s, where, fields, null, opts) })
    },
    ensureSet: (where, fields) => {
      const st = useStore.getState()
      if (!st.A) return false
      const A = clone(st.A)
      let ok = false
      st.update(s => {
        ok = ensureWatchSet({ ...s, active: A }, where, exId => (EXIDX[exId] ? buildSessionEntry(s, exId, pickedExerciseConfig(exId, undefined, s), null, { active: A, newId: uid }) : null), fields)
      })
      if (ok) useStore.getState().setActive(A)
      return ok
    },
    openWorkout: () => {},
  })
  bindWatchActions({
    setDone: (idx, i, { w, r, at }) => useStore.getState().updateActive(A => {
      const set = A.entries[idx].sets[i]
      if (w != null) set.w = w
      if (r != null) set.r = r
      set.done = true
      if (at) set.at = at
    }),
    finish: opts => finishWorkoutNow(opts),
    discard: () => useStore.getState().clearActive(),
  })
}

let seq = 0
const ev = (type, at, over = {}) => ({ id: `e${++seq}`, seq, type, wid: 'watch-A', at, ...over })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  localStorage.clear()
  _resetWatchSync()
  useUI.setState({ sheets: [], timer: null, work: null })
  install()
  bind()
})
afterEach(() => { _resetWatchSync(); vi.useRealTimers() })

describe('a workout from the watch, merged later', () => {
  it('ends when Finish was tapped on the watch, also when the phone hears a few minutes later', () => {
    const events = [
      ev('start', T0, { routineIds: ['r1'] }),
      ev('setDone', T0 + 2 * MIN, { exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8 }),
      ev('setDone', T0 + 5 * MIN, { exId: '0025', entryIdx: 0, setIdx: 1, w: 60, r: 7 }),
      ev('finish', T0 + 9 * MIN),
    ]
    // heard of 12 minutes after the finish: inside the "still the same session" gap of a late Finish
    vi.setSystemTime(T0 + 21 * MIN)
    act(() => { applyEvents(events, () => useStore.getState()) })
    expect(S().active).toBeNull()
    const w = withEntries(S().workouts.at(-1))
    expect(w.id).toBe('watch-A')
    expect(w.start).toBe(T0)
    expect(w.end).toBe(T0 + 9 * MIN)
    expect(w.entries[0].sets.map(s => [s.w, s.r, s.done])).toEqual([[60, 8, true], [60, 7, true]])
  })

  it('a watch left running for hours after its last set still ends at the last set, as a late Finish on the phone does', () => {
    const events = [
      ev('start', T0, { routineIds: ['r1'] }),
      ev('setDone', T0 + 2 * MIN, { exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8 }),
      ev('finish', T0 + 180 * MIN),
    ]
    vi.setSystemTime(T0 + 181 * MIN)
    act(() => { applyEvents(events, () => useStore.getState()) })
    expect(S().workouts.at(-1).end).toBe(T0 + 2 * MIN)
  })

  it('keeps a set for a row and for an exercise the phone\'s routine no longer has', () => {
    const events = [
      ev('start', T0, { routineIds: ['r1'] }),
      ev('setDone', T0 + 2 * MIN, { exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8 }),
      // the watch's copy of the routine had a third set, and a second exercise
      ev('setDone', T0 + 5 * MIN, { exId: '0025', entryIdx: 0, setIdx: 2, w: 62.5, r: 6 }),
      ev('setDone', T0 + 8 * MIN, { exId: '0001', entryIdx: 1, setIdx: 0, w: 20, r: 12 }),
      ev('finish', T0 + 10 * MIN),
    ]
    vi.setSystemTime(T0 + 3 * 3600_000)
    let done = []
    act(() => { done = applyEvents(events, () => useStore.getState()) })
    expect(done).toHaveLength(5)
    const w = withEntries(S().workouts.at(-1))
    expect(w.end).toBe(T0 + 10 * MIN)
    const bench = w.entries.find(e => e.id === '0025')
    expect(bench.sets[0]).toMatchObject({ w: 60, r: 8, done: true })
    expect(bench.sets[1].done).toBe(false)
    expect(bench.sets[2]).toMatchObject({ w: 62.5, r: 6, done: true, at: T0 + 5 * MIN })
    const other = w.entries.find(e => e.id === '0001')
    expect(other.sets[0]).toMatchObject({ w: 20, r: 12, done: true })
  })

  it('a routine deleted on the phone since: the workout is saved with what the watch logged', () => {
    useStore.getState().update(s => { s.routines = [] })
    const events = [
      ev('start', T0, { routineIds: ['r1'] }),
      ev('setDone', T0 + 2 * MIN, { exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8 }),
      ev('setDone', T0 + 5 * MIN, { exId: '0025', entryIdx: 0, setIdx: 1, w: 60, r: 7 }),
      ev('finish', T0 + 9 * MIN),
    ]
    vi.setSystemTime(T0 + 3600_000)
    act(() => { applyEvents(events, () => useStore.getState()) })
    const w = withEntries(S().workouts.at(-1))
    expect(w.id).toBe('watch-A')
    expect(w.entries).toHaveLength(1)
    expect(w.entries[0].sets.filter(s => s.done).map(s => [s.w, s.r])).toEqual([[60, 8], [60, 7]])
  })

  it('an exercise this phone does not know is let go of, and the rest still lands', () => {
    const events = [
      ev('start', T0, { routineIds: ['r1'] }),
      ev('setDone', T0 + 2 * MIN, { exId: 'no-such-exercise', entryIdx: 3, setIdx: 0, w: 1, r: 1 }),
      ev('setDone', T0 + 5 * MIN, { exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 7 }),
      ev('finish', T0 + 9 * MIN),
    ]
    vi.setSystemTime(T0 + 3600_000)
    let done = []
    act(() => { done = applyEvents(events, () => useStore.getState()) })
    expect(done).toHaveLength(4)
    const w = withEntries(S().workouts.at(-1))
    expect(w.entries.map(e => e.id)).toEqual(['0025'])
  })
})
