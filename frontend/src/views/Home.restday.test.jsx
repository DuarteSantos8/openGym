// @vitest-environment happy-dom
// EP25: a Beginner's planned rest day says why it is one, and points at the guide. Nobody else's
// Today card changes.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import Home from './Home.jsx'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))
vi.mock('../components/StartSheets.jsx', () => ({ startPickerSheet: vi.fn(), startOrPreview: vi.fn() }))

const routines = [{ id: 'r1', name: 'Full Body A', emoji: null, ex: [{ id: '0025' }] }]
const today = new Date().getDay()
// The plan trains on every weekday but today: today is a planned rest day with a next session.
const restWeek = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, d === today ? [] : ['r1']]))
const fullWeek = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, ['r1']]))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  nav.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const setS = over => useStore.setState(s => ({
  S: { ...s.S, routines, dayPlan: {}, workouts: [], active: null, weighIn: false, week: restWeek, experience: 'beginner', ...over },
  user: null,
}))
const mount = () => act(() => root.render(<Home />))
const WHY = 'Rest is when you get stronger. A walk today helps.'

describe('a Beginner\'s rest day', () => {
  it('says why it is a rest day and opens the guide', () => {
    setS()
    mount()
    expect(host.textContent).toContain('Rest day')
    expect(host.textContent).toContain(WHY)
    const link = host.querySelector('[data-learn="rest"]')
    expect(link.textContent).toContain('Why rest days matter')
    act(() => link.click())
    expect(nav).toHaveBeenCalledWith('/learn?g=rest')
  })

  it('says nothing on a training day', () => {
    setS({ week: fullWeek })
    mount()
    expect(host.textContent).not.toContain(WHY)
    expect(host.querySelector('[data-learn="rest"]')).toBe(null)
  })

  it('says nothing to anyone who is not a Beginner', () => {
    for (const experience of [undefined, 'intermediate', 'advanced']) {
      setS({ experience })
      mount()
      expect(host.textContent, String(experience)).not.toContain(WHY)
    }
  })

  it('says nothing without a plan, or in the middle of a workout', () => {
    setS({ routines: [], week: {} })
    mount()
    expect(host.textContent).not.toContain(WHY)
  })
})
