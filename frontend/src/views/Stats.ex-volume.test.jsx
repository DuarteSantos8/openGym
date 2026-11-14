// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Stats from './Stats.jsx'
import { pickFrom, pickerOptions } from './stats-pick.test-util.js'

const mocks = vi.hoisted(() => ({ charts: [], S: null }))
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: mocks.S }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: () => {}, goalSheet: () => {}, calendarSheet: () => {}, workoutDetailSheet: () => {}, exerciseHistorySheet: () => {},
  WorkoutRow: () => null, bwDeltaColor: () => 'inherit', weighInsSheet: () => {},
}))
vi.mock('../components/LineChart.jsx', () => ({ default: props => { mocks.charts.push(props); return null } }))
vi.mock('../components/Heatmap.jsx', () => ({ default: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null, BodyMapLegend: () => null }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const BENCH = '0025'
const now = new Date(2026, 10, 14, 16).getTime()
const done = (w = 50, r = 5) => ({ w, r, done: true })
const entry = (sets = [done()], extra = {}) => ({ id: BENCH, sets, ...extra })
const session = (d = '2026-11-14', entries = [entry()], extra = {}) => ({ id: d, d, entries, ...extra })
let root, host
afterEach(() => { if (root) act(() => root.unmount()); host?.remove(); mocks.charts = []; vi.restoreAllMocks() })
function mount(workouts, extra = {}) {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  mocks.S = { body: 'male', effort: 'none', unit: 'kg', targetW: null, bodyweight: [], routines: [], exWeights: {}, workouts, ...extra }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root.render(<Stats />))
}
const card = () => host.querySelector('[data-tour="stats-records"]')
const chart = () => mocks.charts.filter(c => c.h === 150).at(-1)
const volume = () => pickFrom(card(), 'Chart', 'Volume')
const range = label => act(() => [...card().querySelectorAll('.seg button')].find(b => b.textContent === label).click())
const rows = () => [...card().querySelectorAll('tbody tr')].map(r => [...r.querySelectorAll('th,td')].map(c => c.textContent))

describe('Stats exercise volume', () => {
  it('offers Volume for positive reps history but preserves Top set as the default', () => {
    mount([session('2026-11-10', undefined, { start: new Date(2026, 10, 10, 12).getTime() }), session(undefined, undefined, { start: now })])
    expect(pickerOptions(card(), 'Chart')).toContain('Volume')
    expect(chart().points.map(p => p.y)).toEqual([50, 50])
    expect(card().querySelector('table')).toBeNull()
  })

  it.each([
    ['assisted', entry(undefined, { id: '0017' })],
    ['timed', entry([{ sec: 60, w: 50, done: true }], { target: { mode: 'time' } })],
    ['cardio', entry([{ min: 10, speed: 5, done: true }], { target: { mode: 'cardio' } })],
    ['unloaded', entry([done(0)], { id: '0652' })],
    ['unfinished', entry([{ ...done(), done: false }])],
  ])('hides Volume for %s exercise history', (_, e) => {
    mount([session(undefined, [e])])
    expect(pickerOptions(card(), 'Chart')).not.toContain('Volume')
  })

  it('plots a d-only session and duplicate entries, with a semantic table matching every point', () => {
    mount([session('2026-11-10'), session(undefined, [entry([{ ...done(), type: 'dropset', drops: [{ w: 40, r: 3 }] }]), entry([done(30, 4)])])])
    volume()
    expect(chart().unit).toBe('kg')
    expect(chart().points.map(p => p.y)).toEqual([250, 490])
    expect(card().querySelector('table caption').textContent).toBe('Volume per session (kg)')
    expect([...card().querySelectorAll('thead th')].map(x => [x.textContent, x.scope])).toEqual([
      ['Date', 'col'], ['Sets', 'col'], ['Volume (kg)', 'col'],
    ])
    expect(rows().map(r => r.slice(1))).toEqual([['1', '250'], ['2', '490']])
    expect(card().querySelectorAll('tbody th[scope="row"]')).toHaveLength(2)
    expect(card().textContent).toContain('Included 2 sessions; excluded 0:')
    expect(card().querySelector('[data-ex-days]')).toBeNull()
  })

  it('uses the exercise pin in both chart and table instead of the profile unit', () => {
    mount([session(undefined, [entry([done(20.4117)])])], { exUnit: { [BENCH]: { unit: 'lb' } } })
    volume()
    expect(chart().unit).toBe('lb')
    expect(chart().points[0].y).toBeCloseTo(225, 2)
    expect(card().querySelector('table caption').textContent).toBe('Volume per session (lb)')
    expect(rows()[0].slice(1)).toEqual(['1', '225'])
  })

  it('keeps a single session visible in a limited range and shows a true empty state when none remain', () => {
    mount([session('2026-11-01')])
    volume(); range('1M')
    expect(chart().points).toHaveLength(1)
    expect(rows()).toHaveLength(1)
    expect(card().textContent).not.toContain('Fewer than two workouts')
    mocks.charts = []
    range('1W')
    expect(chart()).toBeUndefined()
    expect(card().textContent).toContain('No exercise volume in this period.')
    expect(rows()).toHaveLength(0)
    expect(card().textContent).toContain('Included 0 sessions; excluded 0:')
  })

  it('counts only exclusions inside the selected window and tolerates legacy missing entries', () => {
    mount([
      { id: 'old', d: '2020-01-01', vol: 9999 },
      { id: 'legacy', d: '2026-11-12', vol: 9999 },
      session('2026-11-12', [entry([done()], { target: { mode: 'time' } })]),
      session('2026-11-13', [entry([{ ...done(), done: false }])]), session(),
    ])
    volume(); range('1W')
    expect(chart().points.map(p => p.y)).toEqual([250])
    expect(rows()).toHaveLength(1)
    expect(card().textContent).toContain('Included 1 sessions; excluded 3: 1 timed/cardio, 1 without completed reps or positive volume, and 1 without exercise set details.')
  })

  it('keeps same-day sessions separate in the table and restores the original top-set output', () => {
    mount([
      session(undefined, [entry()], { id: 'am', start: new Date(2026, 10, 14, 8).getTime() }),
      session(undefined, [entry([done(60)])], { id: 'pm', start: new Date(2026, 10, 14, 18).getTime() }),
    ])
    const before = chart().points
    volume()
    expect(rows()).toHaveLength(2)
    expect(chart().points.map(p => p.y)).toEqual([250, 300])
    pickFrom(card(), 'Chart', 'Top set')
    expect(chart().points).toEqual(before)
    expect(card().querySelector('table')).toBeNull()
  })
})
