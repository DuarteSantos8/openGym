// @vitest-environment happy-dom
// Home as the day's diary, and the + sheet's logging rows, against NutriTrace faked at the fetch
// boundary (lib/nutrition/fake-nutritrace.js: NutriTrace's real shapes, merge and the hub's rules).
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO, isoOf } from '../lib/format.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useDiarySelection } from '../lib/nutrition/selection.js'
import { useHubSync, resetSyncThrottle } from '../lib/nutrition/sync.js'
import { createFakeNutriTrace, fixtureActivity, fixtureActivitySum, fixtureDay, fixtureFoods, fixtureSettings, fixtureSyncStatus } from '../lib/nutrition/fake-nutritrace.js'
import { workoutKcalMessage, reportWorkoutKcal } from '../lib/nutrition/workout-kcal.js'
import Home from './Home.jsx'
import PortionSheet from '../components/PortionSheet.jsx'
import QuickKcalSheet from '../components/QuickKcalSheet.jsx'
import AvatarButton from '../components/AvatarButton.jsx'
import { openPlusSheet } from '../components/PlusSheet.jsx'
import { bwSheet, calendarSheet } from '../sheets.jsx'
import { weighInTime } from '../lib/bodyweight.js'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const TODAY = todayISO()
const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return isoOf(d) })()
const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return isoOf(d) })()
let nt, host, root

// The sheets useUI opens, rendered where the test can reach them.
function Sheets() {
  const sheets = useUI(s => s.sheets)
  return sheets.map(s => <div key={s.id} data-sheet="">{s.render(() => useUI.getState().closeSheet(s.id))}</div>)
}
const mount = async el => { await act(async () => { root.render(<>{el}<Sheets /></>) }); await settle() }
const settle = async (ms = 0) => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, ms)) }) }
const text = () => host.textContent
const button = (label, scope = host) => [...scope.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent).trim() === label)
const buttonStarting = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(label))
const click = async el => { await act(async () => { el.click() }); await settle() }
const lastSheet = () => [...host.querySelectorAll('[data-sheet]')].at(-1)
const puts = () => nt.writes().filter(r => r.method === 'PUT')
const typeInto = async (input, value) => {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
}

function useFake(opts = {}) {
  nt = createFakeNutriTrace({
    days: { [TODAY]: fixtureDay(TODAY) },
    activity: { [TODAY]: fixtureActivity(TODAY) },
    activitySum: { [TODAY]: fixtureActivitySum(TODAY) },
    ...opts,
  })
  vi.stubGlobal('fetch', nt.fetch)
}

