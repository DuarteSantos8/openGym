// @vitest-environment happy-dom
// A hold (a timed set) is app-wide: its bar and its countdown live in useUI, not in the workout.
// A session that ends somewhere the hold is not stopped (another tab finishing it, a sync that
// takes the session away) leaves the hold counting; the next session must not inherit it, or its
// end ticks a row of the new session — the same exercise at the same place, when the new one
// repeats the old (#165). Finish and Discard stop it already; so does every way of starting one.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { beginWorkout, repeatWorkout, logPastWorkoutSheet } from './sheets.jsx'
import { setNav } from './lib/nav.js'
import { EXDB } from './lib/exercises.js'

const clone = v => JSON.parse(JSON.stringify(v))
const PLANK = EXDB.find(e => e.bp !== 'cardio').id
const mounted = []
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
function mountTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}

// A hold on the first row of the first exercise, left over from a session that is gone: no
// handler of its own (the screen that started it is gone too), only its owner, as after a reload.
const leftOverHold = () => {
  useUI.getState().startWork(30, 'Plank', null, { idx: 0, i: 0, id: PLANK })
  useStore.getState().update(s => { s.active = null })
  expect(useUI.getState().work).not.toBeNull()
}
const firstRow = () => useStore.getState().S.active.entries[0].sets[0]

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  localStorage.clear()
  setNav(() => {})
  const st = clone(DEF)
  st.weighIn = false
  st.routines = [{ id: 'r1', name: 'Core', ex: [{ id: PLANK, sets: 2, reps: 5, weight: 0 }] }]
  st.workouts = [{ id: 'w-old', d: '2026-09-10', start: 1, end: 2, name: 'Core', prs: [], routineIds: [],
    entries: [{ id: PLANK, target: { mode: 'reps', reps: 5, weight: 0 }, sets: [{ w: 0, r: 5, done: true }, { w: 0, r: 5, done: true }] }] }]
  st.active = { id: 'old', d: '2026-09-10', start: Date.now(), cur: 0, entries: [{ id: PLANK, target: { mode: 'reps', reps: 5 }, sets: [{ w: 0, r: 5 }] }] }
  useStore.setState({ S: st, user: null })
  useUI.setState({ sheets: [], timer: null, work: null })
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(r => r.unmount()) })
  document.body.innerHTML = ''
  useUI.getState().stopWork()
  useUI.getState().stopRest()
  vi.useRealTimers()
})

describe('a hold left over from a session that ended elsewhere', () => {
  it('is stopped when a workout starts, and never ticks a row of it', () => {
    leftOverHold()
    act(() => beginWorkout(['r1']))
    expect(useUI.getState().work).toBeNull()
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(firstRow().done).toBeFalsy()
  })

  it('is stopped when a saved workout is repeated today', () => {
    leftOverHold()
    act(() => repeatWorkout(useStore.getState().S.workouts[0]))
    expect(useStore.getState().S.active.entries[0].id).toBe(PLANK)
    expect(useUI.getState().work).toBeNull()
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(firstRow().done).toBeFalsy()
  })

  it('is stopped when a past workout is logged', () => {
    vi.setSystemTime(new Date(2026, 7, 26, 21, 0))              // today's 18:00 default is over
    leftOverHold()
    logPastWorkoutSheet()
    const host = mountTopSheet()
    act(() => { button(host, 'Continue').click() })
    expect(useStore.getState().S.active?.backfill).toBeTruthy()
    expect(useUI.getState().work).toBeNull()
  })
})
