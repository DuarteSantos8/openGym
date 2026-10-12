// @vitest-environment happy-dom
// Issue #511: the Exercise progress card gets the Body weight card's 1M / 3M / 1Y / All range.
// It cuts every chart mode to the range, starts on All, keeps "Best:" all-time, and says so when
// the range holds fewer than two workouts instead of drawing a lone dot.
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
const BENCH = '0025'
const DAY = 86400000
// A bench session `ago` days back, two working sets at weight w.
const session = (ago, w) => {
  const start = Date.now() - ago * DAY
  return {
    id: 'w' + ago, d: new Date(start).toISOString().slice(0, 10), start, end: start + 3600000, name: 'Push',
    entries: [{ id: BENCH, target: { id: BENCH, sets: 2, reps: 5 }, sets: [{ w, r: 5, done: true }, { w, r: 4, done: true }] }],
  }
}
let root, host
afterEach(() => { act(() => root.unmount()); host.remove(); mocks.charts = [] })

function mount(workouts) {
  mocks.S = { body: 'male', effort: 'none', unit: 'kg', targetW: null, bodyweight: [], routines: [], exWeights: {}, workouts }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Stats />))
}
// The exercise card's chart is the last one drawn; the body weight chart has no colour of its own.
const exChart = () => mocks.charts.filter(c => c.color === 'var(--blue)' || c.series).at(-1)
const exCard = () => [...host.querySelectorAll('.card')].find(c => c.querySelector('h2')?.textContent === 'Exercise progress')
const press = (scope, label) => act(() => [...scope.querySelectorAll('.seg button')].find(b => b.textContent === label).click())

describe('Stats: exercise progress date range', () => {
  it('starts on All and cuts the top-set line to the picked range, Best staying all-time', () => {
    mount([session(400, 100), session(200, 90), session(60, 70), session(10, 75), session(3, 80)])
    const card = exCard()
    expect([...card.querySelectorAll('.seg button.on')].map(b => b.textContent)).toEqual(['Top set', 'All'])
    expect(exChart().points.map(p => p.y)).toEqual([100, 90, 70, 75, 80])

    press(card, '1M')
    expect(exChart().points.map(p => p.y)).toEqual([75, 80])
    press(card, '3M')
    expect(exChart().points.map(p => p.y)).toEqual([70, 75, 80])
    expect(card.textContent).toContain('Best: 100 kg')
  })

  it('applies to the other chart modes too', () => {
    mount([session(400, 100), session(200, 90), session(60, 70), session(10, 75), session(3, 80)])
    const card = exCard()
    press(card, 'Est. 1RM')
    const all = exChart().points.length
    press(card, '1M')
    expect(all).toBe(5)
    expect(exChart().points).toHaveLength(2)
    press(card, 'Per set')
    const chart = exChart()
    expect(chart.points).toHaveLength(2)
    expect(chart.series.every(s => s.points.length === 2)).toBe(true)
  })

  it('shows a hint instead of the chart when the range holds fewer than two workouts', () => {
    mount([session(400, 100), session(200, 90), session(5, 80)])
    const card = exCard()
    press(card, '1M')
    expect(card.textContent).toContain('Fewer than two workouts in this period. Pick a longer one.')
    mocks.charts = []
    press(card, '1Y')
    expect(card.textContent).not.toContain('Fewer than two workouts')
    expect(exChart().points.map(p => p.y)).toEqual([90, 80])
  })

  it('leaves the body weight range alone', () => {
    mount([session(400, 100), session(200, 90), session(5, 80)])
    const bwCard = [...host.querySelectorAll('.card')].find(c => c.querySelector('h2')?.textContent === 'Body weight')
    press(exCard(), '1M')
    expect([...bwCard.querySelectorAll('.seg button.on')].map(b => b.textContent)).toEqual(['3M'])
  })
})