beforeEach(() => {
  useFake()
  useStore.setState(s => ({
    user: { id: 3, name: 'Ana' },
    pushState: vi.fn(async () => {}),
    S: { ...s.S, routines: [], workouts: [], bodyweight: [{ d: yesterday, w: 80.4, t: 1 }], dayPlan: {}, week: {}, active: null, checkIn: false, unit: 'kg' },
  }))
  useNutrition.getState().reset()
  useDiarySelection.getState().reset()
  useHubSync.getState().reset()
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null })
  resetSyncThrottle()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe('Home is the diary', () => {
  it('adds the day up: energy left, macros, water, meals and the workout entry', async () => {
    await mount(<Home />)
    // 2200 target − (228 oats + 450 quick) eaten
    expect(host.querySelector('.kcal-left').textContent).toBe('1,522')
    expect(text()).toContain('Protein')
    expect(text()).toContain('250 ml / 2,500 ml')
    const meals = [...host.querySelectorAll('.meal-name')].map(n => n.textContent)
    expect(meals).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Snacks'])
    expect(host.querySelectorAll('.meal-kcal')[0].textContent).toBe('228 kcal')
    // A fixed target with "Adjust goal from activity" off: the workout shows, not counted.
    const workout = host.querySelector('.activity-row')
    expect(workout.textContent).toContain('Push A')
    expect(workout.textContent).toContain('Workout (estimate) · Not added to your target')
  })

  it('a workout a wearable covers reads "Covered by" its device', async () => {
    useFake({ activity: { [TODAY]: fixtureActivity(TODAY, 'garmin') }, activitySum: { [TODAY]: fixtureActivitySum(TODAY, 'garmin') } })
    await mount(<Home />)
    expect(host.querySelector('.activity-row').textContent).toContain('Covered by Garmin')
  })

  it('a day that does not load says so and retries, instead of showing an empty day', async () => {
    nt.failNext('GET', `/nt/api/diary/${TODAY}`, 'offline')
    await mount(<Home />)
    expect(host.querySelector('[role="alert"]').textContent).toBe('The diary did not load: no connection.')
    await click(button('Try again'))
    expect(host.querySelector('.kcal-left').textContent).toBe('1,522')
  })

  it('the date strip moves the whole page to the day before', async () => {
    useFake({ days: { [TODAY]: fixtureDay(TODAY), [yesterday]: { ...fixtureDay(yesterday), items: [] } } })
    useStore.setState(s => ({ S: { ...s.S, bodyweight: [{ d: yesterday, w: 80.4, t: 1 }, { d: TODAY, w: 81.6, t: 2 }] } }))
    await mount(<Home />)
    expect(host.querySelector('.bw-now .big').textContent).toContain('81.6')
    await click(button('Previous day'))
    expect(host.querySelector('.date-strip-l').textContent).toContain('Yesterday')
    expect(nt.requests.some(r => r.path === `/nt/api/diary/${yesterday}`)).toBe(true)
    expect(host.querySelector('.kcal-left').textContent).toBe('2,200')
    // The Today card gives way to that day's training, and its weight is that day's.
    expect(host.querySelector('.day-session')).toBeTruthy()
    expect(host.querySelector('.bw-now .big').textContent).toContain('80.4')
    await click(button('Today'))
    expect(host.querySelector('.day-session')).toBeNull()
    expect(host.querySelector('.bw-now .big').textContent).toContain('81.6')
  })

  // Blocker: nothing is shown or logged for a day that has not happened.
  it('stops at today: no next day, no future date, no future log', async () => {
    await mount(<Home />)
    expect(button('Next day').disabled).toBe(true)
    act(() => useDiarySelection.getState().setDate(tomorrow))
    expect(useDiarySelection.getState().day()).toBe(TODAY)
    const before = nt.requests.length
    await expect(useNutrition.getState().logWater(tomorrow, useNutrition.getState().draftWater(250))).rejects.toMatchObject({ code: 'invalid' })
    expect(nt.requests.length).toBe(before)
  })

  it('a target that loads its Adaptive input shows no number until it is in', async () => {
    useFake({ settings: { ...fixtureSettings(), calorieGoalMode: 'adaptive', calorieAdjustFromActivity: true }, adaptiveTdee: { ready: true, tdee: 2600 },
      activity: { [TODAY]: fixtureActivity(TODAY) }, activitySum: { [TODAY]: fixtureActivitySum(TODAY) } })
    const slow = nt.hold('GET', '/nt/api/goals/adaptive-tdee')
    await mount(<Home />)
    expect(host.querySelector('.kcal-left').textContent).toBe('–')
    slow.release()
    await settle()
    // 2600 learned, training already in it: the 190 kcal workout adds nothing. 2600 − 678.
    expect(host.querySelector('.kcal-left').textContent).toBe('1,922')
    expect(text()).not.toContain('from activity')
  })

  it('a fixed target with "Adjust goal from activity" on adds the day\'s activity', async () => {
    useFake({ settings: { ...fixtureSettings(), calorieAdjustFromActivity: true } })
    await mount(<Home />)
    // (2200 + 190) − 678
    expect(host.querySelector('.kcal-left').textContent).toBe('1,712')
    expect(text()).toContain('incl. 190 kcal from activity')
    expect(host.querySelector('.activity-row').textContent).not.toContain('Not added')
  })

  it('settings that do not load are an error with a retry, not a 2,000 default', async () => {
    nt.failNext('GET', '/nt/api/settings', { status: 502 })
    await mount(<Home />)
    expect(host.querySelector('.kcal-card')).toBeNull()
    expect(host.querySelector('[role="alert"]').textContent).toBe('The diary did not load.')
    await click(button('Try again'))
    expect(host.querySelector('.kcal-left').textContent).toBe('1,522')
  })

  it('under wearable_wins a manual activity on a wearable day reads as not counted', async () => {
    const rows = [...fixtureActivity(TODAY, 'garmin'), { id: 42, date: TODAY, name: 'Run', kcal: 300, source: 'manual_form', external_id: null, covered_by: null }]
    useFake({ settings: { ...fixtureSettings(), calorieAdjustFromActivity: true }, activity: { [TODAY]: rows }, activitySum: { [TODAY]: fixtureActivitySum(TODAY, 'garmin') } })
    await mount(<Home />)
    const [workout, run] = host.querySelectorAll('.activity-row')
    expect(workout.textContent).toContain('Covered by Garmin')
    expect(run.textContent).toContain('Not counted: your wearable reports this day')
  })

  it('hides the activity rows with NutriTrace\'s activity section off', async () => {
    useFake({ settings: { ...fixtureSettings(), diaryShowActivity: false } })
    await mount(<Home />)
    expect(host.querySelector('.kcal-left').textContent).toBe('1,522')
    expect(host.querySelector('.activity-row')).toBeNull()
  })

  it('+250 ml logs a glass to the shown day, with Undo', async () => {
    await mount(<Home />)
    await click(button('Add a glass of water, 250 ml'))
    expect(puts()).toHaveLength(1)
    expect(puts()[0].body.water.map(w => w.amount)).toEqual([250, 250])
    expect(text()).toContain('500 ml / 2,500 ml')
    expect(useUI.getState().toastMsg).toBe('Water added')
    await act(async () => { useUI.getState().runToastAction() })
    await settle()
    expect(text()).toContain('250 ml / 2,500 ml')
  })

  it('a glass whose answer was lost is counted once when tapped again', async () => {
    await mount(<Home />)
    nt.failNext('PUT', '/nt/api/diary/', { lost: true, status: 504 })
    await click(button('Add a glass of water, 250 ml'))
    expect(useUI.getState().toastMsg).toBe('Not saved. Try again.')
    await click(button('Add a glass of water, 250 ml'))
    expect(nt.state.days[TODAY].water.map(w => w.amount)).toEqual([250, 250])
  })

  it('a meal\'s + opens the picker under it: recents, then your foods and online results', async () => {
    await mount(<Home />)
    await click(button('Add to Lunch'))
    const picker = host.querySelector('.meal-picker')
    expect([...picker.querySelectorAll('.food-row .tt')].map(n => n.textContent)).toEqual(['Rolled oats', 'Wholemeal bread', 'Quick kcal'])
    await typeInto(picker.querySelector('input'), 'nut')
    await settle(150)
    await vi.waitFor(() => expect(picker.textContent).toContain('Nutella'), { timeout: 2000 })
    expect(picker.textContent).toContain('None of your foods match.')
    const search = nt.requests.find(r => r.path === '/nt/api/proxy')
    expect(new URL(search.query.url).searchParams.get('q')).toBe('nut')
  })
})

