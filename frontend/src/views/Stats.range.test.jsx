// @vitest-environment happy-dom
// Stats → Exercise progress has the Body weight card's ranges (1M / 3M / 1Y / All, #511): an
// imported history years long squeezed the last month into the chart's right edge. The range
// narrows what every view of the chart draws; "Best:" and the sessions listed stay as they were.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Stats from './Stats.jsx'

const mocks = vi.hoisted(() => ({ charts: [], S: null }))
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: mocks.S }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: () => {}, goalSheet: () => {}, calendarSheet: () => {}, dayOverrideSheet: () => {}, workoutDetailSheet: () => {},
  exerciseHistorySheet: () => {}, weighInsSheet: () => {}, WorkoutRow: () => null, bwDeltaColor: () => 'inherit',
}))
vi.mock('../components/LineChart.jsx', () => ({ default: props => { mocks.charts.push(props); return null } }))
vi.mock('../components/Heatmap.jsx', () => ({ default: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null, BodyMapLegend: () => null }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const BENCH = '0025'
const DAY = 86400000
// A session `ago` days back: two sets of five at `w`, so the per-set view has its two lines.
const session = (ago, w) => {
  const start = Date.now() - ago * DAY
  return { id: 'w' + ago, d: new Date(start).toISOString().slice(0, 10), start, unit: 'kg',
    entries: [{ id: BENCH, sets: [{ done: true, w, r: 5, unit: 'kg' }, { done: true, w, r: 5, unit: 'kg' }] }] }
}
let root, host
afterEach(() => { act(() => root.unmount()); host.remove(); mocks.charts = [] })

function mount(workouts) {
  mocks.S = { unit: 'kg', body: 'male', effort: 'none', targetW: null, bodyweight: [], routines: [], exWeights: {}, workouts }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Stats />))
}
const card = () => [...host.querySelectorAll('.card')].find(el => el.querySelector('h2')?.textContent.trim() === 'Exercise progress')
// The card's own chart among those drawn: blue for one line, `series` for the per-set view. The
// Body weight chart above it is drawn on every render too, in the accent colour.
const exChart = () => mocks.charts.filter(c => c.color === 'var(--blue)' || c.series).at(-1)
// Pressing a segment of the card (a range or a view), then the chart that press drew, if any.
const press = label => {
  mocks.charts = []
  const button = [...card().querySelectorAll('.seg button')].find(b => b.textContent.trim() === label)
  act(() => button.click())
  return exChart()
}
const ys = chart => chart.points.map(p => p.y)

// The heaviest session is the oldest, so an all-time best is told apart from the best in range.
const history = () => [session(400, 100), session(60, 70), session(5, 80)]

describe('Stats — exercise progress range', () => {
  it('draws all of it by default, as before', () => {
    mount(history())
    expect([...card().querySelectorAll('.seg button')].find(b => b.textContent.trim() === 'All').getAttribute('aria-pressed')).toBe('true')
    expect(ys(exChart())).toEqual([100, 70, 80])
  })

  it('1Y, 3M and 1M each keep only the workouts that recent', () => {
    mount(history())
    expect(ys(press('1Y'))).toEqual([70, 80])
    expect(ys(press('3M'))).toEqual([70, 80])
    expect(ys(press('1M'))).toEqual([80])
    expect(ys(press('All'))).toEqual([100, 70, 80])
  })

  it('"Best:" stays the all-time best, and the sessions listed stay the latest ones', () => {
    mount(history())
    press('1M')
    expect(card().textContent).toContain('Best: 100 kg')
    expect(card().textContent).toContain('100×5')
  })

  it('the estimated 1RM and the per-set views follow the range too', () => {
    mount(history())
    press('1M')
    expect(press('Est. 1RM').points).toHaveLength(1)
    const perSet = press('Per set')
    expect(perSet.points).toHaveLength(1)
    expect(perSet.series).toHaveLength(2)
    expect(perSet.series.map(s => s.points.length)).toEqual([1, 1])
    const all = press('All')
    expect(all.points).toHaveLength(3)
    expect(all.series.map(s => s.points.length)).toEqual([3, 3])
  })

  it('a range with no workout in it says so instead of drawing an empty chart', () => {
    mount([session(400, 100), session(60, 70)])
    expect(press('1M')).toBeUndefined()
    expect(card().textContent).toContain('No workouts in this period yet.')
    expect(ys(press('3M'))).toEqual([70])
  })
})
