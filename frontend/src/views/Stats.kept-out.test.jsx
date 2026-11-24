// @vitest-environment happy-dom
// A workout kept out of progression (Discord 2026-11-22) is left out of volume, 1RM and balance
// (lib/counted-log.js), but it was still a workout: the Activity heatmap by time, Recent
// workouts and the streak show it, as History and the calendar do.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Stats from './Stats.jsx'

const mocks = vi.hoisted(() => ({ S: null, heat: [] }))
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: mocks.S }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', async () => {
  const React = await import('react')
  return {
    bwSheet: () => {}, goalSheet: () => {}, calendarSheet: () => {}, workoutDetailSheet: () => {}, exerciseHistorySheet: () => {},
    WorkoutRow: ({ w }) => React.createElement('div', { 'data-recent': w.id }, w.name), bwDeltaColor: () => 'inherit',
  }
})
vi.mock('../components/LineChart.jsx', () => ({ default: () => null }))
vi.mock('../components/Heatmap.jsx', () => ({ default: ({ S, metric }) => { mocks.heat.push({ metric, ids: S.workouts.map(w => w.id) }); return null } }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null, BodyMapLegend: () => null }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const W = (id, daysAgo, extra = {}) => {
  const start = Date.now() - daysAgo * 86400000
  return { id, name: id, d: new Date(start).toISOString().slice(0, 10), start, end: start + 3600000,
    entries: [{ id: '0025', target: { id: '0025', sets: 1, reps: 5 }, sets: [{ w: 60, r: 5, done: true }] }], ...extra }
}
let root, host
afterEach(() => { act(() => root.unmount()); host.remove() })
function mount(metric) {
  mocks.heat.length = 0
  mocks.S = { body: 'male', effort: 'none', unit: 'kg', targetW: null, bodyweight: [], routines: [], exWeights: {}, heatmapMetric: metric,
    workouts: [W('counted', 3), W('rehab', 1, { excludeFromProgression: true })] }
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Stats />))
}

describe('a workout kept out of progression on Stats', () => {
  it('is in Recent workouts and in the heatmap by time', () => {
    mount('time')
    expect([...host.querySelectorAll('[data-recent]')].map(e => e.dataset.recent)).toEqual(['rehab', 'counted'])
    expect(mocks.heat.at(-1)).toEqual({ metric: 'time', ids: ['counted', 'rehab'] })
  })
  it('stays out of the heatmap by volume', () => {
    mount('vol')
    expect(mocks.heat.at(-1)).toEqual({ metric: 'vol', ids: ['counted'] })
  })
})
