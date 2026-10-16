// @vitest-environment happy-dom
// Progress › Strength: the exercise card, its best, the metric and range segments, the chart, the
// last five sessions, the way into Structural balance and the ⋯ menu. The picker sheet is covered
// in Strength.picker.test.jsx.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { _setLangState } from '../lib/i18n-core.js'
import Strength from './Strength.jsx'

const mocks = vi.hoisted(() => ({
  charts: [], S: null, search: '', nav: vi.fn(),
  menuSheet: vi.fn(), exerciseDetailSheet: vi.fn(), exerciseHistorySheet: vi.fn(), workoutDetailSheet: vi.fn(),
}))
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: mocks.S }) }))
vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.nav,
  useLocation: () => ({ search: mocks.search, pathname: '/progress/strength' }),
}))
vi.mock('../lib/use-tab-nav.js', () => ({ back: vi.fn(), isSwitching: () => false, switchTab: vi.fn(), popToRoot: vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  menuSheet: mocks.menuSheet, exerciseDetailSheet: mocks.exerciseDetailSheet,
  exerciseHistorySheet: mocks.exerciseHistorySheet, workoutDetailSheet: mocks.workoutDetailSheet,
}))
vi.mock('../components/LineChart.jsx', () => ({ default: props => { mocks.charts.push(props); return null } }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const BENCH = '0025'
const SQUAT = '0043'
const BIKE = '2138'
const DAY = 86400000
// A bench session `ago` days back, two working sets at weight w.
const session = (ago, w, extra = {}) => {
  const start = Date.now() - ago * DAY
  return {
    id: 'w' + ago, d: new Date(start).toISOString().slice(0, 10), start, end: start + 3600000, name: 'Push',
    entries: [{ id: BENCH, target: { id: BENCH, sets: 2, reps: 5 }, sets: [{ w, r: 5, done: true }, { w, r: 4, done: true, ...extra }] }],
  }
}
const cardio = (d, speeds) => ({
  id: d, d, start: Date.parse(d + 'T10:00:00Z'), end: Date.parse(d + 'T10:40:00Z'), name: 'Cardio',
  entries: [{ id: BIKE, target: { id: BIKE, sets: speeds.length, min: 20, speed: 8 }, sets: speeds.map(speed => ({ min: 20, speed, done: true })) }],
})
const SPREAD = () => [session(400, 100), session(200, 90), session(60, 70), session(10, 75), session(3, 80)]

let root, host
afterEach(() => {
  act(() => root.unmount()); host.remove()
  mocks.charts = []; mocks.search = ''
  for (const key of ['nav', 'menuSheet', 'exerciseDetailSheet', 'exerciseHistorySheet', 'workoutDetailSheet']) mocks[key].mockClear()
})

function mount(workouts, settings = {}) {
  mocks.S = { body: 'male', effort: 'none', unit: 'kg', targetW: null, bodyweight: [], routines: [], exWeights: {}, ...settings, workouts }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Strength />))
}
// The exercise chart is the last one drawn.
const exChart = () => mocks.charts.at(-1)
const press = label => act(() => [...host.querySelectorAll('.seg button')].find(b => b.textContent === label).click())
const on = () => [...host.querySelectorAll('.seg button.on')].map(b => b.textContent)
const hero = () => ({
  eyebrow: host.querySelector('.hero-e')?.textContent,
  num: host.querySelector('.hero-num')?.textContent,
  unit: host.querySelector('.hero-u')?.textContent,
  caption: host.querySelector('.hero-c')?.textContent,
})
const lessons = () => [...host.querySelectorAll('.sect-b .lrow')]

