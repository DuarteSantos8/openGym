// @vitest-environment happy-dom
// Timed holds that run themselves, on the real workout screen and store (lib/auto-holds.js): one
// tap on the first hold, and the rest of the exercise runs by itself; the other side of a per-side
// hold after its switch pause; the chain moving on to a timed exercise after it and stopping at a
// reps one; Stop auto; and a phone that was locked through a whole hold.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), appBase: () => '/' }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const REST = 30
const plank = (n = 3, extra = {}) => ({ id: '1001', target: { mode: 'time', sets: n, sec: 10, restSec: REST, ...extra }, sets: Array.from({ length: n }, () => ({ sec: 10, w: 0, done: false })) })

let root, container

function renderWorkout(entries, over = {}) {
  const S = clone(DEF)
  S.sound = true
  S.autoHolds = true
  Object.assign(S, over)
  S.active = { id: 'auto-test', d: '2026-10-27', start: Date.now(), routineId: null, name: 'Holds', bw: null, cur: 0, entries }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}
const entriesNow = () => useStore.getState().S.active.entries
const doneOf = (idx = 0) => entriesNow()[idx].sets.map(s => s.done)
const tapStart = () => act(() => container.querySelector('button[aria-label="Start set"]').click())
const wait = ms => act(() => { vi.advanceTimersByTime(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null, countIn: null })
  root = null
  container = null
})
afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
  useUI.getState().stopCountIn()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('holds that start by themselves', () => {
  it('runs the rest of the exercise after one tap: hold, rest, 3-2-1, hold', () => {
    renderWorkout([plank(3)])
    tapStart()
    expect(useUI.getState().work).toMatchObject({ auto: true, total: 10 })
    wait(10_000)
    expect(doneOf()).toEqual([true, false, false])
    expect(useUI.getState().timer).toMatchObject({ total: REST, autoNext: expect.any(String) })
    wait(REST * 1000)
    expect(useUI.getState().countIn).toMatchObject({ owner: { idx: 0, i: 1 } })
    wait(3000 + 10_000)
    expect(doneOf()).toEqual([true, true, false])
    wait(REST * 1000 + 3000 + 10_000)
    expect(doneOf()).toEqual([true, true, true])
    expect(entriesNow()[0].sets.map(s => s.sec)).toEqual([10, 10, 10])
    expect(useUI.getState().countIn).toBeNull()
  })

  it('waits for the play button with the setting off, as always', () => {
    renderWorkout([plank(2)], { autoHolds: false })
    tapStart()
    expect(useUI.getState().work.auto).toBeFalsy()
    wait(10_000 + REST * 1000)
    expect(useUI.getState().timer).toMatchObject({ ready: true })
    expect(useUI.getState().countIn).toBeNull()
  })

  it('an exercise switched on by itself runs even with the setting off', () => {
    renderWorkout([plank(2, { autoHold: true })], { autoHolds: false })
    tapStart()
    wait(10_000 + REST * 1000)
    expect(useUI.getState().countIn).not.toBeNull()
  })

  it('switches sides with the short pause, and the right side counts in by itself', () => {
    const side = { id: '1001', target: { mode: 'time', sets: 1, sec: 10, side: true, restSec: REST }, sets: [
      { sec: 10, w: 0, done: false, side: 'L' }, { sec: 10, w: 0, done: false, side: 'R' },
    ] }
    renderWorkout([side])
    tapStart()
    wait(10_000)
    expect(useUI.getState().timer).toMatchObject({ kind: 'switch', total: 10 })
    wait(10_000)
    expect(useUI.getState().countIn).toMatchObject({ owner: { i: 1 } })
    wait(13_000)
    expect(doneOf()).toEqual([true, true])
  })

  it('moves on to a timed exercise after it, making it the current one, and stops at a reps one', () => {
    const lsit = { id: '1002', target: { mode: 'time', sets: 1, sec: 8, restSec: REST }, sets: [{ sec: 8, w: 0, done: false }] }
    const bench = { id: '0025', target: { mode: 'reps', sets: 1, reps: 8 }, sets: [{ w: 60, r: 8, done: false }] }
    renderWorkout([plank(1), lsit, bench])
    tapStart()
    wait(10_000 + REST * 1000)
    expect(useUI.getState().countIn).toMatchObject({ owner: { idx: 1, i: 0 } })
    expect(useStore.getState().S.active.cur).toBe(1)
    wait(3000 + 8000)
    expect(doneOf(1)).toEqual([true])
    wait(REST * 1000)
    expect(useUI.getState().countIn).toBeNull()
    expect(useUI.getState().work).toBeNull()
    expect(doneOf(2)).toEqual([false])
  })

  it('Stop auto leaves the rest of the workout as it always was', () => {
    renderWorkout([plank(3)])
    tapStart()
    wait(10_000)
    act(() => useUI.getState().stopAuto())
    expect(useStore.getState().S.active.autoHoldsOff).toBe(true)
    wait(REST * 1000)
    expect(useUI.getState().timer).toMatchObject({ ready: true })
    expect(useUI.getState().countIn).toBeNull()
  })

  it('logs a hold that ran out while the phone was locked at the time it ended, its rest started then', () => {
    renderWorkout([plank(3)])
    tapStart()
    const t0 = Date.now()
    // Locked: the clock moves on past the hold (10) and 12 s of its rest, with no tick run.
    act(() => { vi.setSystemTime(t0 + 22_000); document.dispatchEvent(new Event('visibilitychange')) })
    expect(entriesNow()[0].sets[0]).toMatchObject({ done: true, sec: 10, at: t0 + 10_000 })
    expect(useUI.getState().timer).toMatchObject({ total: REST, endsAt: t0 + 10_000 + REST * 1000 })
  })

  it('never counts in under a sheet', () => {
    renderWorkout([plank(2)])
    tapStart()
    wait(10_000)
    act(() => { useUI.getState().openSheet(() => null) })
    wait(REST * 1000 + 5000)
    expect(useUI.getState().countIn).toMatchObject({ waiting: true })
    expect(useUI.getState().work).toBeNull()
    act(() => useUI.getState().closeAll())
    wait(3000)
    expect(useUI.getState().work).not.toBeNull()
  })
})
