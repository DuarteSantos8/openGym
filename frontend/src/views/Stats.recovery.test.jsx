// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Window } from 'happy-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXIDX } from '../lib/exercises.js'
import { MUSCLES, levelsOf } from '../lib/muscles.js'
import { FATIGUE_STATES, STRENGTH_FLOOR } from '../lib/recovery.js'
import { fatigueStateOf } from '../lib/recovery-view.js'
import Stats from './Stats.jsx'
import Modals from '../components/Modals.jsx'
import { bindUI } from '../components/ui.jsx'
import { useUI } from '../store/useUI.js'

const DAY = 86400000
const HOUR = 3600000
const BASE_NOW = Date.UTC(2026, 0, 22, 12)
const LEGACY_SNAPSHOT_ID = 'legacy-snapshot-only'

const mocks = vi.hoisted(() => ({
  maps: [],
  mapMounts: 0,
  S: {
    unit: 'kg', body: 'male', effort: 'rir', targetW: null,
    bodyweight: [], routines: [], workouts: [],
  },
}))

vi.mock('../store/useStore.js', () => ({
  useStore: selector => selector({ S: mocks.S }),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: () => {}, goalSheet: () => {}, calendarSheet: () => {}, workoutDetailSheet: () => {},
  WorkoutRow: () => React.createElement('div'), bwDeltaColor: () => 'inherit',
}))
vi.mock('../components/LineChart.jsx', () => ({ default: () => React.createElement('div') }))
vi.mock('../components/Heatmap.jsx', () => ({ default: () => React.createElement('div') }))
vi.mock('../components/Icon.jsx', () => ({ default: props => React.createElement('span', props) }))
vi.mock('../components/BodyMap.jsx', () => ({
  default: props => {
    mocks.maps.push(props)
    React.useEffect(() => {
      mocks.mapMounts += 1
      return () => {}
    }, [])
    return React.createElement(
      'div',
      { 'data-body-map': true, 'data-selected-muscle': props.selected || '' },
      React.createElement('button', {
        'data-muscle': 'chest',
        onClick: () => props.onMuscle?.('chest'),
      }, 'Chest'),
    )
  },
  BodyMapLegend: () => React.createElement('div', { 'data-balance-legend': true }),
}))

bindUI(useUI)

let dom
let root
let container

function iso(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function set(done, extra = {}) {
  return { done, w: 80, r: 8, unit: 'kg', ...extra }
}

function workout(id, start, entries) {
  return { id, d: iso(start), start, unit: 'kg', entries }
}

function entry(id, sets) {
  return { id, sets }
}

function lifecycleWorkouts(now = BASE_NOW) {
  // The old one-set session lowers the causal reference seen by the six-set session. Position
  // that newer stimulus 30 seconds before its .5 crossing so the real interval update flips it.
  const weightedSet = 640 * (30 / 38) ** 1.5
  const referenceAfterOldSession = 2000 + (weightedSet - 2000) / 3
  const fatigueEdge = now - (
    36 * Math.log2((6 * weightedSet / referenceAfterOldSession) / Math.LN2) * HOUR - 30000
  )
  const balanceEdge = now - (30 * DAY - 30000)
  const strengthEdge = now - (14 * DAY - 30000)
  return [
    workout('fatigue-edge', fatigueEdge, [entry('1254', Array.from({ length: 6 }, () => set(true, { rir: 0 })))]),
    workout('balance-edge', balanceEdge, [entry('1254', [set(true, { rir: 2 })])]),
    workout('strength-edge', strengthEdge, [entry('1001', [set(true, { rir: 2 })])]),
    workout('abs-completed', now - 20 * DAY, [entry('1002', [set(true, { rir: 2 })])]),
    workout('abs-undone', now - DAY, [entry('1002', [set(false, { rir: 0 })])]),
  ]
}

function allFatiguedWorkout(now = BASE_NOW) {
  const ids = [
    '1018', '1012', '1167', '1013', '3011', '1413', '1399', '1016', '1005',
    '1010', '1003', '1001', '1511', '1494', '1002', '1000', '1396',
  ]
  return workout(
    'all-fatigued',
    now,
    ids.map(id => entry(id, Array.from({ length: 12 }, () => set(true)))),
  )
}

function allSubfullWorkout(now = BASE_NOW) {
  return workout('all-subfull', now - 15 * DAY, [entry('1254', [set(true)])])
}

function exercisePickerWorkouts(now = BASE_NOW) {
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

function resetFixture(workouts = lifecycleWorkouts()) {
  mocks.S.unit = 'kg'
  mocks.S.bodyweight = []
  mocks.S.workouts = workouts
  mocks.maps.length = 0
  mocks.mapMounts = 0
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

async function mountStats() {
  installDom()
  await act(async () => { root.render(React.createElement(React.Fragment, null, React.createElement(Stats), React.createElement(Modals))) })
}

async function unmountStats() {
  if (!root) return
  await act(async () => { root.unmount() })
  root = null
  container = null
  dom.close()
  dom = null
}

function muscleCard() {
  return [...container.querySelectorAll('.card')].find(card =>
    [...card.querySelectorAll('.seg button')].some(button =>
      ['Muscle balance', 'Fatigue', 'Strength'].includes(button.textContent.trim())))
}

function buttonWithText(scope, text) {
  return [...scope.querySelectorAll('button')].find(button => button.textContent.trim() === text)
}

function viewButton(text) {
  return buttonWithText(muscleCard(), text)
}

function balanceRangeButton(text) {
  return buttonWithText(muscleCard().querySelectorAll('.seg')[1], text)
}

async function click(button) {
  expect(button, `expected a button named ${button?.textContent || 'unknown'}`).toBeTruthy()
  await act(async () => { button.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })) })
}

