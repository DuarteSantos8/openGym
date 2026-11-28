// @vitest-environment happy-dom
// Stats → Effort (2026-11-24): with enough real ratings the card reads them alone; the estimate,
// which takes the best set of the last 90 days as all-out, only stands in for a history with too
// few, and then says so.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Stats from './Stats.jsx'

const mocks = vi.hoisted(() => ({ S: null }))
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: mocks.S }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: () => {}, goalSheet: () => {}, calendarSheet: () => {}, workoutDetailSheet: () => {}, exerciseHistorySheet: () => {},
  WorkoutRow: () => null, bwDeltaColor: () => 'inherit', weighInsSheet: () => {}, dayOverrideSheet: () => {},
}))
vi.mock('../components/LineChart.jsx', () => ({ default: () => null }))
vi.mock('../components/Heatmap.jsx', () => ({ default: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null, BodyMapLegend: () => null }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const DAY = 86400000
const S1 = (w, r, x = {}) => ({ w, r, done: true, ...x })
const W = (id, ago, entries) => { const start = Date.now() - ago * DAY; return { id, d: new Date(start).toISOString().slice(0, 10), start, end: start + 3600000, entries } }
let root, host
afterEach(() => { act(() => root.unmount()); host.remove() })
function mount(workouts) {
  mocks.S = { body: 'male', effort: 'rir', unit: 'kg', targetW: null, bodyweight: [{ d: '2026-11-01', w: 80 }], routines: [], exWeights: {}, workouts }
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Stats />))
  return host.querySelector('.effort-card')
}

describe('Effort card reads real ratings', () => {
  it('six rated sets of nineteen: the ratings alone, 1.5 RIR, nothing estimated', () => {
    // The audit profile: the unrated top sets estimated at ~0 RIR used to pull this to 0.8 RIR
    // and "100% hard".
    const card = mount([
      W('a', 21, [{ id: '0025', sets: [S1(80, 5), S1(80, 5), S1(80, 4)] }, { id: '3593', sets: [S1(100, 5), S1(100, 5), S1(100, 5)] }]),
      W('b', 14, [{ id: '0025', sets: [S1(82.5, 5), S1(82.5, 5), S1(82.5, 3)] }, { id: '0652', sets: [S1(null, 8), S1(null, 8), S1(null, 6)] }]),
      W('c', 7, [{ id: '0025', sets: [S1(85, 3, { rir: 1 }), S1(85, 3, { rir: 1 }), S1(85, 3, { rir: 1 })] }]),
      W('d', 1, [{ id: '3593', sets: [S1(105, 5, { rir: 2 }), S1(105, 5, { rir: 2 }), S1(105, 5, { rir: 2 })] }]),
    ])
    expect(card.querySelector('.stat-v').textContent.trim()).toBe('1.5 RIR')
    expect(card.querySelector('h2').textContent).not.toContain('estimated')
    expect(card.textContent).toContain('6 of 18 finished sets rated')
    expect(card.querySelector('[data-effort-estimated]')).toBeNull()
  })
  it('nothing rated: the estimate, labelled, with the line on what it assumes', () => {
    const card = mount([
      W('a', 14, [{ id: '0025', sets: [S1(80, 5), S1(80, 5), S1(80, 4)] }]),
      W('b', 7, [{ id: '0025', sets: [S1(82.5, 5), S1(82.5, 5), S1(82.5, 3)] }]),
    ])
    expect(card.querySelector('h2').textContent).toContain('estimated')
    expect(card.querySelector('[data-effort-estimated]').textContent).toContain('best set of the last 90 days as all-out')
  })
})
