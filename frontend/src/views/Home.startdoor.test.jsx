// @vitest-environment happy-dom
// Home is a Today dashboard, not a workout screen: its hero row and shortcut
// button open the Start section (/start) without starting anything. Only an
// already-running session resumes in place (/workout).
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { todayISO } from '../lib/format.js'
import Home from './Home.jsx'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), startShortFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))
import { startFlow, startShortFlow } from '../sheets.jsx'

const routines = [{ id: 'r1', name: 'Push', emoji: null, ex: [{ id: '0025' }] }]

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  nav.mockClear(); startFlow.mockClear(); startShortFlow.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

// Every weekday points at a routine and the weigh-in is off: today is always planned.
const setS = (over = {}) => useStore.setState(s => ({
  S: {
    ...s.S, routines, dayPlan: {}, workouts: [], active: null, weighIn: false,
    week: { 0: ['r1'], 1: ['r1'], 2: ['r1'], 3: ['r1'], 4: ['r1'], 5: ['r1'], 6: ['r1'] }, ...over,
  },
  user: null,
}))
const mount = () => act(() => root.render(<Home />))
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))

describe('Home — shortcuts open Start without starting anything', () => {
  it('tapping the today row opens Start, it does not start the plan', () => {
    setS(); mount()
    click(host.querySelector('.today-row'))
    expect(nav).toHaveBeenCalledWith('/start')
    expect(startFlow).not.toHaveBeenCalled()
    expect(startShortFlow).not.toHaveBeenCalled()
  })

  it('the Start shortcut opens Start without starting anything', () => {
    setS(); mount()
    click(button('Start'))
    expect(nav).toHaveBeenCalledWith('/start')
    expect(startFlow).not.toHaveBeenCalled()
    expect(startShortFlow).not.toHaveBeenCalled()
  })

  it('on a rest day the single action opens Start without starting anything', () => {
    setS({ week: {} }); mount()
    click(button('Choose a workout'))
    expect(nav).toHaveBeenCalledWith('/start')
    expect(startFlow).not.toHaveBeenCalled()
  })

  it('a finished today offers another workout through Start, not straight into one', () => {
    setS({ workouts: [{ d: todayISO(), name: 'Push', entries: [] }] }); mount()
    click(button('Log another workout'))
    expect(nav).toHaveBeenCalledWith('/start')
    expect(startFlow).not.toHaveBeenCalled()
  })

  it('a running session still resumes in place', () => {
    setS({ active: { id: 'a', name: 'Push', start: Date.now(), cur: 0, entries: [] } })
    mount()
    const row = host.querySelector('.today-row')
    expect(row.querySelector('.lbl2').textContent).toBe('In progress')
    expect(row.querySelector('.tag').textContent).toBe('Resume')
    click(row)
    expect(nav).toHaveBeenCalledWith('/workout')
    click(button('Resume workout'))
    expect(nav).toHaveBeenCalledWith('/workout')
  })

  it('reads an open editor on a saved workout as an edit, not as a session in progress', () => {
    setS({ active: { id: 'w', name: 'Push', start: 1000, cur: 0, entries: [], editingWorkoutId: 'w' } })
    mount()
    const row = host.querySelector('.today-row')
    expect(row.querySelector('.ttl').textContent).toBe('Push')
    expect(row.querySelector('.tag').textContent).toBe('Edit')
    click(row)
    expect(nav).toHaveBeenCalledWith('/workout')
  })
})
