// @vitest-environment happy-dom
// Issue #632 companion: the Home weight card draws the same bodyweight entries and must place
// them by their own date too — the change stamp `t` (fresh for a whole imported history) is not
// the day they were weighed.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import Home from './Home.jsx'

const mocks = vi.hoisted(() => ({ charts: [] }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))
vi.mock('../components/LineChart.jsx', () => ({ default: props => { mocks.charts.push(props); return null } }))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); mocks.charts = [] })

const noonOf = d => new Date(d + 'T12:00:00').getTime()
const mountWith = bodyweight => {
  useStore.setState(s => ({
    S: { ...s.S, routines: [], workouts: [], bodyweight, dayPlan: {}, week: {}, active: null, showWeightCard: true },
    user: null,
  }))
  act(() => root.render(<Home />))
}

describe('Home body-weight card points', () => {
  it('places imported weigh-ins on their own days, not on the import moment', () => {
    const stamp = Date.now()   // what the store's stampChange leaves on a fresh import
    const imported = [
      { d: '2021-01-05', w: 90, t: stamp },
      { d: '2021-06-05', w: 89, t: stamp },
      { d: '2022-12-01', w: 76.3, t: stamp },
    ]
    mountWith(imported)
    const chart = mocks.charts.find(c => c.h === 130)   // the weight card's chart
    expect(chart.points.map(p => p.t)).toEqual(imported.map(b => noonOf(b.d)))
    expect(chart.points.map(p => p.y)).toEqual([90, 89, 76.3])
    expect(chart.points.map(p => p.d)).toEqual(imported.map(b => b.d))
  })
})
