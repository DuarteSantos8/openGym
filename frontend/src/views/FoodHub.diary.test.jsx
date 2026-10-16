// @vitest-environment happy-dom
// The day's diary on Nutrition (moved from Home in the redesign, ux-redesign-tabs §5.1), against
// NutriTrace faked at the fetch boundary (lib/nutrition/fake-nutritrace.js: NutriTrace's real
// shapes, merge and the hub's rules): energy and macros, activity, water, the meals' pickers, an
// entry's edit sheet, the action row's flows and the shared date.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO, isoOf } from '../lib/format.js'
import { dateLocale } from '../lib/i18n.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useDiarySelection } from '../lib/nutrition/selection.js'
import { useHubSync, resetSyncThrottle } from '../lib/nutrition/sync.js'
import { createFakeNutriTrace, fixtureActivity, fixtureActivitySum, fixtureDay, fixtureSettings } from '../lib/nutrition/fake-nutritrace.js'
import FoodHub from './FoodHub.jsx'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate, useLocation: () => ({ pathname: '/food' }), useSearchParams: () => [new URLSearchParams(), vi.fn()],
}))
vi.mock('../components/CameraScan.jsx', () => ({ default: () => <p>camera</p> }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const TODAY = todayISO()
const shiftDay = n => { const d = new Date(); d.setDate(d.getDate() + n); return isoOf(d) }
const yesterday = shiftDay(-1)
const tomorrow = shiftDay(1)
let nt, host, root

function Sheets() {
  const sheets = useUI(s => s.sheets)
  return sheets.map(s => <div key={s.id} data-sheet="">{s.render(() => useUI.getState().closeSheet(s.id))}</div>)
}
const mount = async el => { await act(async () => { root.render(<>{el}<Sheets /></>) }); await settle() }
const settle = async (ms = 0) => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, ms)) }) }
const text = () => host.textContent
const button = (label, scope = host) => [...scope.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent).trim() === label)
const click = async el => { await act(async () => { el.click() }); await settle() }
const puts = () => nt.writes().filter(r => r.method === 'PUT')
// The hero's number; null while the target's inputs are still loading.
const kcalLeft = () => host.querySelector('.hero .hero-num')?.textContent ?? null
const sheets = () => [...document.querySelectorAll('[data-sheet]')]
const action = label => button(label, host.querySelector('.act-row'))
// A day on the week strip, by its name (WeekStrip's aria-label leads with the date).
const day = iso => host.querySelector(`.wk-d[aria-label^="${new Date(iso + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}"]`)
// The week starts where yesterday falls in today's week, whichever weekday today is.
const WEEK_START = new Date().getDay() === 1 ? 0 : 1
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
    S: { ...s.S, routines: [], workouts: [], bodyweight: [], dayPlan: {}, week: {}, active: null, checkIn: false, unit: 'kg', weekStart: WEEK_START },
  }))
  useNutrition.getState().reset()
  useDiarySelection.getState().reset()
  useHubSync.getState().reset()
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null })
  resetSyncThrottle()
  navigate.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe('Nutrition holds the diary', () => {
  it('adds the day up: energy left, macros, water, meals and the workout entry', async () => {
    await mount(<FoodHub />)
    // 2200 target − (228 oats + 450 quick) eaten
    expect(kcalLeft()).toBe('1,522')
    expect(text()).toContain('Protein')
    expect(text()).toContain('250 ml / 2,500 ml')
    expect([...host.querySelectorAll('.meal-name')].map(n => n.textContent)).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Snacks'])
    expect(host.querySelectorAll('.meal-kcal')[0].textContent).toBe('228 kcal')
    // A fixed target with "Adjust goal from activity" off: the workout shows, not counted.
    const workout = host.querySelector('.activity-row')
    expect(workout.textContent).toContain('Push A')
    expect(workout.textContent).toContain('Workout (estimate) · Not added to your target')
  })

  it('a workout a wearable covers reads "Covered by" its device', async () => {
    useFake({ activity: { [TODAY]: fixtureActivity(TODAY, 'garmin') }, activitySum: { [TODAY]: fixtureActivitySum(TODAY, 'garmin') } })
    await mount(<FoodHub />)
    expect(host.querySelector('.activity-row').textContent).toContain('Covered by Garmin')
  })

  it('a day that does not load says so and retries, instead of showing an empty day', async () => {
    nt.failNext('GET', `/nt/api/diary/${TODAY}`, 'offline')
    await mount(<FoodHub />)
    expect(host.querySelector('[role="alert"]').textContent).toBe('The diary did not load: no connection.')
    await click(button('Try again'))
    expect(kcalLeft()).toBe('1,522')
  })

  it('the week strip moves the diary to the day before, and Today brings it back', async () => {
    useFake({ days: { [TODAY]: fixtureDay(TODAY), [yesterday]: { ...fixtureDay(yesterday), items: [] } } })
    await mount(<FoodHub />)
    await click(day(yesterday))
    expect(useDiarySelection.getState().day()).toBe(yesterday)
    expect(nt.requests.some(r => r.path === `/nt/api/diary/${yesterday}`)).toBe(true)
    expect(kcalLeft()).toBe('2,200')
    await click(button('Today'))
    expect(kcalLeft()).toBe('1,522')
  })

  // Blocker: nothing is shown or logged for a day that has not happened.
  it('stops at today: a day to come is dimmed and cannot be picked, and nothing logs to it', async () => {
    await mount(<FoodHub />)
    const next = day(tomorrow)
    // Tomorrow may sit in next week's strip; where it is shown it is disabled.
    if (next) expect(next.disabled).toBe(true)
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
    await mount(<FoodHub />)
    expect(kcalLeft()).toBeNull()
    expect(host.querySelector('.hero[role="status"]').textContent).toBe('Loading today')
    slow.release()
    await settle()
    // 2600 learned, training already in it: the 190 kcal workout adds nothing. 2600 − 678.
    expect(kcalLeft()).toBe('1,922')
    expect(text()).not.toContain('from activity')
  })

  it('a fixed target with "Adjust goal from activity" on adds the day\'s activity', async () => {
    useFake({ settings: { ...fixtureSettings(), calorieAdjustFromActivity: true } })
    await mount(<FoodHub />)
    // (2200 + 190) − 678
    expect(kcalLeft()).toBe('1,712')
    expect(text()).toContain('incl. 190 kcal from activity')
    expect(host.querySelector('.activity-row').textContent).not.toContain('Not added')
  })

  it('settings that do not load are an error with a retry, not a 2,000 default', async () => {
    nt.failNext('GET', '/nt/api/settings', { status: 502 })
    await mount(<FoodHub />)
    expect(kcalLeft()).toBeNull()
    expect(host.querySelector('[role="alert"]').textContent).toBe('The diary did not load.')
    await click(button('Try again'))
    expect(kcalLeft()).toBe('1,522')
  })

  it('under wearable_wins a manual activity on a wearable day reads as not counted', async () => {
    const rows = [...fixtureActivity(TODAY, 'garmin'), { id: 42, date: TODAY, name: 'Run', kcal: 300, source: 'manual_form', external_id: null, covered_by: null }]
    useFake({ settings: { ...fixtureSettings(), calorieAdjustFromActivity: true }, activity: { [TODAY]: rows }, activitySum: { [TODAY]: fixtureActivitySum(TODAY, 'garmin') } })
    await mount(<FoodHub />)
    const [workout, run] = host.querySelectorAll('.activity-row')
    expect(workout.textContent).toContain('Covered by Garmin')
    expect(run.textContent).toContain('Not counted: your wearable reports this day')
  })

  it('hides the activity rows with NutriTrace\'s activity section off', async () => {
    useFake({ settings: { ...fixtureSettings(), diaryShowActivity: false } })
    await mount(<FoodHub />)
    expect(kcalLeft()).toBe('1,522')
    expect(host.querySelector('.activity-row')).toBeNull()
  })

  it('the water row\'s +250 ml (a person with no water containers) logs a glass to the shown day, with Undo', async () => {
    await mount(<FoodHub />)
    await click(button('Add a glass of water, 250 ml', host.querySelector('.water-card')))
    expect(puts()).toHaveLength(1)
    expect(puts()[0].body.water.map(w => w.amount)).toEqual([250, 250])
    expect(text()).toContain('500 ml / 2,500 ml')
    expect(useUI.getState().toastMsg).toBe('Water added')
    await act(async () => { useUI.getState().runToastAction() })
    await settle()
    expect(text()).toContain('250 ml / 2,500 ml')
  })

  it('a glass whose answer was lost is counted once when tapped again', async () => {
    await mount(<FoodHub />)
    nt.failNext('PUT', '/nt/api/diary/', { lost: true, status: 504 })
    await click(button('Add a glass of water, 250 ml'))
    expect(useUI.getState().toastMsg).toBe('Not saved. Try again.')
    await click(button('Add a glass of water, 250 ml'))
    expect(nt.state.days[TODAY].water.map(w => w.amount)).toEqual([250, 250])
  })

  it('a meal\'s + opens the picker under it: recents, then your foods and online results', async () => {
    await mount(<FoodHub />)
    await click(button('Add to Lunch'))
    const picker = host.querySelector('.meal-picker')
    expect([...picker.querySelectorAll('.food-row .tt')].map(n => n.textContent)).toEqual(['Create food', 'Rolled oats', 'Wholemeal bread', 'Oats and bread', 'Lentil soup', 'Crème fraîche', 'Quick kcal'])
    await typeInto(picker.querySelector('input'), 'nut')
    await settle(150)
    await vi.waitFor(() => expect(picker.textContent).toContain('Nutella'), { timeout: 2000 })
    expect(picker.textContent).toContain('None of your foods match.')
    const search = nt.requests.find(r => r.path === '/nt/api/proxy')
    expect(new URL(search.query.url).searchParams.get('q')).toBe('nut')
  })

  it('tapping a logged entry opens its edit sheet', async () => {
    await mount(<FoodHub />)
    await click(host.querySelector('.meal-toggle'))
    await click(button('Edit Rolled oats, 60 g, 228 kcal'))
    expect(sheets()).toHaveLength(1)
    expect(button('Save', sheets()[0])).toBeTruthy()
    expect(button('Remove Rolled oats', sheets()[0])).toBeTruthy()
  })

  it('a past day is shown and written to: its numbers, and water logged to it', async () => {
    useFake({ days: { [TODAY]: fixtureDay(TODAY), [yesterday]: { ...fixtureDay(yesterday), items: [fixtureDay(yesterday).items[0]] } } })
    act(() => useDiarySelection.getState().setDate(yesterday))
    await mount(<FoodHub />)
    expect(kcalLeft()).toBe('1,972')
    expect([...host.querySelectorAll('.sec-h-t')].map(h => h.textContent)).toEqual(['Macros', 'Diary', 'Library'])
    await click(action('Add a glass of water, 250 ml'))
    expect(puts().map(p => p.path)).toEqual([`/nt/api/diary/${yesterday}`])
  })
})

