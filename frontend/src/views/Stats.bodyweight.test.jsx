// @vitest-environment happy-dom
// The Bodyweight view of Exercise progress: a lift measured against body weight at the time.
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
// A bench session `ago` days back: two sets at weight w, logged at body weight bw (when given).
const session = (ago, w, bw) => {
  const start = Date.now() - ago * DAY
  return {
    id: 'w' + ago, d: new Date(start).toISOString().slice(0, 10), start, end: start + 3600000, name: 'Push',
    ...(bw ? { bw } : {}),
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
const exCard = () => [...host.querySelectorAll('.card')].find(c => c.querySelector('h2')?.textContent === 'Exercise progress')
const press = (scope, label) => act(() => [...scope.querySelectorAll('.seg button')].find(b => b.textContent === label).click())
const labels = scope => [...scope.querySelectorAll('.seg button')].map(b => b.textContent)
const lastChart = () => mocks.charts.at(-1)

describe('Stats: Bodyweight view of exercise progress', () => {
  it('is not offered without a body weight to compare with, or with a single workout', () => {
    mount([session(20, 80), session(10, 85)])
    expect(labels(exCard())).not.toContain('Bodyweight')
    act(() => root.unmount()); host.remove()
    mount([session(10, 80, 80)])
    expect(labels(exCard())).not.toContain('Bodyweight')
  })

  it('draws the lift as a percentage of the body weight it was logged at', () => {
    mount([session(20, 80, 80), session(10, 100, 80)])
    const card = exCard()
    expect(labels(card)).toContain('Bodyweight')
    press(card, 'Bodyweight')
    const chart = lastChart()
    expect(chart.unit).toBe('% BW')
    const ys = chart.points.map(p => p.y)
    expect(ys).toHaveLength(2)
    expect(ys[1]).toBeGreaterThan(ys[0])
    // Gaining the same weight as the lift leaves the ratio where it was.
    expect(card.textContent).toContain('Body weight over this period: 80 kg → 80 kg.')
  })

  it('offers the basis toggle, and the top set reads the heaviest set over body weight', () => {
    mount([session(20, 80, 80), session(10, 100, 80)])
    const card = exCard()
    press(card, 'Bodyweight')
    const toggle = [...card.querySelectorAll('.seg')].find(s => labels(s).join() === 'Est. 1RM,Top set')
    expect(toggle).toBeTruthy()
    act(() => [...toggle.querySelectorAll('button')].find(b => b.textContent === 'Top set').click())
    expect(lastChart().points.map(p => p.y)).toEqual([100, 125])
    expect(card.textContent).toContain('Heaviest set as a share of body weight, per workout')
  })

  it('names the estimated 1RM, not a weight lifted, in the point note', () => {
    mount([session(20, 80, 80), session(10, 100, 80)])
    press(exCard(), 'Bodyweight')
    expect(lastChart().points.every(p => p.note.startsWith('Est. 1RM '))).toBe(true)
  })

  it('offers no Est. 1RM basis for an exercise assisted by its routine setting, and says heaviest set', () => {
    const assisted = (ago, help) => {
      const s = session(ago, help, 80)
      s.entries[0].target = { ...s.entries[0].target, assisted: true }
      return s
    }
    mount([assisted(20, 30), assisted(10, 10)])
    const card = exCard()
    press(card, 'Bodyweight')
    expect([...card.querySelectorAll('.seg')].some(s => labels(s).join() === 'Est. 1RM,Top set')).toBe(false)
    expect(card.textContent).toContain('Heaviest set as a share of body weight, per workout')
    expect(lastChart().points.map(p => p.y)).toEqual([62.5, 87.5])
  })

  it('still offers Bodyweight for sets above the 1RM estimate cap, on the heaviest set', () => {
    const high = (ago, w) => {
      const s = session(ago, w, 80)
      s.entries[0].sets = [{ w, r: 20, done: true }]
      return s
    }
    mount([high(20, 100), high(10, 120)])
    const card = exCard()
    expect(labels(card)).toContain('Bodyweight')
    press(card, 'Bodyweight')
    expect(lastChart().points.map(p => p.y)).toEqual([125, 150])
    expect(card.textContent).toContain('Heaviest set as a share of body weight, per workout')
  })

  it('follows the date range and says so when it holds fewer than two workouts', () => {
    mount([session(200, 70, 80), session(20, 80, 80), session(5, 90, 80)])
    const card = exCard()
    press(card, 'Bodyweight')
    expect(lastChart().points).toHaveLength(3)
    press(card, '1M')
    expect(lastChart().points).toHaveLength(2)
  })
})
