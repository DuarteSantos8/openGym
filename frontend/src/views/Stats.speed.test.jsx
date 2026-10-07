// @vitest-environment happy-dom
// Stats charts cardio at its top speed per workout — in mph for a profile that reads mph
// (Discord "miles per hour"), from the km/h the sets are stored in.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Stats from './Stats.jsx'

const mocks = vi.hoisted(() => ({ charts: [], S: null }))
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: mocks.S }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: () => {}, goalSheet: () => {}, calendarSheet: () => {}, workoutDetailSheet: () => {}, exerciseHistorySheet: () => {},
  WorkoutRow: () => null, bwDeltaColor: () => 'inherit',
}))
vi.mock('../components/LineChart.jsx', () => ({ default: props => { mocks.charts.push(props); return null } }))
vi.mock('../components/Heatmap.jsx', () => ({ default: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null, BodyMapLegend: () => null }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const BIKE = '2138'
const session = (d, speeds) => ({
  id: d, d, start: Date.parse(d + 'T10:00:00Z'), end: Date.parse(d + 'T10:40:00Z'), name: 'Cardio',
  entries: [{ id: BIKE, target: { id: BIKE, sets: speeds.length, min: 20, speed: 8 }, sets: speeds.map(speed => ({ min: 20, speed, done: true })) }],
})
let root, host
afterEach(() => { act(() => root.unmount()); host.remove(); mocks.charts = [] })

function mount(settings) {
  mocks.S = { body: 'male', effort: 'none', targetW: null, bodyweight: [], routines: [], exWeights: {}, ...settings,
    workouts: [session('2026-09-01', [8, 9.66]), session('2026-09-08', [16.09])] }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Stats />))
  return mocks.charts.find(c => c.color === 'var(--blue)')
}

describe('Stats — cardio speed', () => {
  it('charts and names the best speed in mph for a pound profile', () => {
    const chart = mount({ unit: 'lb' })
    expect(chart.unit).toBe('mph')
    expect(chart.points.map(p => p.y)).toEqual([6, 10])
    expect(host.textContent).toContain('10 mph')
    expect(host.textContent).toContain('20 min @ 10 mph')
  })

  it('keeps km/h for a kg profile', () => {
    const chart = mount({ unit: 'kg' })
    expect(chart.unit).toBe('km/h')
    expect(chart.points.map(p => p.y)).toEqual([9.66, 16.09])
    expect(host.textContent).toContain('16.1 km/h')
  })
})
