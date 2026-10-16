// @vitest-environment happy-dom
// Progress › Strength: the exercise card opens the shared picker sheet (with search), the chosen
// exercise shows on the card and in the address, and duplicate / legacy records fold into one point.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Window } from 'happy-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXIDX } from '../lib/exercises.js'
import Strength from './Strength.jsx'
import Modals from '../components/Modals.jsx'
import { bindUI } from '../components/ui.jsx'
import { useUI } from '../store/useUI.js'

const BASE_NOW = Date.UTC(2026, 0, 22, 12)
const LEGACY_SNAPSHOT_ID = 'legacy-snapshot-only'

const mocks = vi.hoisted(() => ({
  charts: [], nav: vi.fn(), search: '',
  S: { unit: 'kg', body: 'male', effort: 'rir', targetW: null, bodyweight: [], routines: [], workouts: [] },
}))

vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: mocks.S }) }))
vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.nav,
  useLocation: () => ({ search: mocks.search, pathname: '/progress/strength' }),
}))
vi.mock('../lib/use-tab-nav.js', () => ({ back: vi.fn(), isSwitching: () => false, switchTab: vi.fn(), popToRoot: vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  menuSheet: vi.fn(), exerciseDetailSheet: vi.fn(), exerciseHistorySheet: vi.fn(), workoutDetailSheet: vi.fn(),
}))
vi.mock('../components/LineChart.jsx', () => ({ default: props => {
  mocks.charts.push(props)
  return React.createElement('div')
} }))
vi.mock('../components/Icon.jsx', () => ({ default: props => React.createElement('span', props) }))

bindUI(useUI)

let dom
let root
let container

const iso = timestamp => new Date(timestamp).toISOString().slice(0, 10)
const set = (done, extra = {}) => ({ done, w: 80, r: 8, unit: 'kg', ...extra })
const workout = (id, start, entries) => ({ id, d: iso(start), start, unit: 'kg', entries })
const entry = (id, sets) => ({ id, sets })

function exercisePickerWorkouts(now = BASE_NOW) {
  const DAY = 86400000
  return [
    workout('bench', now, [entry('0025', [set(true, { w: 80 })])]),
    workout('squat', now - DAY, [entry('0043', [set(true, { w: 60 })])]),
    workout('legacy', now - 2 * DAY, [
      {
        id: LEGACY_SNAPSHOT_ID,
        muscleSnapshot: {
          n: 'Legacy shoulder press',
          bp: 'shoulders',
          primaries: ['deltoids'],
          secondaries: ['triceps'],
          muscleGroups: ['deltoids', 'triceps'],
        },
        sets: [set(true, { w: 50 })],
      },
    ]),
  ]
}

function resetFixture(workouts) {
  mocks.S.unit = 'kg'
  mocks.S.workouts = workouts
  mocks.charts.length = 0
  mocks.nav.mockClear()
  mocks.search = ''
  useUI.setState({ sheets: [] })
}

function installDom() {
  dom = new Window({ url: 'http://localhost/' })
  dom.scrollTo = vi.fn()
  globalThis.window = dom
  globalThis.document = dom.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.navigator })
  Object.defineProperty(globalThis, 'location', { configurable: true, value: dom.location })
  Object.defineProperty(globalThis, 'history', { configurable: true, value: dom.history })
  for (const key of ['HTMLElement', 'HTMLIFrameElement', 'Node', 'Element', 'Event', 'MouseEvent']) {
    globalThis[key] = dom[key]
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
}

async function mountStrength() {
  installDom()
  await act(async () => { root.render(React.createElement(React.Fragment, null, React.createElement(Strength), React.createElement(Modals))) })
}

async function click(button) {
  expect(button, `expected a button named ${button?.textContent || 'unknown'}`).toBeTruthy()
  await act(async () => { button.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })) })
}

async function tick(milliseconds) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds) })
}

const hero = () => ({
  num: container.querySelector('.hero-num')?.textContent,
  unit: container.querySelector('.hero-u')?.textContent,
})
// The exercise card is one tappable row (MediaRow without a link or play button has no inner button).
const chosenName = () => container.querySelector('.item-exercise .tt').textContent
const chartWith = y => mocks.charts.find(chart => chart.points?.some(point => point.y === y))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(BASE_NOW)
})

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  root = null
  container = null
  dom?.close()
  dom = null
  useUI.setState({ sheets: [] })
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Strength exercise progress records', () => {
  it('keeps a legacy reps record whose load is stored only in topW', async () => {
    resetFixture([workout('legacy-topw', BASE_NOW, [
      { id: '0025', target: { mode: 'reps' }, topW: 70, sets: [] },
    ])])
    await mountStrength()

    expect(hero()).toEqual({ num: '70', unit: 'kg' })
    expect(chartWith(70)?.points).toHaveLength(1)
  })

  it('keeps the strongest topW across repeated legacy records', async () => {
    resetFixture([workout('legacy-topw-duplicates', BASE_NOW, [
      { id: '0025', target: { mode: 'reps' }, topW: 70, sets: [] },
      { id: '0025', target: { mode: 'reps' }, topW: 60, sets: [] },
    ])])
    await mountStrength()

    expect(hero()).toEqual({ num: '70', unit: 'kg' })
    expect(chartWith(70)?.points).toHaveLength(1)
  })

  it('keeps a legacy topW when a modern occurrence shares the workout', async () => {
    resetFixture([workout('modern-and-legacy', BASE_NOW, [
      entry('0025', [set(true, { w: 50, r: 5 })]),
      { id: '0025', target: { mode: 'reps' }, topW: 70, sets: [] },
    ])])
    await mountStrength()

    expect(hero()).toEqual({ num: '70', unit: 'kg' })
    expect(chartWith(70)?.points).toHaveLength(1)
  })

  it('aggregates duplicate exercise occurrences into one progress point', async () => {
    resetFixture([workout('duplicate', BASE_NOW, [
      entry('0025', [set(true, { w: 60, r: 5 })]),
      entry('0025', [set(true, { w: 80, r: 5 })]),
    ])])
    await mountStrength()

    expect(hero()).toEqual({ num: '80', unit: 'kg' })
    expect(chartWith(80)?.points).toHaveLength(1)
    expect(container.querySelector('.sect-b .lrow-s').textContent).toBe('60×5  80×5')
  })

  it('aggregates repeated assisted occurrences by the lightest load', async () => {
    resetFixture([workout('assisted-duplicate', BASE_NOW, [
      entry('0017', [set(true, { w: 30, r: 8 })]),
      entry('0017', [set(true, { w: 20, r: 8 })]),
    ])])
    await mountStrength()

    expect(hero()).toEqual({ num: '20', unit: 'kg' })
    expect(chartWith(20)?.points).toHaveLength(1)
  })
})