describe('logging a food', () => {
  const bread = () => ({ ...fixtureFoods()[1], imgUrl: '' })

  it('logs the amount to the meal and date it was opened for', async () => {
    await useNutrition.getState().loadSettings()
    await mount(<PortionSheet food={bread()} date={TODAY} meal={2} mealName="Dinner" close={() => {}} />)
    await click(button('slice'))
    await typeInto(host.querySelector('input[aria-label="Serving size"]'), '2')
    expect(host.querySelector('.portion-sum .big').textContent).toBe('178 kcal')
    await click(button('Log'))
    const item = nt.state.days[TODAY].items.at(-1)
    expect(item).toMatchObject({ name: 'Wholemeal bread', meal: 2, portion: 2, unit: 'slice', quantity: 1 })
    expect(useUI.getState().toastMsg).toBe('Logged to Dinner')
  })

  it('a failed write keeps the sheet and its amount, and the retry logs once', async () => {
    const close = vi.fn()
    await mount(<PortionSheet food={bread()} date={TODAY} meal={0} mealName="Breakfast" close={close} />)
    await typeInto(host.querySelector('input[aria-label="Servings"]'), '3')
    nt.failNext('PUT', '/nt/api/diary/', { lost: true })
    await click(button('Log'))
    expect(close).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alert"]').textContent).toBe('Not saved: no connection. Try again when you are back online.')
    expect(host.querySelector('input[aria-label="Servings"]').value).toBe('3')
    await click(button('Log'))
    expect(close).toHaveBeenCalled()
    expect(nt.state.days[TODAY].items.filter(i => i.name === 'Wholemeal bread')).toHaveLength(1)
  })

  it('refuses 0 servings instead of logging one', async () => {
    await mount(<PortionSheet food={bread()} date={TODAY} meal={0} mealName="Breakfast" close={() => {}} />)
    await typeInto(host.querySelector('input[aria-label="Servings"]'), '0')
    expect(button('Log').disabled).toBe(true)
    expect(text()).toContain('Enter an amount above 0.')
  })

  it('an amount edited after a lost answer updates that entry instead of adding one', async () => {
    const pending = { uuid: null, food: null }
    await mount(<PortionSheet food={bread()} date={TODAY} meal={0} mealName="Breakfast" pending={pending} close={() => {}} />)
    nt.failNext('PUT', '/nt/api/diary/', { lost: true, status: 504 })
    await click(button('Log'))
    await typeInto(host.querySelector('input[aria-label="Servings"]'), '2')
    await click(button('Log'))
    const logged = nt.state.days[TODAY].items.filter(i => i.name === 'Wholemeal bread')
    expect(logged).toHaveLength(1)
    expect(logged[0].quantity).toBe(2)
  })

  it('the same picker session reuses that entry from a reopened sheet', async () => {
    const pending = { uuid: null, food: null }
    nt.failNext('PUT', '/nt/api/diary/', { lost: true, status: 504 })
    await mount(<PortionSheet key="a" food={bread()} date={TODAY} meal={0} mealName="Breakfast" pending={pending} close={() => {}} />)
    await click(button('Log'))
    await mount(<PortionSheet key="b" food={bread()} date={TODAY} meal={0} mealName="Breakfast" pending={pending} close={() => {}} />)
    await click(button('Log'))
    expect(nt.state.days[TODAY].items.filter(i => i.name === 'Wholemeal bread')).toHaveLength(1)
  })

  it('a kJ user enters Quick kcal in kJ; it is stored as kcal', async () => {
    useFake({ settings: { ...fixtureSettings(), energyUnit: 'kJ' } })
    await useNutrition.getState().loadSettings()
    await mount(<QuickKcalSheet date={TODAY} meal={1} mealName="Lunch" close={() => {}} />)
    await typeInto(host.querySelector('input[aria-label="kJ"]'), '1000')
    await click(button('Log'))
    expect(nt.state.days[TODAY].items.at(-1).nutrition.calories).toBe(239)
  })
})

