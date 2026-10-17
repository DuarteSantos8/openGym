// @vitest-environment happy-dom
// Stats' Body data tab: Training stays the default, the toggle swaps to the body-scale view
// (views/BodyScan.jsx), and /stats?tab=body opens on it.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Stats from './Stats.jsx'

const mocks = vi.hoisted(() => ({ S: null }))
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: mocks.S }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: () => {}, goalSheet: () => {}, calendarSheet: () => {}, workoutDetailSheet: () => {}, exerciseHistorySheet: () => {},
  WorkoutRow: () => null, bwDeltaColor: () => 'inherit',
}))
vi.mock('../components/LineChart.jsx', () => ({ default: () => null }))
vi.mock('../components/Heatmap.jsx', () => ({ default: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null, BodyMapLegend: () => null }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const v = Array.from({ length: 64 }, () => 1)
v[0] = 87; v[3] = 26.1; v[21] = 29.6
let root, host
afterEach(() => { act(() => root.unmount()); host.remove(); window.location.hash = '' })

function mount() {
  mocks.S = {
    body: 'male', effort: 'none', unit: 'kg', targetW: null, bodyweight: [], routines: [], exWeights: {}, workouts: [],
    measurements: [{ d: '2026-01-03', t: 1, scan: { len: 64, v } }],
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Stats />))
}
const tab = label => [...host.querySelectorAll('.stats-tabs .seg button')].find(b => b.textContent === label)

describe('Stats: Body data tab', () => {
  it('opens on Training; Body data shows the scan and the segment analysis', () => {
    mount()
    expect(tab('Training').classList.contains('on')).toBe(true)
    expect(host.textContent).toContain('Activity (last 12 months)')
    expect(host.querySelector('.bodyseg')).toBeNull()

    act(() => tab('Body data').click())
    expect(host.textContent).not.toContain('Activity (last 12 months)')
    expect(host.textContent).toContain('Segment analysis')
    expect(host.querySelector('.bodyseg-trunk .bodyseg-v').textContent).toBe('29.6 kg')
  })

  it('/stats?tab=body opens on it', () => {
    window.location.hash = '#/stats?tab=body'
    mount()
    expect(tab('Body data').classList.contains('on')).toBe(true)
    expect(host.querySelector('.bodyseg')).toBeTruthy()
  })
})
