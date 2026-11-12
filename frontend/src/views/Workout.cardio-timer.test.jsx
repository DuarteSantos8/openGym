// @vitest-environment happy-dom
// The clock on a cardio segment (views/Workout.jsx startCardio) and the plans an exercise can be
// given (components/CardioPlansSheet.jsx), against the real store and work timer: the segment
// counts its minutes down, says what to set the machine to and what comes next, logs the minutes it
// really ran on an early Done, and starts the next segment by itself unless the exercise rests.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { savePlan, newPlan } from '../lib/cardio-plans.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), appBase: () => '/' }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const TREADMILL = '2259'   // walking on treadmill
const BIKE = '2138'        // stationary bike
const clone = value => JSON.parse(JSON.stringify(value))
const seg = (min, speed, incline) => ({ min, speed, ...(incline ? { incline } : {}), done: false })
const entry = (id, sets, target = {}) => ({ id, target: { sets: sets.length, min: 20, speed: 5, ...target }, sets })

let root
let container

function renderWorkout(entries, more = {}) {
  const S = clone(DEF)
  S.active = { id: 'cardio-test', d: '2026-11-12', start: Date.now(), routineId: null, name: 'Cardio', bw: null, cur: 0, entries }
  Object.assign(S, more)
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}
const sets = () => useStore.getState().S.active.entries[0].sets
const goButtons = () => [...container.querySelectorAll('button[aria-label="Start set"]')]

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
  root = null
  container = null
})
afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('the clock on a cardio segment', () => {
  it('has a play button on every cardio row, and none on a rep exercise', () => {
    renderWorkout([entry(TREADMILL, [seg(3, 5, 4), seg(3, 5.4, 7)])])
    expect(goButtons()).toHaveLength(2)
    act(() => root.unmount()); container.remove(); root = null
    renderWorkout([{ id: '0576', target: { sets: 1, reps: 10 }, sets: [{ w: 20, r: 10, done: false }] }])
    expect(goButtons()).toHaveLength(0)
  })

  it('counts the minutes down and says what to set the machine to, and what comes next', () => {
    renderWorkout([entry(TREADMILL, [seg(3, 5, 4), seg(3, 5.4, 7)])])
    act(() => goButtons()[0].click())
    const work = useUI.getState().work
    expect(work.total).toBe(180)
    expect(work.owner).toMatchObject({ idx: 0, i: 0, cardio: true })
    expect(work.label).toMatch(/segment 1 of 2/)
    expect(work.detail).toBe('5 km/h · 4% incline')
    expect(work.next).toBe('Next: 3 min @ 5.4 km/h · 7% incline')
  })

  it('a segment that runs out ticks its row and starts the next one by itself, with no rest between', () => {
    renderWorkout([entry(TREADMILL, [seg(1, 5, 4), seg(1, 5.4, 7), seg(1, 5.6, 10)])])
    act(() => goButtons()[0].click())
    act(() => { vi.advanceTimersByTime(61_000) })
    expect(sets().map(s => s.done)).toEqual([true, false, false])
    expect(useUI.getState().timer).toBe(null)
    expect(useUI.getState().work.owner).toMatchObject({ i: 1, cardio: true })
    expect(useUI.getState().work.detail).toBe('5.4 km/h · 7% incline')
    expect(useUI.getState().work.next).toBe('Next: 1 min @ 5.6 km/h · 10% incline')
    act(() => { vi.advanceTimersByTime(61_000) })
    expect(sets().map(s => s.done)).toEqual([true, true, false])
    // The last one has nothing after it.
    expect(useUI.getState().work.next).toBeUndefined()
    act(() => { vi.advanceTimersByTime(61_000) })
    expect(sets().map(s => s.done)).toEqual([true, true, true])
    expect(useUI.getState().work).toBe(null)
    // It was the workout's only exercise: the finish sheet opens instead of the toast.
    expect(useUI.getState().sheets.length).toBeGreaterThan(0)
    // Minutes were not rewritten: they ran to the end.
    expect(sets().map(s => s.min)).toEqual([1, 1, 1])
  })

  it('an early Done logs the minutes it really ran, and the next segment still follows', () => {
    renderWorkout([entry(TREADMILL, [seg(10, 5), seg(5, 6)])])
    act(() => goButtons()[0].click())
    act(() => { vi.advanceTimersByTime(4 * 60_000 + 10_000) })
    act(() => useUI.getState().finishWorkEarly())
    expect(sets()[0]).toMatchObject({ done: true, min: 4 })
    expect(useUI.getState().work.owner).toMatchObject({ i: 1 })
  })

  it('an exercise with a rest of its own rests, and waits for the next play button', () => {
    renderWorkout([entry(TREADMILL, [seg(1, 5), seg(1, 6)], { restSec: 45 })])
    act(() => goButtons()[0].click())
    act(() => { vi.advanceTimersByTime(61_000) })
    expect(sets().map(s => s.done)).toEqual([true, false])
    expect(useUI.getState().work).toBe(null)
    expect(useUI.getState().timer).not.toBe(null)
  })

  it('a bike segment shows its speed alone', () => {
    renderWorkout([entry(BIKE, [seg(5, 25)])])
    act(() => goButtons()[0].click())
    expect(useUI.getState().work.detail).toBe('25 km/h')
    expect(useUI.getState().work.label).not.toMatch(/segment/)
  })

  it('cancelling the clock leaves the row as it was', () => {
    renderWorkout([entry(TREADMILL, [seg(5, 5)])])
    act(() => goButtons()[0].click())
    act(() => { vi.advanceTimersByTime(90_000) })
    act(() => useUI.getState().stopWork())
    expect(sets()[0]).toMatchObject({ done: false, min: 5 })
  })
})

