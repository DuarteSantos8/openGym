// @vitest-environment happy-dom
// Progress › Recovery and the hub's two NutriTrace cards, against NutriTrace faked at the fetch
// boundary (lib/nutrition/fake-nutritrace.js: the wellness /data routes under the hub's query rule).
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { isoOf } from '../lib/format.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { resetSyncThrottle } from '../lib/nutrition/sync.js'
import { useTrends, useWellness } from '../lib/nutrition/use-trends.js'
import { createFakeNutriTrace, fixtureSettings } from '../lib/nutrition/fake-nutritrace.js'
import ProgressHub from './ProgressHub.jsx'
import Recovery from './Recovery.jsx'

const navigate = vi.fn()
let search = ''
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate, useLocation: () => ({ search }) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ago = n => isoOf(new Date(Date.now() - n * 24 * 3600 * 1000))
let nt, host, root

const settle = async (ms = 0) => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, ms)) }) }
const mount = async el => { await act(async () => { root.render(el) }); await settle() }
const text = () => host.textContent
const button = label => [...host.querySelectorAll('button, [role="button"]')].find(b => (b.getAttribute('aria-label') || b.textContent).trim().startsWith(label))
const click = async el => { await act(async () => { el.click() }); await settle() }
const wellnessCalls = () => nt.requests.filter(r => r.path.startsWith('/nt/api/wellness/'))

const wearable = () => ({
  fitbit: {
    [ago(3)]: { sleep_duration_min: 420, resting_hr: 56, steps: 9000 },
    [ago(2)]: { sleep_duration_min: 480, resting_hr: 54, hrv_daily_rmssd: 42 },
  },
  garmin: { [ago(2)]: { resting_hr: 52 } },
})
const connected = (extra = {}) => ({ ...fixtureSettings(), fitbitEnabled: true, garminEnabled: true, ...extra })

function useFake(opts = {}) {
  nt = createFakeNutriTrace({ settings: connected(), wellness: wearable(), ...opts })
  vi.stubGlobal('fetch', nt.fetch)
}

