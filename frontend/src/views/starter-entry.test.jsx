// @vitest-environment happy-dom
// Home and Plan both offer the starter plan to someone who has no routines yet. Both used to
// wire the button straight to the loader, which quietly handed the click event in as the plan
// id and loaded nothing at all — so both entry points are pinned here.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { starterPlanSheet, workoutToRoutineSheet } from '../sheets.jsx'
import Home from './Home.jsx'
import Plan from './Plan.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), workoutToRoutineSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
  dayAssignSheet: vi.fn(), planToolsSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  starterPlanSheet.mockClear()
  workoutToRoutineSheet.mockClear()
  useStore.setState(s => ({ S: { ...s.S, routines: [], workouts: [], week: {}, active: null }, user: null }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const starterButton = () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Load starter plan')

describe.each([['Home', Home], ['Plan', Plan]])('%s empty state', (_name, View) => {
  it('opens the starter plan chooser instead of loading one plan blind', () => {
    act(() => root.render(<View />))
    const button = starterButton()
    expect(button).toBeTruthy()

    act(() => { button.click() })
    expect(starterPlanSheet).toHaveBeenCalledTimes(1)
  })

  it('drops the offer once the user has routines', () => {
    useStore.setState(s => ({ S: { ...s.S, routines: [{ id: 'r', name: 'Mine', emoji: 'star', ex: [] }] } }))
    act(() => root.render(<View />))
    expect(starterButton()).toBeFalsy()
  })
})

// Plan's empty state also offers a past workout as the first routine, once there is one to copy.
describe('Plan empty state with a history', () => {
  const copyButtons = () => [...host.querySelectorAll('button')].filter(b => b.textContent === 'Copy a workout as a routine')
  const logged = { id: 'w1', d: '2026-09-01', start: 1, end: 2, name: 'Push', entries: [{ id: 'bench', target: { reps: 5 }, sets: [{ w: 40, r: 5, done: true }] }] }
  const setWorkouts = workouts => useStore.setState(s => ({ S: { ...s.S, workouts } }))

  it('has no copy offer without a workout', () => {
    act(() => root.render(<Plan />))
    expect(copyButtons()).toHaveLength(0)
  })

  it('has no copy offer when no workout has an exercise to copy', () => {
    setWorkouts([{ ...logged, entries: [] }])
    act(() => root.render(<Plan />))
    expect(copyButtons()).toHaveLength(0)
  })

  it('offers it beside the starter plan and opens the workout picker', () => {
    setWorkouts([logged])
    act(() => root.render(<Plan />))
    const [button] = copyButtons()
    expect(button).toBeTruthy()
    expect(starterButton()).toBeTruthy()

    act(() => { button.click() })
    expect(workoutToRoutineSheet).toHaveBeenCalledTimes(1)
    expect(starterPlanSheet).not.toHaveBeenCalled()
  })

  it('drops the offer once the user has routines', () => {
    setWorkouts([logged])
    useStore.setState(s => ({ S: { ...s.S, routines: [{ id: 'r', name: 'Mine', emoji: 'star', ex: [] }] } }))
    act(() => root.render(<Plan />))
    expect(copyButtons()).toHaveLength(0)
  })
})