describe('choosing a plan from the exercise menu', () => {
  const planSheet = () => {
    const sheet = useUI.getState().sheets.at(-1)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const r = createRoot(host)
    act(() => r.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
    return { host, unmount: () => { act(() => r.unmount()); host.remove() } }
  }
  const openPlans = () => {
    act(() => container.querySelector('button[aria-label="More"]').click())
    const menu = useUI.getState().sheets.at(-1)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const r = createRoot(host)
    act(() => r.render(menu.render(() => useUI.getState().closeSheet(menu.id))))
    const item = [...host.querySelectorAll('*')].find(n => n.children.length === 0 && n.textContent === 'Cardio plans')
    expect(item).toBeTruthy()
    act(() => item.closest('button, .item, [role="button"]').click())
    act(() => r.unmount()); host.remove()
  }

  it('is offered on a cardio exercise and its rows become the plan, the grade kept on a treadmill', () => {
    const S = clone(DEF)
    savePlan(S, newPlan('Hills', [{ min: 3, speed: 5, incline: 4 }, { min: 3, speed: 5.4, incline: 7 }], 5))
    renderWorkout([entry(TREADMILL, [seg(20, 5)])], { cardioPlans: S.cardioPlans })
    openPlans()
    const { host, unmount } = planSheet()
    const pick = host.querySelector('.cardio-plan-pick')
    expect(pick.textContent).toContain('Hills')
    act(() => pick.click())
    expect(sets()).toEqual([
      { min: 3, speed: 5, incline: 4, done: false },
      { min: 3, speed: 5.4, incline: 7, done: false },
    ])
    expect(useUI.getState().toastMsg).toBe('Plan loaded: Hills')
    unmount()
  })

  it('on a bike the grade is left off, and a segment already done stays', () => {
    const S = clone(DEF)
    savePlan(S, newPlan('Spin', [{ min: 3, speed: 25, incline: 4 }], 5))
    renderWorkout([entry(BIKE, [{ min: 10, speed: 20, done: true }, seg(10, 20)])], { cardioPlans: S.cardioPlans })
    openPlans()
    const { host, unmount } = planSheet()
    act(() => host.querySelector('.cardio-plan-pick').click())
    expect(sets()).toEqual([{ min: 10, speed: 20, done: true }, { min: 3, speed: 25, done: false }])
    unmount()
  })
})