describe('the + sheet', () => {
  it('names where it logs, lists Anytime in order and offers Log food and Scan', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${TODAY}T12:10:00`))
    await useNutrition.getState().loadSettings()
    await mount(<></>)
    await act(async () => { openPlusSheet('/home') })
    await settle()
    const sheet = lastSheet()
    expect(sheet.querySelector('.logging-to').textContent).toBe('Logging toToday · Lunch')
    const rows = [...sheet.querySelectorAll('.sect')].at(-1).querySelectorAll('.lrow-t')
    expect([...rows].map(r => r.textContent)).toEqual(['Quick kcal', 'Weigh in', 'Start workout', 'Water'])
    expect(button('Log food', sheet)).toBeTruthy()
    expect(button('Scan', sheet)).toBeTruthy()
    vi.useRealTimers()
  })

  it('a meal picked in the header is where Quick kcal logs', async () => {
    await useNutrition.getState().loadSettings()
    await mount(<></>)
    await act(async () => { openPlusSheet('/home') })
    await settle()
    await click(lastSheet().querySelector('.logging-to'))
    await click([...lastSheet().querySelectorAll('.menu-item')].find(m => m.textContent === 'Snacks'))
    expect(lastSheet().querySelector('.logging-to').textContent).toContain('Snacks')
    await click(button('Quick kcal', lastSheet()))
    await typeInto(lastSheet().querySelector('input[aria-label="kcal"]'), '300')
    await click(button('Log', lastSheet()))
    expect(nt.state.days[TODAY].items.at(-1)).toMatchObject({ type: 'quick_calories', meal: 3, nutrition: { calories: 300 } })
  })

  it('leaves the nutrition rows out without a session for the hub', async () => {
    useStore.setState({ user: null })
    await mount(<></>)
    await act(async () => { openPlusSheet('/home') })
    await settle()
    expect(lastSheet().querySelector('.logging-to')).toBeNull()
    expect(lastSheet().textContent).not.toContain('Quick kcal')
    expect(nt.requests).toHaveLength(0)
  })
})

describe('sync after a weigh-in and a workout', () => {
  it('a weigh-in pushes openGym, then asks the hub to sync now', async () => {
    const order = []
    useStore.setState({ pushState: vi.fn(async () => { order.push('push') }) })
    vi.stubGlobal('fetch', vi.fn((...a) => { order.push(String(a[0])); return nt.fetch(...a) }))
    await mount(<></>)
    await act(async () => { bwSheet() })
    await settle()
    await click(button('Save', lastSheet()))
    await settle()
    expect(order[0]).toBe('push')
    expect(order).toContain('/hub/api/sync/now')
  })

  it('a weigh-in from Home on a past day is logged to that day', async () => {
    await mount(<></>)
    await act(async () => { bwSheet({ date: yesterday }) })
    await settle()
    await click(button('Save', lastSheet()))
    // `t` is the change stamp (now); charts place it on its own day, not on the day it was typed.
    const entry = useStore.getState().S.bodyweight.find(b => b.d === yesterday)
    expect(entry.t).toBeGreaterThan(new Date(TODAY + 'T00:00:00').getTime())
    expect(weighInTime(entry)).toBe(new Date(yesterday + 'T12:00:00').getTime())
  })

  it('a weigh-in asked for a day to come is logged today', async () => {
    await mount(<></>)
    await act(async () => { bwSheet({ date: tomorrow }) })
    await settle()
    await click(button('Save', lastSheet()))
    const bw = useStore.getState().S.bodyweight
    expect(bw.some(b => b.d === tomorrow)).toBe(false)
    expect(bw.find(b => b.d === TODAY)).toBeTruthy()
  })

  it('the workout toast speaks kJ to a kJ user', () => {
    const settings = { ...fixtureSettings(), calorieAdjustFromActivity: true, energyUnit: 'kJ' }
    expect(workoutKcalMessage({ kcal: 187, settings, covered: false, inputs: { date: TODAY } }))
      .toBe('Added to your day: about 780 kJ (estimate)')
  })

  it('reports what a finished workout did to the target, in the decision\'s words', async () => {
    const settings = fixtureSettings()
    const inputs = { date: TODAY }
    expect(workoutKcalMessage({ kcal: 187, settings: { ...settings, calorieAdjustFromActivity: true }, covered: false, inputs }))
      .toBe('Added to your day: about 190 kcal (estimate)')
    expect(workoutKcalMessage({ kcal: 187, settings: { ...settings, calorieGoalMode: 'adaptive' }, covered: false, inputs: { ...inputs, adaptiveTdee: 2600 } }))
      .toBe('Logged. Your target already includes training.')
    expect(workoutKcalMessage({ kcal: 187, settings: { ...settings, calorieAdjustFromActivity: true }, covered: true, inputs }))
      .toBe('Logged. Your target already includes training.')
    expect(workoutKcalMessage({ kcal: 187, settings, covered: false, inputs })).toBeNull()
  })

  it('after the sync, reads the workout\'s kcal row and toasts it', async () => {
    useFake({
      settings: { ...fixtureSettings(), calorieAdjustFromActivity: true },
      workouts: { w1: { workout_id: 'w1', date: TODAY, kcal: 194, kcal_method: 'og-met-v1', weight_kg: 80, state: 'synced' } },
    })
    await expect(reportWorkoutKcal({ id: 'w1', d: TODAY })).resolves.toBe('Added to your day: about 190 kcal (estimate)')
    expect(useUI.getState().toastMsg).toBe('Added to your day: about 190 kcal (estimate)')
    await expect(reportWorkoutKcal({ id: 'missing', d: TODAY })).resolves.toBeNull()
  })
})

describe('the avatar dot', () => {
  it('shows when the hub sync needs the person', async () => {
    await mount(<AvatarButton />)
    expect(host.querySelector('.tab-dot')).toBeNull()
    await act(async () => { useHubSync.setState({ status: fixtureSyncStatus('needs_confirmation') }) })
    expect(host.querySelector('.tab-dot')).toBeTruthy()
    expect(host.querySelector('.avatar-btn').getAttribute('aria-label')).toBe('Profile, Nutrition sync needs attention')
  })

  it('reads the hub status again when the app comes back to the front', async () => {
    await mount(<AvatarButton />)
    const reads = () => nt.requests.filter(r => r.path === '/hub/api/sync/status').length
    expect(reads()).toBe(1)
    nt.state.syncStatus = fixtureSyncStatus('error')
    resetSyncThrottle()
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await settle()
    expect(reads()).toBe(2)
    expect(host.querySelector('.tab-dot')).toBeTruthy()
    // Within the refresh interval, focus does not ask again.
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await settle()
    expect(reads()).toBe(2)
  })
})

describe('the calendar as Home\'s date picker', () => {
  afterEach(() => vi.useRealTimers())

  it('reads only the days up to today, and stops when the sheet closes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-20T10:00:00'))
    await mount(<></>)
    await act(async () => { calendarSheet('2026-10-20', { onPick: () => {} }) })
    await settle()
    const days = nt.requests.filter(r => r.path.startsWith('/nt/api/diary/')).map(r => r.path.slice(-10))
    expect(days.length).toBe(20)
    expect(days.every(d => d <= '2026-10-20')).toBe(true)
    expect([...lastSheet().querySelectorAll('.cal-d')].filter(b => b.disabled).map(b => b.textContent)).toContain('21')

    // A slow line: the month's reads are still going when the sheet closes, and stop there.
    useNutrition.getState().reset()
    await act(async () => { useUI.setState({ sheets: [] }) })
    let calls = 0
    vi.stubGlobal('fetch', (...a) => { calls += 1; return new Promise(r => setTimeout(() => r(nt.fetch(...a)), 30)) })
    await act(async () => { calendarSheet('2026-09-15', { onPick: () => {} }) })
    await act(async () => { useUI.setState({ sheets: [] }) })
    await settle(40)
    await settle(40)
    expect(calls).toBeLessThanOrEqual(4)
  })
})
