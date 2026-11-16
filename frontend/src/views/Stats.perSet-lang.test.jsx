// @vitest-environment happy-dom
// The per-set chart names each line ("Set 1", "Set 2") so a screen reader can tell the lines apart.
// Those names are translated, so they have to follow a language change made with this page open:
// the legend under the chart re-renders in the new language on its own, and a name left behind in
// the old one reads as a different chart.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Stats from './Stats.jsx'
import { pickFrom } from './stats-pick.test-util.js'
import { _setLangState } from '../lib/i18n-core.js'

const packs = import.meta.glob('../locales/*.js', { eager: true, import: 'default' })
const pack = code => packs[`../locales/${code}.js`]

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
const session = (ago, w) => {
  const start = Date.now() - ago * DAY
  return {
    id: 'w' + ago, d: new Date(start).toISOString().slice(0, 10), start, end: start + 3600000, name: 'Push',
    entries: [{ id: BENCH, target: { id: BENCH, sets: 2, reps: 5 }, sets: [{ w, r: 5, done: true }, { w, r: 4, done: true }] }],
  }
}

let root, host
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  mocks.charts = []
  _setLangState('en', null, null, null)
})

function mount(workouts) {
  mocks.S = { body: 'male', effort: 'none', unit: 'kg', targetW: null, bodyweight: [], routines: [], exWeights: {}, workouts }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Stats />))
}

const exChart = () => mocks.charts.filter(c => c.h === 150).at(-1)
const exCard = () => [...host.querySelectorAll('.card')].find(c => c.querySelector('h2')?.textContent === 'Exercise progress')

describe('the per-set chart names its lines in the current language', () => {
  it('names them, and renames them when the language changes under it', () => {
    mount([session(20, 100), session(6, 110)])
    pickFrom(exCard(), 'Chart', 'Per set')
    expect(exChart().series.map(s => s.label)).toEqual(['Set 1', 'Set 2'])

    // The language packs load lazily in the app; here the German pack is handed over directly,
    // which is the state a change made in Settings leaves the app in.
    _setLangState('de', pack('de'), null, null)
    act(() => root.render(<Stats />))

    expect(exChart().series.map(s => s.label)).toEqual(['Satz 1', 'Satz 2'])
  })
})
