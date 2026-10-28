// @vitest-environment happy-dom
// A set ticked on the Apple Watch runs the workout screen's own tick (lib/watch-sync.js): the
// weight and reps from the watch go into the row, the row is done, and the rest starts, exactly
// as a tap on the phone does it. Applied once, however often the event arrives.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout, { _resetHintQuiet } from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { applyEvents, discardedFor, _resetWatchSync } from '../lib/watch-sync.js'
import { createGuidedWarmup } from '../lib/guided-warmup-session.js'
import { applyLiveEvents } from '../lib/live-activity.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), beacon: vi.fn(), appBase: () => '/' }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = v => JSON.parse(JSON.stringify(v))
let root, container

beforeEach(() => {
  _resetHintQuiet(); _resetWatchSync()
  vi.useFakeTimers()
  localStorage.clear()
  useUI.getState().stopRest()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null, swipeHint: null })
  const S = clone(DEF)
  S.hints = { swipeSets: true }
  S.restSec = 90
  S.active = { id: 'w-watch', d: '2026-10-13', start: Date.now(), name: 'Watch test', cur: 0,
    entries: [{ id: '0025', target: { sets: 2, reps: 8, weight: 60 }, sets: [{ w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }] }] }
  useStore.setState({ S, user: null })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
})
afterEach(() => {
  act(() => root.unmount()); container.remove()
  useUI.getState().stopRest()
  vi.clearAllTimers(); vi.useRealTimers()
})

describe('a set ticked on the watch', () => {
  it('takes the watch\'s numbers, is ticked by the screen\'s own tick, and starts the rest', () => {
    const ev = { id: 'e1', type: 'setDone', wid: 'w-watch', exId: '0025', entryIdx: 0, setIdx: 0, w: 62.5, r: 7, at: 1 }
    act(() => { applyEvents([ev, ev], () => useStore.getState()) })
    const set = useStore.getState().S.active.entries[0].sets[0]
    expect(set).toMatchObject({ w: 62.5, r: 7, done: true })
    expect(typeof set.at).toBe('number')
    expect(useUI.getState().timer).toBeTruthy()           // the rest the tap would have started
    expect(useStore.getState().S.active.entries[0].sets[1].done).toBe(false)
    act(() => { applyEvents([ev], () => useStore.getState()) })
    expect(useStore.getState().S.active.entries[0].sets[0].done).toBe(true)   // not toggled back off
  })

  it('a row already ticked on the phone only takes the numbers', () => {
    act(() => { useStore.getState().update(s => { s.active.entries[0].sets[0].done = true }) })
    act(() => { applyEvents([{ id: 'e2', type: 'setDone', wid: 'w-watch', exId: '0025', entryIdx: 0, setIdx: 0, w: 65, r: 6 }], () => useStore.getState()) })
    expect(useStore.getState().S.active.entries[0].sets[0]).toMatchObject({ w: 65, r: 6, done: true })
  })

  it('keeps the watch\'s time on the set, and the watch\'s Finish saves the workout like Finish and save', () => {
    const at = Date.now() - 60000
    act(() => { applyEvents([{ id: 'e3', type: 'setDone', wid: 'w-watch', exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8, at }], () => useStore.getState()) })
    expect(useStore.getState().S.active.entries[0].sets[0].at).toBe(at)
    act(() => { applyEvents([{ id: 'f1', type: 'finish', wid: 'w-watch', at: at + 1000 }], () => useStore.getState()) })
    const S = useStore.getState().S
    expect(S.active).toBeNull()
    expect(S.workouts.at(-1)).toMatchObject({ id: 'w-watch' })
    expect(S.workouts.at(-1).entries[0].sets[0]).toMatchObject({ w: 60, r: 8, done: true, at })
  })

  it('the watch\'s RPE goes on the set it ticked, and a later phone rating is not overwritten', () => {
    act(() => { applyEvents([{ id: 'r1', type: 'setDone', wid: 'w-watch', exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8, at: Date.now(), rpe: 8.5 }], () => useStore.getState()) })
    expect(useStore.getState().S.active.entries[0].sets[0]).toMatchObject({ done: true, rpe: 8.5 })
    expect(useStore.getState().S.active.entries[0].sets[0].rir).toBeUndefined()
    act(() => { useStore.getState().update(s => { Object.assign(s.active.entries[0].sets[1], { done: true, at: 9e12, rpe: 7 }) }) })
    act(() => { applyEvents([{ id: 'r2', type: 'setDone', wid: 'w-watch', exId: '0025', entryIdx: 0, setIdx: 1, w: 60, r: 8, at: 1000, rpe: 10 }], () => useStore.getState()) })
    expect(useStore.getState().S.active.entries[0].sets[1].rpe).toBe(7)
  })

  it('the watch\'s Discard drops the workout without saving it', () => {
    const before = useStore.getState().S.workouts.length
    act(() => { applyEvents([{ id: 'x1', type: 'discard', wid: 'w-watch', at: Date.now() }], () => useStore.getState()) })
    const S = useStore.getState().S
    expect(S.active).toBeNull()
    expect(S.workouts.length).toBe(before)
  })
})

