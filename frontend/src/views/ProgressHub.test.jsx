// @vitest-environment happy-dom
// Progress root: the range for the tab, the two things to log, and a card per area. NutriTrace is
// faked at the fetch boundary (lib/nutrition/fake-nutritrace.js) for the two cards that need it.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { isoOf } from '../lib/format.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { resetSyncThrottle } from '../lib/nutrition/sync.js'
import { useTrends, useWellness } from '../lib/nutrition/use-trends.js'
import { createFakeNutriTrace, fixtureSettings } from '../lib/nutrition/fake-nutritrace.js'
import { bwSheet } from '../sheets.jsx'
import { measurementLogSheet } from './Measurements.jsx'
import ProgressHub from './ProgressHub.jsx'

const mocks = vi.hoisted(() => ({ charts: [] }))
const navigate = vi.fn()
let search = ''
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate, useLocation: () => ({ search }) }))
vi.mock('../sheets.jsx', () => ({ bwSheet: vi.fn() }))
vi.mock('./Measurements.jsx', () => ({ measurementLogSheet: vi.fn() }))
vi.mock('../components/LineChart.jsx', () => ({ default: props => { mocks.charts.push(props); return null } }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const KEY = 'gains.progressRange'
const ago = n => isoOf(new Date(Date.now() - n * 24 * 3600 * 1000))
let nt, host, root

const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
const mount = async () => { await act(async () => { root.render(<ProgressHub />) }); await settle() }
const text = () => host.textContent
const click = async el => { await act(async () => { el.click() }); await settle() }
const card = title => [...host.querySelectorAll('.stat-sec')].find(c => c.querySelector('h2')?.textContent === title)
const cardButton = title => card(title).querySelector('h2 button')
const rangeButtons = () => [...host.querySelectorAll('.seg button')]
const rangeOn = () => rangeButtons().filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent)
const actionButton = label => [...host.querySelectorAll('.act-b')].find(b => b.textContent === label)
const pill = (scope, label) => [...scope.querySelectorAll('button')].find(b => b.textContent === label)
const weighIn = (n, w) => ({ d: ago(n), w, t: Date.now() - n * 86400000 })
const workout = (n, prs = [], sets = 2) => ({
  id: 'w' + n, d: ago(n), start: Date.now() - n * 86400000, name: 'Push',
  prs,
  entries: [{ id: '0025', sets: Array.from({ length: sets }, () => ({ w: 60, r: 5, done: true })) }, { id: '0030', sets: [{ w: 20, r: 8, done: false }] }],
})
const setS = patch => useStore.setState(s => ({ S: { ...s.S, ...patch } }))

const diaryDay = n => ({ date: ago(n), items: [{ uuid: 'i' + n, meal: 0, name: 'Food', quantity: 1, nutrition: { calories: 2000, proteins: 100 } }], water: [], body_stats: {}, notes: '', completed_at: null, completed_meals: [], tombstones: [] })
const wearable = () => ({ fitbit: { [ago(2)]: { sleep_duration_min: 480, resting_hr: 54 } } })

beforeEach(() => {
  navigate.mockClear()
  vi.mocked(bwSheet).mockClear()
  vi.mocked(measurementLogSheet).mockClear()
  mocks.charts = []
  search = ''
  localStorage.clear()
  nt = createFakeNutriTrace({ settings: { ...fixtureSettings(), fitbitEnabled: true }, wellness: wearable(), days: { [ago(1)]: diaryDay(1), [ago(2)]: diaryDay(2) } })
  vi.stubGlobal('fetch', nt.fetch)
  useStore.setState(s => ({
    user: null,
    pushState: vi.fn(async () => {}),
    S: { ...s.S, routines: [], workouts: [], bodyweight: [], dayPlan: {}, week: {}, active: null, unit: 'kg', targetW: null },
  }))
  useNutrition.getState().reset()
  useTrends.getState().reset()
  useWellness.getState().reset()
  resetSyncThrottle()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
})

describe('Progress root: the range', () => {
  it('starts a first visit at 3M, with 1M, 3M, 1Y and All on offer', async () => {
    await mount()
    expect(rangeButtons().map(b => b.textContent)).toEqual(['1M', '3M', '1Y', 'All'])
    expect(rangeOn()).toEqual(['3M'])
  })

  it('starts at the range this device picked last', async () => {
    localStorage.setItem(KEY, '365')
    await mount()
    expect(rangeOn()).toEqual(['1Y'])
  })

  it('takes the address\'s range over the remembered one', async () => {
    localStorage.setItem(KEY, '365')
    search = '?range=30'
    await mount()
    expect(rangeOn()).toEqual(['1M'])
  })

  it('reads a range it does not offer as the remembered one', async () => {
    localStorage.setItem(KEY, '30')
    search = '?range=45'
    await mount()
    expect(rangeOn()).toEqual(['1M'])
  })

  it('remembers a pick and puts it in the address in place of the entry (replace)', async () => {
    await mount()
    await click(rangeButtons().find(b => b.textContent === 'All'))
    expect(localStorage.getItem(KEY)).toBe('0')
    expect(navigate).toHaveBeenLastCalledWith('/progress?range=0', { replace: true })
    await click(rangeButtons().find(b => b.textContent === '1M'))
    expect(localStorage.getItem(KEY)).toBe('30')
    expect(navigate).toHaveBeenLastCalledWith('/progress?range=30', { replace: true })
  })

  it('cuts the cards to the range', async () => {
    setS({ workouts: [workout(5), workout(60), workout(200)] })
    search = '?range=30'
    await mount()
    expect(card('Training load').textContent).toContain('1Workouts')
    search = '?range=365'
    await mount()
    expect(card('Training load').textContent).toContain('3Workouts')
    search = '?range=0'
    await mount()
    expect(card('Training load').textContent).toContain('3Workouts')
  })
})

describe('Progress root: logging', () => {
  it('has Weigh in and Log measurements, each opening its sheet', async () => {
    await mount()
    await click(actionButton('Weigh in'))
    expect(bwSheet).toHaveBeenCalledTimes(1)
    await click(actionButton('Log measurements'))
    expect(measurementLogSheet).toHaveBeenCalledTimes(1)
  })
})

describe('Progress root: Body', () => {
  it('is empty without a weigh-in: a dash, a note, and Log weight as the one pill', async () => {
    await mount()
    const c = card('Body')
    expect(c.textContent).toContain('–')
    expect(c.textContent).toContain('Latest')
    expect(c.textContent).toContain('No weigh-ins yet')
    expect(mocks.charts).toHaveLength(0)
    await click(pill(c, 'Log weight'))
    expect(bwSheet).toHaveBeenCalledTimes(1)
  })

  it('shows the latest weigh-in and its change over the range, with a sparkline', async () => {
    setS({ bodyweight: [weighIn(100, 90), weighIn(20, 80), weighIn(10, 79), weighIn(1, 78)] })
    search = '?range=30'
    await mount()
    const c = card('Body')
    expect(c.textContent).toContain('78kgLatest')
    expect(c.textContent).toContain('−2kgWeight change')
    expect(pill(c, 'Log weight')).toBeUndefined()
    const chart = mocks.charts.at(-1)
    expect(chart.points.map(p => p.y)).toEqual([80, 79, 78])
    // The card's own numbers say the same, so the sparkline is hidden from a screen reader.
    expect(chart).toMatchObject({ unit: 'kg', axes: false, decorative: true })
  })

  it('counts every weigh-in on All', async () => {
    setS({ bodyweight: [weighIn(100, 90), weighIn(20, 80), weighIn(1, 78)] })
    search = '?range=0'
    await mount()
    expect(card('Body').textContent).toContain('−12kgWeight change')
    expect(mocks.charts.at(-1).points).toHaveLength(3)
  })

  it('has no change and no chart for one weigh-in in the range', async () => {
    setS({ bodyweight: [weighIn(100, 90), weighIn(2, 78)] })
    search = '?range=30'
    await mount()
    const c = card('Body')
    expect(c.textContent).toContain('78kgLatest')
    expect(c.textContent).not.toContain('Weight change')
    expect(mocks.charts).toHaveLength(0)
  })

  it('reads a change toward the goal in the accent ink and away from it in danger ink', async () => {
    setS({ bodyweight: [weighIn(10, 80), weighIn(1, 78)], targetW: 70 })
    search = '?range=30'
    await mount()
    const num = () => [...card('Body').querySelectorAll('.stat-sec-num')].find(n => n.textContent.includes('kg') && n.nextSibling?.textContent === 'Weight change')
    expect(num().className).toContain('ink-acc')
    setS({ bodyweight: [weighIn(10, 78), weighIn(1, 80)] })
    await settle()
    expect(num().textContent).toBe('+2kg')
    expect(num().className).toContain('ink-danger')
  })

  it('leaves the change plain with no goal to read it against', async () => {
    setS({ bodyweight: [weighIn(10, 80), weighIn(1, 78)] })
    search = '?range=30'
    await mount()
    const change = [...card('Body').querySelectorAll('.stat-sec-v')].find(v => v.textContent.includes('Weight change'))
    expect(change.querySelector('.stat-sec-num').className).not.toMatch(/ink-/)
  })

  it('shows pounds when the unit is lb', async () => {
    setS({ unit: 'lb', bodyweight: [weighIn(10, 180), weighIn(1, 178)] })
    search = '?range=30'
    await mount()
    expect(card('Body').textContent).toContain('178lbLatest')
    expect(mocks.charts.at(-1).unit).toBe('lb')
  })
})

describe('Progress root: Strength and Training load', () => {
  it('counts personal records and exercises trained in the range', async () => {
    setS({ workouts: [workout(3, [{ id: 'a' }, { id: 'b' }]), workout(5, [{ id: 'c' }]), workout(200, [{ id: 'old' }])] })
    search = '?range=30'
    await mount()
    const c = card('Strength').textContent
    expect(c).toContain('3Personal records')
    // 0025 had done sets; 0030 had none done
    expect(c).toContain('1Exercises trained')
    expect(c).not.toContain('Finish a workout')
  })

  it('says how to start before the first workout', async () => {
    await mount()
    const c = card('Strength').textContent
    expect(c).toContain('–Personal records')
    expect(c).toContain('Finish a workout and your strength curves start here.')
  })

  it('counts workouts and done sets in the range, and the week streak', async () => {
    setS({ workouts: [workout(0, [], 3), workout(2, [], 2), workout(300, [], 4)] })
    search = '?range=30'
    await mount()
    const c = card('Training load').textContent
    expect(c).toContain('2Workouts')
    expect(c).toContain('5Sets')
    expect(c).toMatch(/\d+ week streak/)
  })

  it('reads 0 week streak with no workouts', async () => {
    await mount()
    expect(card('Training load').textContent).toContain('0 week streak')
  })
})

describe('Progress root: Nutrition trends and Recovery', () => {
  beforeEach(() => setS({}))
  const signIn = () => useStore.setState({ user: { id: 3, name: 'Ana' } })

  it('has neither card for a guest and asks NutriTrace for nothing', async () => {
    await mount()
    expect(card('Nutrition trends')).toBeUndefined()
    expect(card('Recovery')).toBeUndefined()
    expect(nt.requests).toHaveLength(0)
  })

  it('shows the averages and the days logged', async () => {
    signIn()
    search = '?range=30'
    await mount()
    const c = card('Nutrition trends').textContent
    expect(c).toContain('2,000kcalCalories a day')
    expect(c).toContain('100gProtein a day')
    expect(c).toContain('2 days logged')
  })

  it('says when no food is logged', async () => {
    signIn()
    nt.state.days = {}
    await mount()
    const c = card('Nutrition trends')
    expect(c.textContent).toContain('No food logged yet')
    expect(c.textContent).toContain('–Calories a day')
  })

  it('shows a loading card until the diary answers', async () => {
    signIn()
    const held = nt.hold('GET', '/nt/api/diary')
    await mount()
    expect(card('Nutrition trends').getAttribute('aria-busy')).toBe('true')
    expect(card('Nutrition trends').textContent).not.toContain('Calories a day')
    await act(async () => { held.release() })
    await settle()
    expect(card('Nutrition trends').getAttribute('aria-busy')).toBeNull()
    expect(card('Nutrition trends').textContent).toContain('Calories a day')
  })

  it('says it did not load and retries on Try again', async () => {
    signIn()
    nt.failNext('GET', '/nt/api/diary', { status: 500 })
    await mount()
    const c = card('Nutrition trends')
    expect(c.textContent).toContain('Nutrition did not load')
    expect(c.textContent).not.toContain('Calories a day')
    await click(pill(c, 'Try again'))
    expect(card('Nutrition trends').textContent).toContain('2,000kcalCalories a day')
    expect(card('Nutrition trends').textContent).not.toContain('did not load')
  })

  it('shows Recovery once a wearable has reported, with its two headlines', async () => {
    signIn()
    search = '?range=30'
    await mount()
    const c = card('Recovery').textContent
    expect(c).toContain('8hSleep')
    expect(c).toContain('54bpmResting heart rate')
    expect(c).toContain('From your wearable')
  })

  it('has no Recovery card without a wearable reading, but keeps Nutrition trends', async () => {
    signIn()
    nt.state.settings = fixtureSettings()
    await mount()
    expect(card('Nutrition trends')).toBeDefined()
    expect(card('Recovery')).toBeUndefined()
  })

  it('keeps Recovery with a note when the range holds no readings', async () => {
    signIn()
    nt.state.wellness = { fitbit: { [ago(200)]: { resting_hr: 60 } } }
    search = '?range=30'
    await mount()
    expect(card('Recovery').textContent).toContain('No readings in this range')
  })
})

describe('Progress root: opening a card', () => {
  it('opens each page at the range', async () => {
    useStore.setState({ user: { id: 3, name: 'Ana' } })
    search = '?range=365'
    await mount()
    for (const [title, path] of [
      ['Body', '/progress/body'], ['Strength', '/progress/strength'], ['Training load', '/progress/load'],
      ['Nutrition trends', '/progress/trends'], ['Recovery', '/progress/recovery'],
    ]) {
      await click(cardButton(title))
      expect(navigate).toHaveBeenLastCalledWith(path + '?range=365')
    }
  })

  it('opens at the remembered range, and 3M on a first visit', async () => {
    await mount()
    await click(cardButton('Body'))
    expect(navigate).toHaveBeenLastCalledWith('/progress/body?range=90')
    localStorage.setItem(KEY, '0')
    await mount()
    await click(cardButton('Strength'))
    expect(navigate).toHaveBeenLastCalledWith('/progress/strength?range=0')
  })
})
