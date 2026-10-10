import { describe, expect, it } from 'vitest'
import { currentSet, readWatchAction, watchSnapshot, WATCH_PROTOCOL } from './watch-model.js'

// What the Apple Watch app shows of a running workout, and which of its answers the phone takes.
const reps = (w, r, extra = {}) => ({ w, r, ...extra })
const bench = { id: '0025', target: { mode: 'reps' }, sets: [reps(40, 8, { phase: 'warmup', done: true }), reps(60, 8), reps(60, 8)] }
const plank = { id: 'plank', target: { mode: 'time', sec: 60 }, sets: [{ sec: 60 }] }
const state = (entries, extra = {}) => ({ unit: 'kg', active: { name: 'Push', cur: 0, entries, ...extra } })
const nameOf = e => ({ '0025': 'Bench press', plank: 'Plank' })[e.id]

describe('currentSet', () => {
  it('is the first set not done in the marked exercise', () => {
    expect(currentSet(state([bench, plank]).active)).toEqual({ entryIdx: 0, setIdx: 1 })
  })
  it('moves on to the first open set anywhere once the marked exercise is done', () => {
    const done = { ...bench, sets: bench.sets.map(s => ({ ...s, done: true })) }
    expect(currentSet(state([done, plank]).active)).toEqual({ entryIdx: 1, setIdx: 0 })
  })
  it('is null when everything is done, or nothing runs', () => {
    expect(currentSet(state([{ ...plank, sets: [{ sec: 60, done: true }] }]).active)).toBeNull()
    expect(currentSet(null)).toBeNull()
  })
})

describe('watchSnapshot', () => {
  it('says nothing runs without a workout', () => {
    expect(watchSnapshot({ unit: 'kg', active: null }, null, { labels: { done: 'Done' } })).toEqual({ v: WATCH_PROTOCOL, active: false, labels: { done: 'Done' } })
  })
  it('offers the next set with its reps and weight, named in the app language', () => {
    const snap = watchSnapshot(state([bench, plank]), null, { nameOf })
    expect(snap).toMatchObject({ active: true, workout: 'Push', unit: 'kg', progress: { done: 1, total: 4 }, rest: null })
    expect(snap.set).toEqual({ entryIdx: 0, setIdx: 1, exercise: 'Bench press', setNo: 2, setCount: 3, warmup: false, mode: 'reps', reps: 8, weight: 60, loggable: true })
  })
  it('leaves a timed set to the phone', () => {
    const snap = watchSnapshot(state([plank]), null, { nameOf })
    expect(snap.set).toMatchObject({ exercise: 'Plank', mode: 'time', loggable: false })
  })
  it('leaves a per-side set to the phone', () => {
    const side = { id: '0025', target: { mode: 'reps' }, sets: [{ w: 10, r: 8, sides: { L: { w: 10, r: 8 }, R: { w: 10, r: 8 } } }] }
    expect(watchSnapshot(state([side]), null, { nameOf }).set.loggable).toBe(false)
  })
  it('gives a running rest by its end, so it does not change every second', () => {
    const a = watchSnapshot(state([bench]), { left: 80, total: 90, endsAt: 1000 }, { nameOf })
    const b = watchSnapshot(state([bench]), { left: 79, total: 90, endsAt: 1000 }, { nameOf })
    expect(a.rest).toEqual({ endsAt: 1000, total: 90 })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
  it('gives a held rest by what is left, and one that ran out as ready', () => {
    expect(watchSnapshot(state([bench]), { left: 40, total: 90, endsAt: 1, paused: true }).rest).toEqual({ paused: true, left: 40, total: 90 })
    expect(watchSnapshot(state([bench]), { left: 0, total: 90, ready: true }).rest).toEqual({ ready: true, total: 90 })
  })
  it('has no set once everything is done', () => {
    expect(watchSnapshot(state([{ ...plank, sets: [{ sec: 60, done: true }] }]), null).set).toBeNull()
  })
})

describe('readWatchAction', () => {
  const A = state([bench, plank]).active

  it('takes a set done for the set that is still next', () => {
    expect(readWatchAction(A, { type: 'done', entryIdx: 0, setIdx: 1, reps: 9, weight: 62.5 }))
      .toEqual({ type: 'done', entryIdx: 0, setIdx: 1, reps: 9, weight: 62.5 })
  })
  it('drops one for a set the phone has moved past, rather than tick the wrong row', () => {
    expect(readWatchAction(A, { type: 'done', entryIdx: 0, setIdx: 2, reps: 8, weight: 60 })).toBeNull()
    expect(readWatchAction(A, { type: 'done', entryIdx: 1, setIdx: 0, reps: 8, weight: 60 })).toBeNull()
  })
  it('drops reps or a weight no set has', () => {
    for (const bad of [{ reps: -1 }, { reps: 2.5 }, { reps: 5000 }, { weight: -5 }, { weight: 'x' }, { weight: 9999 }]) {
      expect(readWatchAction(A, { type: 'done', entryIdx: 0, setIdx: 1, reps: 8, weight: 60, ...bad })).toBeNull()
    }
  })
  it('never logs a timed set from the watch', () => {
    const P = state([plank]).active
    expect(readWatchAction(P, { type: 'done', entryIdx: 0, setIdx: 0, reps: 1, weight: 0 })).toBeNull()
  })
  it('passes the rest actions, with a sane number of seconds to add', () => {
    expect(readWatchAction(A, { type: 'skipRest' })).toEqual({ type: 'skipRest' })
    expect(readWatchAction(A, { type: 'pauseRest' })).toEqual({ type: 'pauseRest' })
    expect(readWatchAction(A, { type: 'resumeRest' })).toEqual({ type: 'resumeRest' })
    expect(readWatchAction(A, { type: 'addRest', sec: 15 })).toEqual({ type: 'addRest', sec: 15 })
    expect(readWatchAction(A, { type: 'addRest', sec: 0 })).toBeNull()
    expect(readWatchAction(A, { type: 'addRest', sec: 3600 })).toBeNull()
  })
  it('ignores anything else', () => {
    expect(readWatchAction(A, { type: 'finish' })).toBeNull()
    expect(readWatchAction(A, null)).toBeNull()
  })
})
