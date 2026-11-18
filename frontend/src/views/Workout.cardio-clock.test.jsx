// @vitest-environment happy-dom
// The count-up clock on a cardio set (#131): ▶ on the row counts up, ■ writes the minutes into
// the row, a tick or another set's ▶ stops it too, and it carries on across a reload.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout, { deleteActiveSet } from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { CARDIO_CLOCK_KEY, restoreCardioClock, useCardioClock } from '../store/useCardioClock.js'
import { pauseWorkout, resumeWorkout } from '../lib/workout-pause.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), appBase: () => '/' }))
// The Lock Screen's Log set (lib/live-activity.js): the handler the workout screen binds.
const live = vi.hoisted(() => ({ h: null }))
vi.mock('../lib/live-activity.js', async orig => ({ ...(await orig()), bindLiveActions: h => { live.h = h; return () => { if (live.h === h) live.h = null } } }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const TREADMILL = '2259'
const T0 = new Date('2026-11-18T10:00:00Z').getTime()
let root, container

function mount(sets, id = 'clock-test', more = []) {
  const S = JSON.parse(JSON.stringify(DEF))
  S.wc = { exerciseButtons: true }   // Move up/down under the exercise
  S.active = { id, d: '2026-11-18', start: T0, routineId: null, name: 'Cardio', bw: null, cur: 0,
    entries: [{ id: TREADMILL, target: { sets: sets.length, min: 20, speed: 5 }, sets }, ...more] }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}
const btn = label => container.querySelector(`button[aria-label="${label}"]`)
const rows = () => useStore.getState().S.active.entries[0].sets
const face = () => container.querySelector('.setrow .stp.clock')
const later = ms => act(() => { vi.advanceTimersByTime(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  localStorage.clear()
  useCardioClock.setState({ run: null })
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
})
afterEach(() => {
  if (root) act(() => root.unmount())
  container?.remove()
  root = null
  useCardioClock.setState({ run: null })
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  localStorage.clear()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('the cardio set clock', () => {
  it('counts up on ▶ and writes the rounded minutes on ■', () => {
    mount([{ min: 20, speed: 5, done: true }, { min: 20, speed: 5, done: false }])
    expect(btn('Set 1: Start timing').disabled).toBe(true)
    act(() => btn('Set 2: Start timing').click())
    expect(face()).toBeTruthy()
    expect(face().textContent).toBe('0:00')
    expect(JSON.parse(localStorage.getItem(CARDIO_CLOCK_KEY))).toMatchObject({ wid: 'clock-test', idx: 0, i: 1, id: TREADMILL, startedAt: T0 })
    later((24 * 60 + 40) * 1000)
    expect(face().textContent).toBe('24:40')
    // Not on the set while it runs, and the set is not ticked by it.
    expect(rows()[1]).toEqual({ min: 20, speed: 5, done: false })
    act(() => btn('Set 2: Stop timing').click())
    expect(rows()[1]).toEqual({ min: 25, speed: 5, done: false })
    expect(face()).toBeNull()
    expect(localStorage.getItem(CARDIO_CLOCK_KEY)).toBeNull()
  })

  it('keeps the minutes the row had after a run under 30 seconds', () => {
    mount([{ min: 20, speed: 5, done: false }])
    act(() => btn('Set 1: Start timing').click())
    later(29_000)
    act(() => btn('Set 1: Stop timing').click())
    expect(rows()[0].min).toBe(20)
  })

  it('writes the minutes when the row is ticked while it runs', () => {
    mount([{ min: 20, speed: 5, done: false }, { min: 20, speed: 5, done: false }])
    act(() => btn('Set 1: Start timing').click())
    later(30 * 60 * 1000 + 10_000)
    act(() => btn('Set 1 done').click())
    expect(rows()[0]).toMatchObject({ min: 30, done: true })
    expect(useCardioClock.getState().run).toBeNull()
  })

  it('runs one at a time: a second ▶ stops the first and writes its time', () => {
    mount([{ min: 20, speed: 5, done: false }, { min: 20, speed: 5, done: false }])
    act(() => btn('Set 1: Start timing').click())
    later(10 * 60 * 1000)
    act(() => btn('Set 2: Start timing').click())
    expect(rows()[0].min).toBe(10)
    expect(useCardioClock.getState().run).toMatchObject({ i: 1, startedAt: T0 + 10 * 60 * 1000 })
    expect(btn('Set 2: Stop timing')).toBeTruthy()
    expect(btn('Set 1: Start timing')).toBeTruthy()
  })

  it('keeps a row logged by distance in step: the speed follows the minutes', () => {
    mount([{ min: 20, km: 5, speed: 15, done: false }])
    act(() => btn('Set 1: Start timing').click())
    later(25 * 60 * 1000)
    act(() => btn('Set 1: Stop timing').click())
    expect(rows()[0]).toMatchObject({ min: 25, km: 5, speed: 12 })
  })

  it('waits while a hold runs, as a hold’s ▶ does', () => {
    mount([{ min: 20, speed: 5, done: false }])
    act(() => useUI.setState({ work: { left: 30, total: 30, endsAt: T0 + 30_000, label: 'Plank' } }))
    expect(btn('Set 1: Start timing').disabled).toBe(true)
  })

  it('drops the clock with its set, writing nothing, and moves it with a set removed above', () => {
    const set = min => ({ min, speed: 5, done: false })
    mount([set(20), set(21), set(22), set(23)])
    act(() => btn('Set 3: Start timing').click())
    act(() => { deleteActiveSet(0, 0) })
    expect(useCardioClock.getState().run).toMatchObject({ i: 1 })
    expect(btn('Set 2: Stop timing')).toBeTruthy()
    later(5 * 60 * 1000)
    // A row below it: without the drop the clock would land on that set.
    act(() => { deleteActiveSet(0, 1) })
    expect(useCardioClock.getState().run).toBeNull()
    expect(container.querySelector('button[aria-label$=": Stop timing"]')).toBeNull()
    expect(rows()).toEqual([set(21), set(23)])
  })

  it('carries on after a reload, and ignores one kept from another workout', () => {
    localStorage.setItem(CARDIO_CLOCK_KEY, JSON.stringify({ wid: 'clock-test', idx: 0, i: 0, id: TREADMILL, startedAt: T0 - 5 * 60 * 1000 }))
    restoreCardioClock()
    mount([{ min: 20, speed: 5, done: false }])
    expect(face().textContent).toBe('5:00')
    expect(btn('Set 1: Stop timing')).toBeTruthy()
    act(() => root.unmount()); container.remove(); root = null

    localStorage.setItem(CARDIO_CLOCK_KEY, JSON.stringify({ wid: 'yesterday', idx: 0, i: 0, id: TREADMILL, startedAt: T0 - 5 * 60 * 1000 }))
    restoreCardioClock()
    mount([{ min: 20, speed: 5, done: false }])
    expect(face()).toBeNull()
    expect(btn('Set 1: Start timing')).toBeTruthy()
    expect(localStorage.getItem(CARDIO_CLOCK_KEY)).toBeNull()
  })

  it('writes its time with no screen mounted, as Finish would stop it', () => {
    mount([{ min: 20, speed: 5, done: false }])
    act(() => btn('Set 1: Start timing').click())
    act(() => root.unmount()); container.remove(); root = null
    vi.setSystemTime(T0 + 40 * 60 * 1000)
    useCardioClock.getState().stop()
    expect(rows()[0].min).toBe(40)
    expect(localStorage.getItem(CARDIO_CLOCK_KEY)).toBeNull()
  })

  it('follows its exercise when it moves past the same exercise logged twice', () => {
    const other = { id: TREADMILL, target: { sets: 1, min: 30, speed: 5 }, sets: [{ min: 30, speed: 5, done: false }] }
    mount([{ min: 20, speed: 5, done: false }], 'clock-test', [other])
    act(() => btn('Set 1: Start timing').click())
    const down = [...container.querySelectorAll('button')].find(b => b.textContent.trim() === 'Move down')
    expect(down).toBeTruthy()
    act(() => down.click())
    later(10 * 60 * 1000)
    act(() => useCardioClock.getState().stop())
    const [first, second] = useStore.getState().S.active.entries
    expect(first.sets[0].min).toBe(30)
    expect(second.sets[0].min).toBe(10)
  })

  it('stands still while the workout is paused', () => {
    mount([{ min: 20, speed: 5, done: false }])
    act(() => btn('Set 1: Start timing').click())
    later(5 * 60 * 1000)
    act(() => useStore.getState().update(s => { pauseWorkout(s.active) }))
    later(10 * 60 * 1000)
    expect(face().textContent).toBe('5:00')
    act(() => useStore.getState().update(s => { resumeWorkout(s.active) }))
    later(2 * 60 * 1000)
    expect(face().textContent).toBe('7:00')
    act(() => btn('Set 1: Stop timing').click())
    expect(rows()[0].min).toBe(7)
  })

  it('stops at the time of a Log set heard of late', () => {
    mount([{ min: 20, speed: 5, done: false }])
    act(() => btn('Set 1: Start timing').click())
    later(30 * 60 * 1000)
    act(() => live.h.setDone(0, 0, { at: T0 + 20 * 60 * 1000 }))
    expect(rows()[0]).toMatchObject({ min: 20, done: true })
  })
})