describe('the action row', () => {
  it('is Log food, Scan, Saved meals and +250 ml, all outlined', async () => {
    await mount(<FoodHub />)
    const row = host.querySelector('.act-row')
    expect([...row.querySelectorAll('.act-l')].map(l => l.textContent)).toEqual(['Log food', 'Scan', 'Saved meals', '+250 ml'])
    // No filled primary (Owner decision 7): every disc is the same outlined one.
    expect([...row.querySelectorAll('.act-b')].every(b => b.className === 'act-b')).toBe(true)
  })

  it('Log food opens the food picker for the shown day', async () => {
    await mount(<FoodHub />)
    await click(action('Log food'))
    expect(sheets()).toHaveLength(1)
    expect(sheets()[0].querySelector('.food-picker-sheet')).not.toBeNull()
    expect(sheets()[0].textContent).toContain('Log food')
  })

  it('Scan opens the barcode scanner', async () => {
    await mount(<FoodHub />)
    await click(action('Scan'))
    expect(sheets()).toHaveLength(1)
    expect(sheets()[0].querySelector('.scan-sheet').textContent).toContain('Scan a barcode')
  })

  it('Saved meals opens the Saved meals page', async () => {
    await mount(<FoodHub />)
    await click(action('Saved meals'))
    expect(navigate).toHaveBeenCalledWith('/food/meals')
  })

  it('+250 ml logs a glass to the shown day, with Undo', async () => {
    await mount(<FoodHub />)
    await click(action('Add a glass of water, 250 ml'))
    expect(puts()).toHaveLength(1)
    expect(puts()[0].body.water.map(w => w.amount)).toEqual([250, 250])
    expect(text()).toContain('500 ml / 2,500 ml')
    expect(useUI.getState().toastMsg).toBe('Water added')
  })
})
