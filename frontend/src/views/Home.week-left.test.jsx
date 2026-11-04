// @vitest-environment happy-dom
// #753: Home counts the week's plan down, "2 of 4 left this week", and cheers when it is done.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { todayISO, isoOf } from '../lib/format.js'
import Home from './Home.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const routines = [{ id: 'A', name: 'Push', ex: [] }, { id: 'B', name: 'Pull', ex: [] }]
const mountWith = patch => {
  useStore.setState(s => ({ S: { ...s.S, routines, workouts: [], bodyweight: [], dayPlan: {}, week: {}, active: null, queue: null, rotation: null, scheduleMode: null, weekStart: 1, ...patch }, user: null }))
  act(() => root.render(<Home />))
}
const line = () => host.querySelector('.wkleft')?.textContent

describe('workouts left this week on Home (#753)', () => {
  it('counts the planned days down', () => {
    mountWith({ week: { 1: ['A'], 2: ['B'], 4: ['A'], 6: ['B'] } })
    expect(line()).toBe('4 of 4 left this week')
  })
  it('says so when the week is done', () => {
    mountWith({ week: { 1: ['A'] }, workouts: [{ id: 'w', d: todayISO(), start: Date.now(), name: 'Push', routineIds: ['A'], entries: [] }] })
    expect(line()).toBe('All done this week. Nice.')
  })
  it('says nothing without a plan', () => {
    mountWith({})
    expect(line()).toBeUndefined()
  })
})
void isoOf
