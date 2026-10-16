// @vitest-environment happy-dom
// Progress › Body › Weight segment.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { isoOf } from '../lib/format.js'
import { bwSheet, goalSheet, weighInsSheet } from '../sheets.jsx'
import BodyWeight from './BodyWeight.jsx'

const mocks = vi.hoisted(() => ({ charts: [] }))
let search = ''
vi.mock('react-router-dom', () => ({ useLocation: () => ({ search }) }))
vi.mock('../sheets.jsx', () => ({ bwSheet: vi.fn(), goalSheet: vi.fn(), weighInsSheet: vi.fn() }))
vi.mock('./LineChart.jsx', () => ({ default: props => { mocks.charts.push(props); return null } }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const KEY = 'gains.progressRange'
const ago = n => isoOf(new Date(Date.now() - n * 86400000))
const weighIn = (n, w) => ({ d: ago(n), w, t: Date.now() - n * 86400000 })

let host, root
const setS = patch => useStore.setState(s => ({ S: { ...s.S, bodyweight: [], targetW: null, unit: 'kg', weighIn: true, ...patch } }))
const mount = () => act(() => root.render(<BodyWeight />))
const text = () => host.textContent
const action = label => [...host.querySelectorAll('.act-b')].find(b => b.textContent === label || b.getAttribute('aria-label') === label)
const rangeButtons = () => [...host.querySelectorAll('.seg button')]
const rangeOn = () => rangeButtons().filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent)
const hero = () => host.querySelector('.hero')

beforeEach(() => {
  mocks.charts = []
  search = ''
  localStorage.clear()
  for (const f of [bwSheet, goalSheet, weighInsSheet]) vi.mocked(f).mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Weight segment: actions', () => {
  it('has Log weight, Goal and All weigh-ins, each opening its sheet', () => {
    setS({ bodyweight: [weighIn(1, 80)] })
    mount()
    act(() => action('Log weight').click())
    expect(bwSheet).toHaveBeenCalledTimes(1)
    act(() => action('Goal').click())
    expect(goalSheet).toHaveBeenCalledTimes(1)
    act(() => action('All weigh-ins').click())
    expect(weighInsSheet).toHaveBeenCalledTimes(1)
  })

  it('labels Goal with the goal and its unit once one is set', () => {
    setS({ bodyweight: [weighIn(1, 80)], targetW: 72.5, unit: 'kg' })
    mount()
    const goal = action('72.5 kg')
    expect(goal).toBeDefined()
    expect(goal.getAttribute('aria-label')).toBe('Goal 72.5 kg')
  })

  it('disables All weigh-ins until there is a weigh-in', () => {
    setS()
    mount()
    expect(action('All weigh-ins').disabled).toBe(true)
    act(() => root.render(<div />))
    setS({ bodyweight: [weighIn(1, 80)] })
    mount()
    expect(action('All weigh-ins').disabled).toBe(false)
  })
})

describe('Weight segment: empty', () => {
  it('shows the scale, says so, and offers Log weight', () => {
    setS()
    mount()
    expect(text()).toContain('No weigh-ins yet')
    expect(text()).toContain('We also ask before every workout.')
    expect(host.querySelector('.empty-art svg')).not.toBeNull()
    expect(hero()).toBeNull()
    expect(mocks.charts).toHaveLength(0)
    const pill = [...host.querySelectorAll('.empty button')].find(b => b.textContent === 'Log weight')
    act(() => pill.click())
    expect(bwSheet).toHaveBeenCalledTimes(1)
  })

  it('drops the pre-workout line when weigh-ins before workouts are off', () => {
    setS({ weighIn: false })
    mount()
    expect(text()).toContain('Log your weight to start the curve.')
    expect(text()).not.toContain('We also ask before every workout.')
  })
})

describe('Weight segment: status', () => {
  it('shows the latest weigh-in with its unit', () => {
    setS({ bodyweight: [weighIn(9, 81), weighIn(2, 79.5)] })
    mount()
    expect(hero().textContent).toContain('79.5')
    expect(hero().querySelector('.hero-u').textContent).toBe('kg')
  })

  it('shows the change over the range in accent ink toward the goal and danger ink away from it', () => {
    setS({ bodyweight: [weighIn(20, 82), weighIn(1, 80)], targetW: 75 })
    mount()
    const change = () => hero().querySelector('.hero-c span')
    expect(change().textContent).toBe('−2 kg')
    expect(change().className).toBe('ink-acc')
    expect(hero().textContent).toContain('this period')
    act(() => root.render(<div />))
    setS({ bodyweight: [weighIn(20, 78), weighIn(1, 80)], targetW: 75 })
    mount()
    expect(change().textContent).toBe('+2 kg')
    expect(change().className).toBe('ink-danger')
  })

  it('leaves out the change for one weigh-in in the range or no movement', () => {
    setS({ bodyweight: [weighIn(200, 90), weighIn(1, 80)] })
    search = '?range=30'
    mount()
    expect(text()).not.toContain('this period')
    act(() => root.render(<div />))
    setS({ bodyweight: [weighIn(5, 80), weighIn(1, 80)] })
    mount()
    expect(text()).not.toContain('this period')
  })

  it('says how far the goal is: to gain, to lose, reached', () => {
    setS({ bodyweight: [weighIn(1, 80)], targetW: 85 })
    mount()
    expect(text()).toContain('Goal 85 kg · 5 kg to gain')
    act(() => root.render(<div />))
    setS({ bodyweight: [weighIn(1, 80)], targetW: 76.5 })
    mount()
    expect(text()).toContain('Goal 76.5 kg · 3.5 kg to lose')
    act(() => root.render(<div />))
    setS({ bodyweight: [weighIn(1, 80)], targetW: 80.04 })
    mount()
    expect(text()).toContain('reached!')
  })

  it('has no goal line without a goal', () => {
    setS({ bodyweight: [weighIn(1, 80)] })
    mount()
    expect(text()).not.toContain('to lose')
    expect(text()).not.toContain('to gain')
  })
})

describe('Weight segment: trend', () => {
  it('draws the trend card with the goal line and a subtle range control', () => {
    setS({ bodyweight: [weighIn(20, 82), weighIn(1, 80)], targetW: 75 })
    mount()
    expect(text()).toContain('Trend')
    expect(host.querySelector('.seg').classList.contains('seg-range')).toBe(true)
    expect(host.querySelector('.seg').classList.contains('seg-strong')).toBe(false)
    expect(mocks.charts.at(-1)).toMatchObject({ unit: 'kg', goal: 75 })
  })

  it('starts at 3M on a first visit, at the remembered range, or at the address\'s', () => {
    setS({ bodyweight: [weighIn(1, 80)] })
    mount()
    expect(rangeOn()).toEqual(['3M'])
    act(() => root.unmount())
    root = createRoot(host)
    localStorage.setItem(KEY, '365')
    mount()
    expect(rangeOn()).toEqual(['1Y'])
    act(() => root.unmount())
    root = createRoot(host)
    search = '?range=30'
    mount()
    expect(rangeOn()).toEqual(['1M'])
  })

  it('cuts the chart to the range picked, All being everything', () => {
    setS({ bodyweight: [weighIn(300, 90), weighIn(60, 85), weighIn(10, 82), weighIn(1, 80)] })
    search = '?range=30'
    mount()
    expect(mocks.charts.at(-1).points.map(p => p.y)).toEqual([82, 80])
    act(() => rangeButtons().find(b => b.textContent === '3M').click())
    expect(mocks.charts.at(-1).points.map(p => p.y)).toEqual([85, 82, 80])
    act(() => rangeButtons().find(b => b.textContent === '1Y').click())
    expect(mocks.charts.at(-1).points.map(p => p.y)).toEqual([90, 85, 82, 80])
    act(() => rangeButtons().find(b => b.textContent === 'All').click())
    expect(rangeOn()).toEqual(['All'])
    expect(mocks.charts.at(-1).points).toHaveLength(4)
  })

  it('keeps its own range: picking one here does not change what the Progress root remembers', () => {
    setS({ bodyweight: [weighIn(1, 80)] })
    mount()
    act(() => rangeButtons().find(b => b.textContent === '1M').click())
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