describe('the same set on both sides', () => {
  it('a tick from the watch older than the phone\'s own keeps the phone\'s numbers, and its heart rate lands', () => {
    act(() => { useStore.getState().update(s => { Object.assign(s.active.entries[0].sets[0], { w: 70, r: 5, done: true, at: 5000 }) }) })
    act(() => { applyEvents([{ id: 'old', type: 'setDone', wid: 'w-watch', exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8, at: 4000, hr: { avg: 120, max: 130 } }], () => useStore.getState()) })
    expect(useStore.getState().S.active.entries[0].sets[0]).toMatchObject({ w: 70, r: 5, done: true, at: 5000, hr: { avg: 120, max: 130 } })
  })
})

// Every kind of set the watch logs: one side of a per-side set at a time, a hold with its seconds.
describe('sets of every kind from the watch', () => {
  const sideRow = () => ({ w: 20, r: 16, done: false, sides: { L: { w: 20, r: 8, done: false }, R: { w: 20, r: 8, done: false } } })
  const load = entries => act(() => { useStore.getState().update(s => { s.active.entries = entries }) })

  it('a per-side set: each side ticked on its own, the row done with both', () => {
    load([{ id: 'split', target: { sets: 1, reps: 16, weight: 20, side: true }, sets: [sideRow()] }])
    act(() => { applyEvents([{ id: 'l', type: 'setDone', wid: 'w-watch', exId: 'split', entryIdx: 0, setIdx: 0, side: 'L', w: 22.5, r: 8, at: 10 }], () => useStore.getState()) })
    let row = useStore.getState().S.active.entries[0].sets[0]
    expect(row.sides.L).toMatchObject({ w: 22.5, r: 8, done: true })
    expect(row.sides.R.done).toBe(false)
    expect(row.done).toBe(false)
    act(() => { applyEvents([{ id: 'r', type: 'setDone', wid: 'w-watch', exId: 'split', entryIdx: 0, setIdx: 0, side: 'R', w: 20, r: 7, at: 20 }], () => useStore.getState()) })
    row = useStore.getState().S.active.entries[0].sets[0]
    expect(row.sides.R).toMatchObject({ w: 20, r: 7, done: true })
    expect(row).toMatchObject({ done: true, r: 15, w: 22.5 })
    // the same side again changes nothing
    act(() => { applyEvents([{ id: 'r2', type: 'setDone', wid: 'w-watch', exId: 'split', entryIdx: 0, setIdx: 0, side: 'R', w: 20, r: 7, at: 20 }], () => useStore.getState()) })
    expect(useStore.getState().S.active.entries[0].sets[0].sides.R.done).toBe(true)
  })

  it('a hold: done with the seconds it lasted on the watch', () => {
    load([{ id: 'plank', target: { sets: 1, sec: 45, mode: 'time' }, sets: [{ sec: 45, done: false }] }])
    act(() => { applyEvents([{ id: 'h', type: 'setDone', wid: 'w-watch', exId: 'plank', entryIdx: 0, setIdx: 0, sec: 52, at: 30 }], () => useStore.getState()) })
    expect(useStore.getState().S.active.entries[0].sets[0]).toMatchObject({ sec: 52, done: true })
  })
})


