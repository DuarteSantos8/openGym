// @vitest-environment happy-dom
// Stats and the body scale: the QR button in the page header scans, "Body data" under More opens
// the scans (views/BodyScan.jsx) in a sheet. There is no tab of its own any more.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Stats from './Stats.jsx'
import { useUI } from '../store/useUI.js'

const mocks = vi.hoisted(() => ({ S: null, config: null }))
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: mocks.S, config: mocks.config }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: () => {}, goalSheet: () => {}, calendarSheet: () => {}, workoutDetailSheet: () => {}, exerciseHistorySheet: () => {},
  weighInsSheet: () => {}, WorkoutRow: () => null, bwDeltaColor: () => 'inherit',
}))
vi.mock('../components/LineChart.jsx', () => ({ default: () => null }))
vi.mock('../components/Heatmap.jsx', () => ({ default: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null, BodyMapLegend: () => null }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const v = Array.from({ length: 64 }, () => 1)
v[0] = 78.4; v[3] = 22.8; v[21] = 27.4
const SCAN = [{ d: '2026-01-03', t: 1, scan: { len: 64, v } }]
const roots = []
let host

beforeEach(() => useUI.setState({ sheets: [] }))
afterEach(() => {
  act(() => roots.splice(0).forEach(r => r.unmount()))
  document.body.innerHTML = ''
  mocks.config = null
})

function render(node) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  roots.push(root)
  act(() => root.render(node))
  return el
}
function mount(measurements = SCAN, bodyweight = []) {
  mocks.S = {
    body: 'male', effort: 'none', unit: 'kg', targetW: null, bodyweight, routines: [], exWeights: {}, workouts: [],
    measurements,
  }
  host = render(<Stats />)
}
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent === label)
const scanButton = () => host.querySelector('.hdr button[aria-label="Scan body scan code"]')
const bodyDataRow = () => [...host.querySelectorAll('[data-stats-links] .stats-link')].find(r => r.textContent.includes('Body data'))

describe('Stats: the body scale', () => {
  it('has no tab; Body data under More opens the scan and the segment analysis in a sheet', () => {
    mount()
    expect(host.querySelector('.seg-range')).toBeTruthy()
    expect(button('Training')).toBeUndefined()
    expect(host.querySelector('.bodyseg')).toBeNull()

    const row = bodyDataRow()
    expect(row).toBeTruthy()
    act(() => row.click())
    const sheet = useUI.getState().sheets.at(-1)
    const el = render(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
    expect(el.querySelector('h3').textContent).toBe('Body data')
    expect(el.textContent).toContain('Segment analysis')
    expect(el.querySelector('.bodyseg-trunk .bodyseg-v').textContent).toBe('27.4 kg')
  })

  it('is not on the Body weight card, and only there with a scan to show', () => {
    mount(SCAN, [{ d: '2026-01-03', w: 78.4, t: 1 }])
    expect(button('All data')).toBeUndefined()
    expect(button('All weigh-ins')).toBeTruthy()
    expect(host.querySelector('.bw-head button[aria-label="Scan body scan code"]')).toBeNull()
    mount([], [{ d: '2026-01-03', w: 78.4, t: 1 }])
    expect(bodyDataRow()).toBeUndefined()
  })

  it('scans from the page header; switched off: no scanning, the scans stay readable', () => {
    mount([])
    expect(scanButton()).toBeTruthy()
    mocks.config = { features: { bodyScale: false } }
    mount()
    expect(scanButton()).toBeNull()
    expect(bodyDataRow()).toBeTruthy()
  })
})