describe('Strength: date range', () => {
  it('starts on All and cuts the top-set line to the picked range, the best staying all-time', () => {
    mount(SPREAD())
    expect(on()).toEqual(['Top', 'All'])
    expect(exChart().points.map(p => p.y)).toEqual([100, 90, 70, 75, 80])

    press('1M')
    expect(exChart().points.map(p => p.y)).toEqual([75, 80])
    press('3M')
    expect(exChart().points.map(p => p.y)).toEqual([70, 75, 80])
    expect(hero()).toMatchObject({ eyebrow: 'Best set', num: '100', unit: 'kg', caption: 'All time' })
  })

  it('starts on the ?range= of the address', () => {
    mocks.search = '?range=30'
    mount(SPREAD())
    expect(on()).toEqual(['Top', '1M'])
    expect(exChart().points.map(p => p.y)).toEqual([75, 80])
  })

  it('applies to the other chart modes too', () => {
    mount(SPREAD())
    press('1RM')
    const all = exChart().points.length
    press('1M')
    expect(all).toBe(5)
    expect(exChart().points).toHaveLength(2)
    press('Per set')
    const chart = exChart()
    expect(chart.points).toHaveLength(2)
    expect(chart.series.every(s => s.points.length === 2)).toBe(true)
  })

  it('shows a hint instead of the chart when the range holds fewer than two workouts', () => {
    mount([session(400, 100), session(200, 90), session(5, 80)])
    press('1M')
    expect(host.textContent).toContain('Fewer than two workouts in this period. Pick a longer one.')
    mocks.charts = []
    press('1Y')
    expect(host.textContent).not.toContain('Fewer than two workouts')
    expect(exChart().points.map(p => p.y)).toEqual([90, 80])
  })
})

describe('Strength: the address', () => {
  it('writes a picked range to the address with replace, keeping ex', () => {
    mocks.search = '?ex=' + BENCH
    mount(SPREAD())
    press('1M')
    expect(mocks.nav).toHaveBeenLastCalledWith('/progress/strength?ex=' + BENCH + '&range=30', { replace: true })
    press('All')
    expect(mocks.nav).toHaveBeenLastCalledWith('/progress/strength?ex=' + BENCH + '&range=0', { replace: true })
  })
})

describe('Strength: chart name and short segment labels', () => {
  afterEach(() => _setLangState('en', {}, null, null))

  it('names the chart with what it plots', () => {
    mount(SPREAD())
    expect(exChart().label).toBe('Best set weight per workout')
    press('1RM')
    expect(exChart().label).toBe('Estimated 1RM per workout')
  })

  it.each([['de', 'Einsatz', 'Je Satz'], ['ru', 'Усилие', 'Подход'], ['pl', 'Wysiłek', 'Seria']])(
    'in %s the segments read short and keep the full words as their names', async (lang, effort, perSet) => {
      const pack = (await import(`../locales/${lang}.js`)).default
      _setLangState(lang, pack, null, null)
      const rated = ago => session(ago, 80, { max: true, r: 12, rir: 1 })
      mount([rated(20), rated(10), rated(3)])
      const buttons = [...host.querySelectorAll('.seg')[0].querySelectorAll('button')]
      const byValue = label => buttons.find(b => b.textContent === label)
      expect(byValue(effort).getAttribute('aria-label')).toBe(pack['Effort'])
      expect(byValue(perSet).getAttribute('aria-label')).toBe(pack['Per set'])
    })
})

describe('Strength: metric segment and hero', () => {
  it('labels the metrics Top, Per set, 1RM and, with Max sets and effort logged, Max and Effort', () => {
    mount(SPREAD())
    const labels = () => [...host.querySelectorAll('.seg')][0].textContent
    expect(labels()).toBe('TopPer set1RM')
    act(() => root.unmount()); host.remove()
    const rated = ago => session(ago, 80, { max: true, r: 12, rir: 1 })
    mount([rated(20), rated(10), rated(3)])
    expect(labels()).toBe('TopPer set1RMEffortMax')
  })

  it('reads the top set in the hero on Top, the estimated 1RM on 1RM and the most reps on Max', () => {
    const rated = (ago, w) => session(ago, w, { max: true, r: 12, rir: 1 })
    mount([rated(20, 80), rated(10, 85), rated(3, 90)])
    expect(hero()).toMatchObject({ eyebrow: 'Best set', num: '90', unit: 'kg', caption: 'All time' })

    press('1RM')
    const e1 = hero()
    expect(e1.eyebrow).toBe('Best estimated 1RM')
    expect(e1.unit).toBe('kg')
    expect(Number(e1.num)).toBeGreaterThan(90)
    expect(e1.caption).toContain('An estimate, not a tested max.')

    press('Max')
    expect(hero()).toMatchObject({ eyebrow: 'Most reps in a Max set', num: '12', unit: 'reps', caption: 'All time' })
    expect(host.textContent).toContain('Most reps in a Max set per workout')
    expect(host.textContent).not.toContain('Best:')
  })
})