describe('Watch actions while the phone shows guided preparation', () => {
  beforeEach(() => {
    act(() => useStore.getState().update(s => {
      s.active.warmup = createGuidedWarmup([{ warmup: { enabled: true, steps: [
        { id: '3905', mode: 'time', sec: 30 },
        { id: '3502', mode: 'reps', reps: 10, perSide: true },
      ] } }], Date.now() - 1000)
      s.active.warmup.steps[0].status = 'done'
      s.active.warmup.current = 1
      s.active.warmup.timer = { endsAt: Date.now() + 30000 }
    }))
    expect(container.textContent).toContain('Guided warm-up')
  })

  it('applies and acknowledges a working set immediately and skips only unfinished preparation', () => {
    const event = { id: 'prep-set', type: 'setDone', wid: 'w-watch', exId: '0025', entryIdx: 0, setIdx: 0, w: 62.5, r: 7, at: Date.now() }
    let applied
    act(() => { applied = applyEvents([event], () => useStore.getState()) })
    expect(applied).toEqual(['prep-set'])
    const active = useStore.getState().S.active
    expect(active.entries[0].sets[0]).toMatchObject({ w: 62.5, r: 7, done: true, at: event.at })
    expect(active.entries[0].sets[1].done).toBe(false)
    expect(active.warmup.status).toBe('skipped')
    expect(active.warmup.steps.map(step => step.status)).toEqual(['done', 'skipped'])
    expect(active.warmup.timer).toBeUndefined()
    expect(useUI.getState().timer).toBeTruthy()
    expect(container.textContent).not.toContain('Guided warm-up')
    act(() => { applyEvents([event], () => useStore.getState()) })
    expect(useStore.getState().S.active.entries[0].sets[0].done).toBe(true)
  })

  it('finishes immediately and saves the unfinished preparation as skipped', () => {
    act(() => { useStore.getState().update(s => { s.active.entries[0].sets[0].done = true }) })
    let applied
    act(() => { applied = applyEvents([{ id: 'prep-finish', type: 'finish', wid: 'w-watch', at: Date.now() }], () => useStore.getState()) })
    expect(applied).toEqual(['prep-finish'])
    const state = useStore.getState().S
    expect(state.active).toBeNull()
    expect(state.workouts.at(-1)).toMatchObject({ id: 'w-watch', warmup: { status: 'skipped' } })
    expect(state.workouts.at(-1).warmup.steps.map(step => step.status)).toEqual(['done', 'skipped'])
    expect(state.workouts.at(-1).warmup).not.toHaveProperty('timer')
    expect(discardedFor()).toEqual([])
  })

  it('discards immediately and marks the session for the next Watch snapshot', () => {
    const count = useStore.getState().S.workouts.length
    let applied
    act(() => { applied = applyEvents([{ id: 'prep-discard', type: 'discard', wid: 'w-watch', at: Date.now() }], () => useStore.getState()) })
    expect(applied).toEqual(['prep-discard'])
    expect(useStore.getState().S.active).toBeNull()
    expect(useStore.getState().S.workouts).toHaveLength(count)
    expect(discardedFor()).toEqual(['w-watch'])
  })

  it('also closes pending preparation when a working set is ticked from the Lock Screen', () => {
    let applied
    act(() => { applied = applyLiveEvents([{ id: 'prep-live-set', type: 'setDone', wid: 'w-watch', exId: '0025', entryIdx: 0, setIdx: 0, at: Date.now() }], () => useStore.getState()) })
    expect(applied).toEqual(['prep-live-set'])
    const active = useStore.getState().S.active
    expect(active.entries[0].sets[0].done).toBe(true)
    expect(active.warmup.status).toBe('skipped')
    expect(active.warmup.steps.map(step => step.status)).toEqual(['done', 'skipped'])
  })

  it('does not consume the working-set swipe hint while preparation is displayed', () => {
    act(() => { useStore.getState().update(s => { s.hints = {} }) })
    act(() => { vi.advanceTimersByTime(10000) })
    expect(useStore.getState().S.hints.swipeSets).toBeUndefined()
    expect(useUI.getState().swipeHint).toBeNull()
  })

  it('keeps workout keyboard shortcuts from logging a hidden working set', () => {
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    const active = useStore.getState().S.active
    expect(active.entries[0].sets.every(set => !set.done)).toBe(true)
    expect(active.warmup.status).toBe('in_progress')
  })
})
