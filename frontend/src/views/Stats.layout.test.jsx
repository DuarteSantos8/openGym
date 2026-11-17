// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Stats, { monthSummary } from './Stats.jsx'
import { buildDemoState } from '../lib/demoSeed.js'
import { DEF } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

const mocks = vi.hoisted(() => ({ S: null, nav: vi.fn() }))
vi.mock('../store/useStore.js', async importOriginal => {
  const actual = await importOriginal()
  const useStore = selector => selector({ S: mocks.S, user: null, config: {} })
  useStore.getState = () => ({ S: mocks.S, update: () => {} })
  return { ...actual, useStore }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: vi.fn(), goalSheet: vi.fn(), calendarSheet: vi.fn(), workoutDetailSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  exerciseHistorySheet: vi.fn(), weighInsSheet: vi.fn(), bwDeltaColor: () => '', WorkoutRow: () => null,
}))
vi.mock('../components/LineChart.jsx', () => ({ default: () => null }))
vi.mock('../components/Heatmap.jsx', () => ({ default: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null, BodyMapLegend: () => null }))

const clone = value => JSON.parse(JSON.stringify(value))
const demo = () => Object.assign(clone(DEF), buildDemoState())
let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  mocks.nav.mockClear()
  useUI.setState({ statsMoreOpen: false })
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); window.location.hash = ''
})
const mount = (S = demo()) => { mocks.S = S; act(() => root.render(<Stats />)) }
const click = element => act(() => element.click())

describe('approved Progress layout', () => {
  it('leads with real exercise progress, then this month, with one labelled History action', () => {
    mount()
    const lifts = host.querySelector('#stats-lifts')
    const month = host.querySelector('[data-month-summary]')
    expect(host.querySelectorAll('h1')).toHaveLength(1)
    expect(host.querySelector('h1').textContent).toBe('Progress')
    expect(lifts.compareDocumentPosition(month) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(month.textContent).toContain('Workouts')
    expect(month.textContent).toContain('Time')
    expect(month.textContent).toContain('Consistency')
    expect(host.querySelector('.hdr .iconbtn')).toBeNull()
    expect(host.querySelector('.iv-stats-more').open).toBe(false)
    expect(host.querySelector('.iv-stats-report').textContent).toContain('Performance report')
    const primary = host.querySelectorAll('.iv-stats-primary .btn.primary')
    expect(primary).toHaveLength(1)
    expect(primary[0].textContent).toBe('All Workouts')
    click(primary[0])
    expect(mocks.nav).toHaveBeenCalledWith('/history')
  })

  it('uses estimated 1RM as the initial chart metric when the exercise supports it', () => {
    mount()
    expect(host.querySelector('#stats-lifts .ex-pick').textContent).toContain('Est. 1RM')
    expect(host.querySelector('#stats-lifts [data-ex-days]')).toBeTruthy()
  })

  it('persists More across a lazy-shell remount', () => {
    mount()
    const details = host.querySelector('.iv-stats-more')
    act(() => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    expect(useUI.getState().statsMoreOpen).toBe(true)
    act(() => root.unmount())
    root = createRoot(host)
    mount()
    expect(host.querySelector('.iv-stats-more').open).toBe(true)
  })

  it('opens More for a deep link into a folded section', () => {
    window.location.hash = '#/stats?section=body'
    mount()
    expect(host.querySelector('.iv-stats-more').open).toBe(true)
  })
})

describe('monthSummary', () => {
  it('counts month-to-date sessions, valid durations and trained elapsed weeks', () => {
    const workout = (id, d, minutes) => ({
      id, d, start: new Date(d + 'T12:00:00').getTime(),
      end: new Date(d + 'T12:00:00').getTime() + minutes * 60000,
    })
    const result = monthSummary([
      workout('old', '2026-10-31', 60),
      workout('first', '2026-11-02', 30),
      workout('unknown', '2026-11-16', 0),
      workout('future', '2026-11-20', 45),
    ], '2026-11-17', 1)
    expect(result).toEqual({ workouts: 2, activeMs: 30 * 60000, consistency: 50 })
  })

  it('returns an honest empty month', () => {
    expect(monthSummary([], '2026-11-17', 1)).toEqual({ workouts: 0, activeMs: 0, consistency: 0 })
  })
})
