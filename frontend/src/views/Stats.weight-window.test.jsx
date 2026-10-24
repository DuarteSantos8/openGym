// @vitest-environment happy-dom
// Issue #632: a weigh-in's `t` is its change stamp, not its day. sync-merge's stampChange
// re-stamps it on every write, and an import writes a whole history at once, so 236 weigh-ins
// from 2021-2022 all end up carrying the import moment. The body-weight chart and the Weight 30d
// tile read that stamp as the time of the weigh-in: every imported point lands on today and the
// 30-day window counts them all (a 2021-2022 import shows up as a +13.7 kg month). The readers
// must place a weigh-in by its own date `d`, which the import leaves intact — verified end to
// end: parseBodyweight writes historical `t` values and the store's stampChange (useStore.js)
// overwrites them at Date.now() on the save that follows mergeImport.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Stats from './Stats.jsx'
import { fmtNum } from '../lib/format.js'

const mocks = vi.hoisted(() => ({ charts: [], S: null }))
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: mocks.S }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: () => {}, goalSheet: () => {}, calendarSheet: () => {}, workoutDetailSheet: () => {},
  exerciseHistorySheet: () => {}, weighInsSheet: () => {}, WorkoutRow: () => null, bwDeltaColor: () => 'inherit',
}))
vi.mock('../components/LineChart.jsx', () => ({ default: props => { mocks.charts.push(props); return null } }))
vi.mock('../components/Heatmap.jsx', () => ({ default: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null, BodyMapLegend: () => null }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const noonOf = d => new Date(d + 'T12:00:00').getTime()
const ago = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
const stamp = Date.now()   // what stampChange leaves on every entry of a fresh import
// The tile renders the delta the way Stats does, so the expectation follows the formatter.
const deltaTile = d => (d > 0 ? '+' : '') + fmtNum(d) + ' kg'

// The import shape of issue #632: dates spread over 2021-2022, every `t` the import moment.
const imported = [
  { d: '2021-01-05', w: 90, t: stamp },
  { d: '2021-06-05', w: 89, t: stamp },
  { d: '2021-11-05', w: 88, t: stamp },
  { d: '2022-05-05', w: 87, t: stamp },
  { d: '2022-12-01', w: 76.3, t: stamp },
]
let root, host
afterEach(() => { act(() => root.unmount()); host.remove(); mocks.charts = [] })

function mount(bodyweight) {
  mocks.S = { body: 'male', effort: 'none', unit: 'kg', targetW: null, bodyweight, routines: [], exWeights: {}, workouts: [] }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Stats />))
}
const bwChart = () => mocks.charts.filter(c => c.h === 160).at(-1)   // the only chart drawn at 160
const bwCard = () => [...host.querySelectorAll('.card')].find(c => c.querySelector('h2')?.textContent === 'Body weight')
const tile = () => [...host.querySelectorAll('.tile')].find(c => c.textContent.includes('Weight 30d'))
const press = label => act(() => [...bwCard().querySelectorAll('.seg button')].find(b => b.textContent === label).click())

describe('Stats: body weight reads the weigh-in\'s own date', () => {
  it('places imported weigh-ins on their own days, not on the import moment', () => {
    mount(imported)
    // nothing is dated inside the 3M default, so the chart is empty until All is picked
    expect(bwChart().points).toEqual([])
    press('All')
    expect(bwChart().points.map(p => p.t)).toEqual(imported.map(b => noonOf(b.d)))
    expect(bwChart().points.map(p => p.y)).toEqual(imported.map(b => b.w))
    expect(bwChart().points.map(p => p.d)).toEqual(imported.map(b => b.d))
  })

  it('counts nothing in Weight 30d when no weigh-in is dated in the last 30 days', () => {
    mount(imported)
    expect(tile().querySelector('.v').textContent).toBe('–')
  })

  it('counts only the weigh-ins dated inside the window, however they were stamped', () => {
    mount([...imported, { d: ago(5), w: 76.7, t: stamp }, { d: ago(0), w: 76.5, t: stamp }])
    expect(tile().querySelector('.v').textContent).toBe(deltaTile(76.5 - 76.7))
    press('1M')
    expect(bwChart().points.map(p => p.d)).toEqual([ago(5), ago(0)])
  })

  it('a weigh-in corrected today stays outside the window, whatever its stamp says', () => {
    // stampChange re-stamps `t` at Date.now() on every later edit too, so correcting a typo in
    // a five-year-old entry leaves it carrying today's stamp; its own date keeps it out of the
    // 30-day window instead of pulling the old weight in as a fresh measurement.
    const corrected = { d: '2021-01-05', w: 90, t: Date.now() }   // edited a moment ago
    mount([corrected, { d: ago(3), w: 76.7, t: stamp }, { d: ago(0), w: 76.5, t: stamp }])
    expect(tile().querySelector('.v').textContent).toBe(deltaTile(76.5 - 76.7))
    press('1M')
    expect(bwChart().points.map(p => p.d)).toEqual([ago(3), ago(0)])
  })

  it('the ranges cut by date: a 2021-2022 import has no month and no year, and All still shows it all', () => {
    mount(imported)
    press('1M')
    expect(bwChart().points).toEqual([])
    press('1Y')
    expect(bwChart().points).toEqual([])
    press('All')
    expect(bwChart().points).toHaveLength(5)
  })
})