beforeEach(() => {
  navigate.mockClear()
  search = ''
  useFake()
  useStore.setState(s => ({
    user: { id: 3, name: 'Ana' },
    pushState: vi.fn(async () => {}),
    S: { ...s.S, routines: [], workouts: [], bodyweight: [], dayPlan: {}, week: {}, active: null, unit: 'kg' },
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

describe('Recovery', () => {
  it('charts the first metric with data and lists the others as tiles', async () => {
    await mount(<Recovery />)
    expect(text()).toContain('Recovery')
    expect(text()).toContain('Sleep')
    expect(text()).toContain('Resting heart rate')
    expect(text()).toContain('HRV')
    expect(text()).toContain('Steps')
    expect(text()).not.toContain('Readiness')
    // sleep: 7 h and 8 h
    expect(text()).toContain('7.5')
    expect(host.querySelector('.chart polyline')).not.toBeNull()
  })

  it('reads both wearables with exactly from and to, and lets Garmin win a metric both report', async () => {
    search = '?metric=resting_hr'
    await mount(<Recovery />)
    const calls = wellnessCalls()
    expect(calls.map(c => c.path).sort()).toEqual(['/nt/api/wellness/fitbit/data', '/nt/api/wellness/garmin/data'])
    for (const c of calls) expect(Object.keys(c.query).sort()).toEqual(['from', 'to'])
    // fitbit 56, then garmin 52 over fitbit 54: (56 + 52) / 2
    expect(text()).toContain('54')
    expect(text()).toContain('Lowest')
  })

  it('opens on the metric in the address and keeps it when the range changes', async () => {
    search = '?metric=steps&range=30'
    await mount(<Recovery />)
    expect(text()).toContain('9,000')
    await click(button('1Y'))
    expect(navigate).toHaveBeenCalledWith('/progress/recovery?range=365&metric=steps', { replace: true })
    await click(button('HRV'))
    expect(navigate).toHaveBeenCalledWith('/progress/recovery?range=30&metric=hrv_daily_rmssd', { replace: true })
  })

  it('asks for nothing without a connected wearable, and says so', async () => {
    useFake({ settings: fixtureSettings(), wellness: wearable() })
    await mount(<Recovery />)
    expect(text()).toContain('No wearable data yet')
    expect(wellnessCalls()).toHaveLength(0)
  })

  it('is empty for a wearable that has reported nothing', async () => {
    useFake({ wellness: {} })
    await mount(<Recovery />)
    expect(text()).toContain('No wearable data yet')
  })

  it.each([403, 404])('reads a %i from the hub as not available yet, not as an error', async status => {
    nt.failNext('GET', '/nt/api/wellness/fitbit', { status })
    nt.failNext('GET', '/nt/api/wellness/garmin', { status })
    await mount(<Recovery />)
    expect(text()).toContain('Not available yet')
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(text()).not.toContain('did not load')
  })

  it('does not count today in steps, which are still adding up', async () => {
    useFake({ wellness: { fitbit: { [ago(0)]: { steps: 500, resting_hr: 60 }, [ago(2)]: { steps: 9000, resting_hr: 54 } } } })
    search = '?metric=steps&range=30'
    await mount(<Recovery />)
    // 9,000 alone; with today it would read 4,750
    expect(text()).toContain('9,000')
    expect(text()).not.toContain('4,750')
  })

  it('picks up a wearable connected while the page is open, and new readings, when it comes back to the front', async () => {
    useFake({ settings: fixtureSettings(), wellness: wearable() })
    await mount(<Recovery />)
    expect(text()).toContain('No wearable data yet')
    nt.state.settings.fitbitEnabled = true
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await settle()
    expect(text()).toContain('Resting heart rate')
    nt.state.wellness.fitbit[ago(1)] = { sleep_duration_min: 600 }
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await settle()
    expect(text()).toContain('8.3') // (7 + 8 + 10) / 3 h of sleep
  })

  it('still shows the other wearable when one fails', async () => {
    nt.failNext('GET', '/nt/api/wellness/garmin', { status: 500 })
    await mount(<Recovery />)
    expect(text()).toContain('Sleep')
  })

  it('offers a retry when both fail', async () => {
    nt.failNext('GET', '/nt/api/wellness/fitbit', { status: 500 })
    nt.failNext('GET', '/nt/api/wellness/garmin', { status: 500 })
    await mount(<Recovery />)
    expect(text()).toContain('Your wearable data did not load.')
    await click(button('Try again'))
    expect(text()).toContain('Sleep')
  })

  it('points a signed-out guest to the web app and asks for nothing', async () => {
    useStore.setState({ user: null })
    await mount(<Recovery />)
    expect(text()).toContain('Recovery lives in the web app')
    expect(nt.requests).toHaveLength(0)
  })
})

describe('the Progress hub', () => {
  const diaryDay = n => ({ date: ago(n), items: [{ uuid: 'i' + n, meal: 0, name: 'Food', quantity: 1, nutrition: { calories: 2000, proteins: 100 } }], water: [], body_stats: {}, notes: '', completed_at: null, completed_meals: [], tombstones: [] })

  it('adds a Nutrition trends card and a Recovery card that open at the range', async () => {
    useFake({ days: { [ago(1)]: diaryDay(1), [ago(2)]: diaryDay(2) } })
    search = '?range=30'
    await mount(<ProgressHub />)
    expect(text()).toContain('Nutrition trends')
    expect(text()).toContain('2,000 kcal a day')
    expect(text()).toContain('2 days logged · protein 100 g')
    expect(text()).toContain('Sleep 7.5 h')
    expect(text()).toContain('Resting heart rate 54 bpm')
    await click(button('Nutrition trends'))
    expect(navigate).toHaveBeenLastCalledWith('/progress/trends?range=30')
    await click(button('Recovery'))
    expect(navigate).toHaveBeenLastCalledWith('/progress/recovery?range=30')
  })

  it('has no Recovery card without wearable data, and says when no food is logged', async () => {
    useFake({ settings: fixtureSettings(), days: {} })
    await mount(<ProgressHub />)
    expect(text()).toContain('No food logged yet')
    expect(button('Recovery')).toBeUndefined()
  })

  it('has neither card for a guest', async () => {
    useStore.setState({ user: null })
    await mount(<ProgressHub />)
    expect(text()).not.toContain('Nutrition trends')
    expect(text()).not.toContain('Recovery')
    expect(nt.requests).toHaveLength(0)
  })

  it('hides the Recovery card while the hub does not forward the wearable routes', async () => {
    nt.failNext('GET', '/nt/api/wellness/fitbit', { status: 404 })
    nt.failNext('GET', '/nt/api/wellness/garmin', { status: 404 })
    await mount(<ProgressHub />)
    expect(text()).toContain('Nutrition trends')
    expect(button('Recovery')).toBeUndefined()
  })

  it('refreshes its averages when the diary changes, and when it comes back to the front', async () => {
    useFake({ settings: fixtureSettings(), days: { [ago(1)]: diaryDay(1) } })
    await mount(<ProgressHub />)
    expect(text()).toContain('2,000 kcal a day')
    nt.state.days[ago(2)] = { ...diaryDay(2), items: [{ ...diaryDay(2).items[0], nutrition: { calories: 1000, proteins: 50 } }] }
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await settle()
    expect(text()).toContain('1,500 kcal a day')
    nt.state.days[ago(3)] = { ...diaryDay(3), items: [{ ...diaryDay(3).items[0], nutrition: { calories: 600, proteins: 50 } }] }
    // what a save on Home does: the store's days change
    await act(async () => { useNutrition.setState(s => ({ days: { ...s.days } })) })
    await settle()
    expect(text()).toContain('1,200 kcal a day')
  })

  it('keeps the Recovery card when the range has no readings', async () => {
    useFake({ wellness: { fitbit: { [ago(200)]: { resting_hr: 60 } } } })
    search = '?range=30'
    await mount(<ProgressHub />)
    expect(text()).toContain('No readings in this range')
  })
})
