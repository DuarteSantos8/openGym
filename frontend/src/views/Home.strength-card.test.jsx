// @vitest-environment happy-dom
// The favourite-lifts card: shown once there are favourites, one row per favourite with an
// estimated 1RM, a hint while none of them has one, hidden by its Settings switch, and a tap on
// a row opening that exercise's history.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { exerciseHistorySheet } from '../sheets.jsx'
import Home from './Home.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', exerciseHistorySheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  exerciseHistorySheet.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const start = Date.now() - 2 * 86400000
const bench = { d: new Date(start).toISOString().slice(0, 10), start, entries: [{ id: '0025', sets: [{ w: 100, r: 5, done: true }] }] }

const mountWith = over => {
  useStore.setState(s => ({
    S: { ...s.S, routines: [], workouts: [bench], bodyweight: [], dayPlan: {}, week: {}, active: null, unit: 'kg', favEx: [], showStrengthCard: true, ...over },
    user: null,
  }))
  act(() => root.render(<Home />))
}
const card = () => [...host.querySelectorAll('h2')].find(el => el.textContent === 'Favourite lifts')?.closest('.card')

describe('Home favourite-lifts card', () => {
  it('stays away for a profile without favourites', () => {
    mountWith({ favEx: [] })
    expect(card()).toBeFalsy()
  })

  it('shows the best estimated 1RM of a favourite, with the set behind it', () => {
    mountWith({ favEx: ['0025'] })
    const rows = card().querySelectorAll('.item')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('116.7 kg')
    expect(rows[0].textContent).toContain('100 kg × 5')
  })

  it('shows a hint while no favourite has an estimate yet', () => {
    mountWith({ favEx: ['0043'] })
    expect(card().querySelectorAll('.item')).toHaveLength(0)
    expect(card().textContent).toContain('Log a weighted set of a favourite exercise')
  })

  it('is hidden by its Settings switch', () => {
    mountWith({ favEx: ['0025'], showStrengthCard: false })
    expect(card()).toBeFalsy()
  })

  it('draws a trend line once there are two sessions, not before', () => {
    mountWith({ favEx: ['0025'] })
    expect(card().querySelector('.sparkline')).toBeFalsy()
    const later = { ...bench, start: bench.start + 3600000, entries: [{ id: '0025', sets: [{ w: 105, r: 5, done: true }] }] }
    mountWith({ favEx: ['0025'], workouts: [bench, later] })
    expect(card().querySelector('.sparkline path')).toBeTruthy()
  })

  it('opens the exercise history on a tap', () => {
    mountWith({ favEx: ['0025'] })
    act(() => card().querySelector('.item').click())
    expect(exerciseHistorySheet).toHaveBeenCalledWith('0025', { curve: 'e1rm' })
  })
})