describe('Strength exercise picker', () => {
  it('filters with the shared exercise matcher and still selects from the mounted sheet', async () => {
    resetFixture(exercisePickerWorkouts())
    await mountStrength()
    expect(EXIDX[LEGACY_SNAPSHOT_ID]).toBeUndefined()

    await click(container.querySelector('.item-exercise'))

    const modal = document.querySelector('#modal-root')
    const input = modal.querySelector('input')
    expect(input).toBeTruthy()
    expect(input.getAttribute('aria-label')).toBe('Search…')
    expect(input.getAttribute('placeholder')).toBe('Search…')
    expect(modal.querySelector('.picker-search')).toBeTruthy()
    const optionButtons = () => [...modal.querySelectorAll('.sect-b button')]
    const initialOptionCount = optionButtons().length
    expect(initialOptionCount).toBe(3)
    expect(modal.textContent).toContain('Legacy shoulder press')
    expect(input.compareDocumentPosition(optionButtons()[0]) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set
    const setSearch = async value => act(async () => {
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // A focused search can leave a newly narrowed result below the visual viewport. The
    // correction must advance the sheet's own scroll position, not the page behind it.
    const sheet = modal.querySelector('.sheet')
    const firstOption = optionButtons()[0]
    Object.defineProperties(sheet, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1000 },
    })
    vi.spyOn(sheet, 'getBoundingClientRect').mockReturnValue({ bottom: 600 })
    vi.spyOn(firstOption, 'getBoundingClientRect').mockReturnValue({ bottom: 500 })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: { height: 300 } })
    input.focus()
    expect(sheet.style.getPropertyValue('--picker-visual-height')).toBe('300px')
    expect(sheet.style.getPropertyValue('--picker-keyboard-bottom')).toBe(`${Math.max(0, window.innerHeight - 300)}px`)
    await setSearch('bench')
    await tick(100)
    expect(sheet.scrollTop).toBeGreaterThan(0)

    await setSearch('no such historical exercise')
    expect(modal.textContent).toContain('No match')
    expect(optionButtons()).toHaveLength(0)

    await click(modal.querySelector('button[aria-label="Clear"]'))
    expect(input.value).toBe('')
    expect(optionButtons()).toHaveLength(initialOptionCount)
    expect(modal.textContent).toContain('Legacy shoulder press')

    await setSearch('legacy shoulder press shoulders deltoids triceps')
    expect(optionButtons()).toHaveLength(1)
    expect(optionButtons()[0].textContent).toContain('Legacy shoulder press')

    await click(modal.querySelector('button[aria-label="Clear"]'))
    await setSearch('squat full bárbell')

    // A catalogue name is title-cased like it is in every list (exerciseNameText); the legacy
    // snapshot above keeps the name as it was typed.
    expect(modal.textContent).toContain('Barbell Full Squat')
    expect(modal.textContent).not.toContain('Barbell Bench Press')

    const matching = [...modal.querySelectorAll('button')].find(button => button.textContent.includes('Barbell Full Squat'))
    await click(matching)

    expect(useUI.getState().sheets).toHaveLength(0)
    expect(chosenName()).toContain('Barbell Full Squat')
  })

  it('picking an exercise shows it, and puts it in the address without a history entry', async () => {
    resetFixture(exercisePickerWorkouts())
    mocks.search = '?range=30'
    await mountStrength()
    expect(chosenName()).toBe('Barbell Bench Press')
    expect(mocks.nav).not.toHaveBeenCalled()

    await click(container.querySelector('.item-exercise'))
    const modal = document.querySelector('#modal-root')
    await click([...modal.querySelectorAll('.sect-b button')].find(b => b.textContent.includes('Barbell Full Squat')))

    expect(mocks.nav).toHaveBeenCalledTimes(1)
    const [url, opts] = mocks.nav.mock.calls[0]
    expect(opts).toEqual({ replace: true })
    const [path, query] = url.split('?')
    expect(path).toBe('/progress/strength')
    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({ range: '30', ex: '0043' })
    expect(chosenName()).toBe('Barbell Full Squat')
    expect(hero().num).toBe('60')
  })
})