describe('Strength: cardio speed', () => {
  const rides = [cardio('2026-09-01', [8, 9.66]), cardio('2026-09-08', [16.09])]

  it('charts and names the best speed in mph for a pound profile', () => {
    mount(rides, { unit: 'lb' })
    expect(exChart().unit).toBe('mph')
    expect(exChart().points.map(p => p.y)).toEqual([6, 10])
    expect(hero()).toMatchObject({ eyebrow: 'Top speed', num: '10', unit: 'mph' })
    expect(host.textContent).toContain('20 min @ 10 mph')
  })

  it('keeps km/h for a kg profile', () => {
    mount(rides, { unit: 'kg' })
    expect(exChart().unit).toBe('km/h')
    expect(exChart().points.map(p => p.y)).toEqual([9.66, 16.09])
    expect(hero()).toMatchObject({ num: '16.1', unit: 'km/h' })
    expect(host.textContent).toContain('16.1 km/h')
  })
})

describe('Strength: ?ex= deep link', () => {
  const both = () => [session(5, 80), { ...session(2, 120), entries: [{ id: SQUAT, sets: [{ w: 120, r: 5, done: true }] }] }]

  it('opens on the exercise in the address', () => {
    mocks.search = '?ex=' + BENCH
    mount(both())
    expect(host.querySelector('.item-exercise .tt').textContent).toBe('Barbell Bench Press')
    expect(hero().num).toBe('80')
  })

  it('falls back to the heaviest exercise for an id with no sessions', () => {
    mocks.search = '?ex=not-a-lift'
    mount(both())
    expect(host.querySelector('.item-exercise .tt').textContent).toBe('Barbell Full Squat')
    expect(hero().num).toBe('120')
  })
})

describe('Strength: session history and structural balance', () => {
  it('lists the last five sessions, newest first, each with its sets, and opens the workout', () => {
    const workouts = [session(400, 100), session(300, 95), ...SPREAD()]
    mount(workouts)
    const history = [...host.querySelectorAll('.sect')].find(s => s.querySelector('.lrow-s')?.textContent.includes('×'))
    const rows = [...history.querySelectorAll('.lrow')]
    expect(rows).toHaveLength(5)
    expect(rows[0].querySelector('.lrow-s').textContent).toBe('80×5  80×4')
    expect(rows[0].querySelector('.lrow-t').textContent).not.toBe(rows[1].querySelector('.lrow-t').textContent)

    act(() => rows[1].click())
    expect(mocks.workoutDetailSheet).toHaveBeenCalledWith(workouts.find(w => w.id === 'w10'))
  })

  it('opens Structural balance from its row', () => {
    mount(SPREAD())
    const row = lessons().find(r => r.textContent.includes('Structural balance'))
    act(() => row.click())
    expect(mocks.nav).toHaveBeenCalledWith('/progress/strength/balance')
  })
})

describe('Strength: more menu', () => {
  it('offers the exercise details and its history', () => {
    mount(SPREAD())
    act(() => host.querySelector('button[aria-label="More"]').click())
    expect(mocks.menuSheet).toHaveBeenCalledTimes(1)
    const { title, items } = mocks.menuSheet.mock.calls[0][0]
    expect(title).toBe('Barbell Bench Press')
    expect(items.filter(Boolean).map(i => i.label)).toEqual(['Exercise details', 'Exercise history'])

    items[0].onClick()
    expect(mocks.exerciseDetailSheet).toHaveBeenCalledWith(expect.objectContaining({ id: BENCH }))
    items[1].onClick()
    expect(mocks.exerciseHistorySheet).toHaveBeenCalledWith(BENCH)
  })
})

describe('Strength: no history', () => {
  it('says there are no lifts yet and offers nothing else', () => {
    mount([])
    expect(host.textContent).toContain('No lifts yet')
    expect(host.querySelector('.seg')).toBeNull()
    expect(host.querySelector('button[aria-label="More"]')).toBeNull()
    expect(host.textContent).not.toContain('Structural balance')
  })
})
