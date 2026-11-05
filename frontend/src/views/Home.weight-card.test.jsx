// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import Home from './Home.jsx'
import { bwSheet, goalSheet, weighInsSheet } from '../sheets.jsx'


vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), weighInsSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mountWith = (showWeightCard, over = {}) => {
  useStore.setState(s => ({
    S: { ...s.S, routines: [], workouts: [], bodyweight: [], dayPlan: {}, week: {}, active: null, showWeightCard, ...over },
    user: null,
  }))
  act(() => root.render(<Home />))
}
const weightHeading = () => [...host.querySelectorAll('.card-head-title')].find(el => el.textContent === 'Body weight')

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

  it('keeps logging, goal editing and full history reachable from the summary', () => {
    mountWith(true, { bodyweight: [{ d: '2026-10-19', w: 78.7 }], unit: 'kg', targetW: 77 })
    const card = weightHeading().closest('.card')
    const log = card.querySelector('[aria-label="Log"]')
    act(() => log.click())
    expect(bwSheet).toHaveBeenCalledOnce()
    act(() => card.querySelector('.home-weight-goal').click())
    expect(goalSheet).toHaveBeenCalledOnce()
    act(() => card.querySelector('[aria-label="All weigh-ins"]').click())
    expect(weighInsSheet).toHaveBeenCalledOnce()
    expect(card.querySelector('.home-weight-value').textContent).toContain('78.7')
    expect(card.textContent).toContain('1.7 kg from goal')
    expect(log.textContent).toBe('')
    expect(card.querySelector('.home-weight-label').textContent).toBe('Latest (Mon 19 Oct)')
    expect(card.querySelector('.home-weight-date')).toBeNull()
  })

  it('offers a goal before the first weigh-in without inventing a reading or change', () => {
    mountWith(true, { targetW: null })
    const card = weightHeading().closest('.card')
    expect(card.querySelector('.home-weight-value')).toBeNull()
    expect(card.querySelector('.home-weight-delta')).toBeNull()
    act(() => card.querySelector('.home-weight-goal').click())
    expect(goalSheet).toHaveBeenCalledOnce()
  })

  it('spreads imported readings across measurement days even when their edit timestamps match', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-21T12:00:00'))
    try {
      const editedAt = Date.now()
      mountWith(true, { bodyweight: [
        { d: '2026-06-01', w: 70, t: editedAt },
        { d: '2026-08-26', w: 64.6, t: editedAt },
        { d: '2026-09-26', w: 65.1, t: editedAt },
        { d: '2026-10-09', w: 65.65, t: editedAt },
      ] })
      const chart = weightHeading().closest('.card').querySelector('polyline')
      const coords = chart.getAttribute('points').split(' ').map(p => p.split(',').map(Number))
      expect(coords).toHaveLength(3)
      expect(coords.flat().every(Number.isFinite)).toBe(true)
      expect(coords[0][0]).toBeLessThan(coords[1][0])
      expect(coords[1][0]).toBeLessThan(coords[2][0])
      expect(coords[2][0] - coords[0][0]).toBeGreaterThan(300)
    } finally {
      vi.useRealTimers()
    }
  })
})