async function tick(milliseconds) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds) })
}

const lastMap = () => mocks.maps.at(-1)
const expectPressed = button => expect(button?.getAttribute('aria-pressed')).toBe('true')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(BASE_NOW)
  resetFixture()
})

afterEach(async () => {
  await unmountStats()
  useUI.setState({ sheets: [] })
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Stats muscle recovery view runtime', () => {
  it('dispatches real clicks through Balance, Fatigue, and Strength and preserves selection', async () => {
    await mountStats()
    expectPressed(viewButton('Muscle balance'))
    expectPressed(balanceRangeButton('Week'))

    await click(balanceRangeButton('30d'))
    await click(buttonWithText(muscleCard(), 'All'))
    await click(muscleCard().querySelector('[data-muscle="chest"]'))
    expect(buttonWithText(muscleCard(), 'Hard')).toBeTruthy()

    await click(viewButton('Fatigue'))
    expectPressed(viewButton('Fatigue'))
    expect(lastMap().thresholds).toBeTruthy()
    expect(container.textContent).toContain('Fatigue shows how recently each muscle was trained. High means rest.')
    expect(container.querySelector('[data-selected-muscle="chest"]')).toBeTruthy()

    await click(viewButton('Strength'))
    expectPressed(viewButton('Strength'))
    expect(lastMap().thresholds.at(-1)).toEqual({ at: 1, level: 4 })
    expect(container.textContent).toContain('Strength shows retained muscle strength. Train again to reset it.')

    await click(viewButton('Muscle balance'))
    expectPressed(balanceRangeButton('30d'))
    expect(buttonWithText(muscleCard(), 'Hard')).toBeTruthy()
    expect(lastMap().selected).toBe('chest')
    expect(lastMap().load.chest).toBe(7)
  })

  it('updates the rendered Fatigue map and Balance window on the real 60-second interval', async () => {
    await mountStats()
    await click(balanceRangeButton('30d'))
    await click(viewButton('Fatigue'))
    await click(muscleCard().querySelector('[data-muscle="chest"]'))

    const mountsBeforeTick = mocks.mapMounts
    const beforeTick = lastMap().load.chest
    expect(fatigueStateOf(beforeTick)).toBe(FATIGUE_STATES.FATIGUED)
    expect(container.textContent).toContain('Fatigued')

    await tick(60000)

    const afterTick = lastMap().load.chest
    expect(mocks.mapMounts).toBe(mountsBeforeTick)
    expect(afterTick).toBeLessThan(beforeTick)
    expect(fatigueStateOf(afterTick)).toBe(FATIGUE_STATES.RECOVERING)
    expect(container.textContent).toContain('Recovering')

    await click(viewButton('Strength'))
    expect(lastMap().load.quadriceps).toBeLessThan(1)
    await click(viewButton('Muscle balance'))
    expect(lastMap().load.chest).toBe(6)
  })

  it('derives a pound-profile bodyweight in kg and passes it into the rendered Fatigue map', async () => {
    const bodyweightWorkout = workout('bodyweight', BASE_NOW, [
      entry('0001', [{ done: true, w: 0, r: 10 }]),
    ])
    resetFixture([bodyweightWorkout])
    mocks.S.unit = 'lb'
    mocks.S.bodyweight = [{ d: '2026-01-20', w: 180 }, { d: '2026-01-22', w: 220.462262 }]

    await mountStats()
    await click(viewButton('Fatigue'))

    // 220.462262 lb ~= 100 kg; ten reps score 1000 kg against the initial 2000 kg reference.
    expect(lastMap().load.abs).toBeCloseTo(1 - Math.exp(-0.5), 6)
    expect(lastMap().thresholds).toBeTruthy()
  })

  it('renders fixed absolute bands through the actual Fatigue and Strength views', async () => {
    resetFixture([allFatiguedWorkout()])
    await mountStats()
    await click(viewButton('Fatigue'))
    const fatigueMap = lastMap()
    expect(Object.keys(fatigueMap.load)).toEqual(MUSCLES)
    expect(Object.values(fatigueMap.load).every(value => value > 0.5)).toBe(true)
    expect(Object.values(levelsOf(fatigueMap.load, fatigueMap.thresholds)).every(level => level === 4)).toBe(true)

    await unmountStats()
    resetFixture([allSubfullWorkout()])
    await mountStats()
    await click(viewButton('Strength'))
    const strengthMap = lastMap()
    expect(Object.values(strengthMap.load).every(value => value < 1)).toBe(true)
    expect(Math.min(...Object.values(strengthMap.load))).toBe(STRENGTH_FLOOR)
    expect(strengthMap.thresholds.at(-1)).toEqual({ at: 1, level: 4 })
  })
})

describe('Stats exercise progress picker', () => {
  it('filters with the shared exercise matcher and still selects from the mounted sheet', async () => {
    resetFixture(exercisePickerWorkouts())
    await mountStats()
    expect(EXIDX[LEGACY_SNAPSHOT_ID]).toBeUndefined()

    const card = [...container.querySelectorAll('.card')].find(el => el.querySelector('h2')?.textContent.trim() === 'Exercise progress')
    const selector = [...card.querySelectorAll('button')].find(button => button.querySelector('.lrow-t')?.textContent.trim() === 'Exercise')
    await click(selector)

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

    expect(modal.textContent).toContain('barbell full squat')
    expect(modal.textContent).not.toContain('barbell bench press')

    const matching = [...modal.querySelectorAll('button')].find(button => button.textContent.includes('barbell full squat'))
    await click(matching)

    expect(useUI.getState().sheets).toHaveLength(0)
    expect(card.querySelector('.lrow-v').textContent).toContain('barbell full squat')
  })
})
