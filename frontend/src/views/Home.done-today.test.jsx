// @vitest-environment happy-dom
// Discord "Home: tapping the finished workout should show its details": once today's routine is
// logged, the today row opens that workout instead of starting the routine again. A second
// session is still one tap away, from the sheet's Start another session.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { workoutDetailSheet } from '../sheets.jsx'
import { startOrPreview } from '../components/StartSheets.jsx'
import { todayISO } from '../lib/format.js'
import Home from './Home.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(), workoutDetailSheet: vi.fn(),
}))
vi.mock('../components/StartSheets.jsx', () => ({ startPickerSheet: vi.fn(), startOrPreview: vi.fn() }))

const routines = [{ id: 'r1', name: 'Push', emoji: null, ex: [{ id: '0025' }] }]
const week = { 0: ['r1'], 1: ['r1'], 2: ['r1'], 3: ['r1'], 4: ['r1'], 5: ['r1'], 6: ['r1'] }

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  workoutDetailSheet.mockClear(); startOrPreview.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const setS = (over = {}) => useStore.setState(s => ({
  S: { ...s.S, routines, dayPlan: {}, workouts: [], active: null, weighIn: false, week, ...over },
  user: null,
}))
const tapToday = () => act(() => { host.querySelector('.today-row').dispatchEvent(new MouseEvent('click', { bubbles: true })) })

describe('Home: the today row once today is done', () => {
  it('opens the finished workout, with Start another session for a second one', () => {
    const w = { id: 'w1', name: 'Push', d: todayISO(), start: Date.now() - 3600e3, end: Date.now(), routineIds: ['r1'], entries: [] }
    setS({ workouts: [w] })
    act(() => root.render(<Home />))
    tapToday()
    expect(startOrPreview).not.toHaveBeenCalled()
    expect(workoutDetailSheet).toHaveBeenCalledTimes(1)
    const [shown, opts] = workoutDetailSheet.mock.calls[0]
    expect(shown.id).toBe('w1')
    opts.again()
    expect(startOrPreview).toHaveBeenCalledWith(['r1'])
  })

  it('still starts today’s routine while it is not done', () => {
    setS()
    act(() => root.render(<Home />))
    tapToday()
    expect(workoutDetailSheet).not.toHaveBeenCalled()
    expect(startOrPreview).toHaveBeenCalledWith(['r1'])
  })

  it('lists every workout done today, in order, each opening its own (#1538)', () => {
    const now = Date.now()
    const a = { id: 'w1', name: 'Push', d: todayISO(), start: now - 7200e3, end: now - 5400e3, routineIds: ['r1'], entries: [] }
    const b = { id: 'w2', name: 'Evening run', d: todayISO(), start: now - 3600e3, end: now, routineIds: [], entries: [] }
    setS({ workouts: [b, a] })
    act(() => root.render(<Home />))
    const rows = [...host.querySelectorAll('.today-row')]
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('Push')
    expect(rows[0].textContent).toContain('1 of 2')
    expect(rows[1].textContent).toContain('Evening run')
    act(() => { rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(workoutDetailSheet.mock.calls[0][0].id).toBe('w1')
    act(() => { rows[1].dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(workoutDetailSheet.mock.calls[1][0].id).toBe('w2')
    expect(startOrPreview).not.toHaveBeenCalled()
  })
})
