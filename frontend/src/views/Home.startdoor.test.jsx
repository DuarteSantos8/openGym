// @vitest-environment happy-dom
// The Start button in the tab bar (components/TabBar.jsx) and Home's today row both go straight
// into today's planned session the moment there is one, and only fall through to the Start
// screen when nothing is planned. So on any day with a routine, a freestyle session and the
// "Other routines" list are unreachable — the only other way in, "Choose a different workout"
// on the weigh-in sheet, does not exist with the weigh-in switched off. Home carries that door.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { startFlow } from '../sheets.jsx'
import Home from './Home.jsx'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '',
}))

const routines = [{ id: 'r1', name: 'Push', emoji: null, ex: [{ id: '0025' }] }]

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  nav.mockClear(); startFlow.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

// Every weekday points at a routine and the weigh-in is off: today is always planned, and the
// weigh-in sheet's own way through to the Start screen never opens.
const setS = (over = {}) => useStore.setState(s => ({
  S: {
    ...s.S, routines, dayPlan: {}, workouts: [], active: null, weighIn: false,
    week: { 0: ['r1'], 1: ['r1'], 2: ['r1'], 3: ['r1'], 4: ['r1'], 5: ['r1'], 6: ['r1'] }, ...over,
  },
  user: null,
}))
const mount = () => act(() => root.render(<Home />))
const door = () => [...host.querySelectorAll('button')].find(b => b.textContent.includes('Choose a different workout'))

describe('Home — the way to the Start screen when a plan already owns today', () => {
  it('offers the door on a planned day, where the Start button would start the plan', () => {
    setS(); mount()
    expect(door()).toBeTruthy()
  })

  it('opens the Start screen without starting anything', () => {
    setS(); mount()
    act(() => { door().dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(nav).toHaveBeenCalledWith('/workout')
    expect(startFlow).not.toHaveBeenCalled()
  })

  it('is still there on a rest day, where freestyle is the only thing left to start', () => {
    setS({ week: {} }); mount()
    expect(door()).toBeTruthy()
  })

  it('goes away once a session is running — that screen resumes it, it does not choose', () => {
    setS({ active: { id: 'a', name: 'Push', start: Date.now(), cur: 0, entries: [] } })
    mount()
    expect(door()).toBeFalsy()
  })
})
