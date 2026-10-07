// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import Home from './Home.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), startShortFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mountWith = showWeightCard => {
  useStore.setState(s => ({
    S: { ...s.S, routines: [], workouts: [], bodyweight: [], dayPlan: {}, week: {}, active: null, showWeightCard },
    user: null,
  }))
  act(() => root.render(<Home />))
}
const weightHeading = () => [...host.querySelectorAll('h2')].find(el => el.textContent === 'Body weight')

describe('Home body-weight card preference', () => {
  it('shows the card for legacy profiles without the preference', () => {
    mountWith(undefined)
    expect(weightHeading()).toBeTruthy()
  })

  it('shows the card when enabled', () => {
    mountWith(true)
    expect(weightHeading()).toBeTruthy()
  })

  it('hides only the Home card when disabled', () => {
    mountWith(false)
    expect(weightHeading()).toBeFalsy()
  })
})

describe('Home trend sentence follows the fitted trend', () => {
  const mountBW = weights => {
    useStore.setState(s => ({
      S: {
        ...s.S, routines: [], workouts: [], dayPlan: {}, week: {}, active: null,
        showWeightCard: true, bodyweight: weights.map(([d, w]) => ({ d, w })),
      },
      user: null,
    }))
    act(() => root.render(<Home />))
  }
  const trendLine = () => [...host.querySelectorAll('.card .small.muted')].map(el => el.textContent).find(t => t.includes('Weekly average'))

  it('states the weekly rate when the trend is meaningful', () => {
    mountBW([['2026-02-02', 80], ['2026-02-09', 79.5], ['2026-02-16', 79], ['2026-02-23', 78.5]])
    expect(trendLine()).toContain('Weekly average -0.5 kg/wk over 4 weeks.')
  })

  it('states the plain last-week difference with no direction word when it is noise', () => {
    mountBW([['2026-02-02', 80], ['2026-02-09', 81], ['2026-02-16', 80], ['2026-02-23', 81]])
    const line = trendLine()
    expect(line).toContain('vs previous logged week.')
    expect(line).not.toMatch(/down|up|steady/)
  })
})