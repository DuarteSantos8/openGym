// @vitest-environment happy-dom
// Home as the hub (ux-redesign-tabs §1) and the + sheet's logging rows, against NutriTrace faked
// at the fetch boundary (lib/nutrition/fake-nutritrace.js: NutriTrace's real shapes, merge and
// the hub's rules). The diary itself is Nutrition's (FoodHub.diary.test.jsx).
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { fmtDate, todayISO, isoOf } from '../lib/format.js'
import { dateLocale } from '../lib/i18n.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useDiarySelection } from '../lib/nutrition/selection.js'
import { useHubSync, resetSyncThrottle } from '../lib/nutrition/sync.js'
import { createFakeNutriTrace, emptyDay, fixtureActivity, fixtureActivitySum, fixtureDay, fixtureFoods, fixtureSettings, fixtureSyncStatus } from '../lib/nutrition/fake-nutritrace.js'
import { workoutKcalMessage, reportWorkoutKcal } from '../lib/nutrition/workout-kcal.js'
import Home from './Home.jsx'
import DayNav from '../components/DayNav.jsx'
import PortionSheet from '../components/PortionSheet.jsx'
import QuickKcalSheet from '../components/QuickKcalSheet.jsx'
import AvatarButton from '../components/AvatarButton.jsx'
import { openPlusSheet } from '../components/PlusSheet.jsx'
import { bwSheet, calendarSheet } from '../sheets.jsx'
import { weighInTime } from '../lib/bodyweight.js'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate, useLocation: () => ({ pathname: '/home' }) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const TODAY = todayISO()
const shiftDay = n => { const d = new Date(); d.setDate(d.getDate() + n); return isoOf(d) }
const yesterday = shiftDay(-1)
const tomorrow = shiftDay(1)
// The week starts where yesterday falls in today's week, whichever weekday today is.
const WEEK_START = new Date().getDay() === 1 ? 0 : 1
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
// The hub's parts.
const actions = () => [...host.querySelectorAll('.act-b')].map(b => b.querySelector('.act-l').textContent)
const action = label => [...host.querySelectorAll('.act-b')].find(b => b.querySelector('.act-l').textContent === label)
const metric = i => {
  const m = host.querySelectorAll('.hero-mi')[i]
  return { value: m.querySelector('.hero-num').textContent, unit: m.querySelector('.hero-u')?.textContent ?? null, label: m.querySelector('.hero-ml').textContent, sub: m.querySelector('.hero-ms')?.textContent ?? null }
}
const pills = () => [...host.querySelectorAll('.meal-pills .chip')]
// A day on the week strip, by its name (WeekStrip's aria-label leads with the date).
const day = iso => host.querySelector(`.wk-d[aria-label^="${new Date(iso + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}"]`)

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
  navigate.mockClear()
  localStorage.clear()
  useStore.setState(s => ({
    user: { id: 3, name: 'Ana' },
    pushState: vi.fn(async () => {}),
    S: { ...s.S, routines: [], workouts: [], bodyweight: [{ d: yesterday, w: 80.4, t: 1 }], dayPlan: {}, week: {}, active: null, checkIn: false, unit: 'kg', weekStart: WEEK_START },
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

describe('Home is the hub', () => {
  it('the hero says how the day is going: kcal left with what was eaten, water against its goal, protein, carbs and fat', async () => {
    await mount(<Home />)
    // 2200 target − (228 oats + 450 quick) eaten
    expect(metric(0)).toEqual({ value: '1,522', unit: null, label: 'kcal left', sub: '678 kcal eaten' })
    expect(metric(1)).toEqual({ value: '250', unit: 'ml', label: 'Water', sub: 'of 2,500 ml' })
    expect(host.querySelector('.hero-macros').textContent).toBe('Protein 8/160 gCarbs 36/165 gFat 4/70 g')
    // The diary itself is on Nutrition.
    expect(host.querySelector('.kcal-card')).toBeNull()
    expect(host.querySelector('.water-card')).toBeNull()
    expect(host.querySelector('.meal-row')).toBeNull()
  })

  it('over the target the first number is what is over', async () => {
    nt.state.days[TODAY].items.push({ uuid: 'big', meal: 2, addedAt: `${TODAY}T19:00:00.000Z`, type: 'quick_calories', name: 'Quick Calories', nutrition: { calories: 2000 }, food_server_id: null })
    await mount(<Home />)
    expect(metric(0)).toMatchObject({ value: '478', label: 'kcal over', sub: '2,678 kcal eaten' })
  })

  it('a day that does not load says so on the hero and retries, never showing numbers it does not have', async () => {
    nt.failNext('GET', `/nt/api/diary/${TODAY}`, 'offline')
    await mount(<Home />)
    expect(host.querySelector('.hero [role="alert"]').textContent).toBe('The diary did not load: no connection.')
    expect(metric(0).value).toBe('–')
    expect(metric(1).value).toBe('–')
    await click(button('Try again'))
    expect(metric(0).value).toBe('1,522')
  })

  it('the action row on a day with nothing planned: Workout, Log food, +250 ml, then Scan with gym check-in off', async () => {
    await mount(<Home />)
    expect(actions()).toEqual(['Workout', 'Log food', '+250 ml', 'Scan'])
    // None of them is filled: the + is the one accent disc (Owner decision 7).
    expect(host.querySelectorAll('.act-b.primary, .act-d.primary')).toHaveLength(0)
    await click(action('Workout'))
    expect(navigate).toHaveBeenCalledWith('/train/workout')
    await click(action('Scan'))
    expect(lastSheet().querySelector('.scan-sheet h3').textContent).toBe('Scan a barcode')
  })

  it('with gym check-in on, the fourth is Check in and opens the cards', async () => {
    useStore.setState(s => ({ S: { ...s.S, checkIn: true } }))
    await mount(<Home />)
    expect(actions()).toEqual(['Workout', 'Log food', '+250 ml', 'Check in'])
    await click(action('Check in'))
    expect(navigate).toHaveBeenCalledWith('/train/checkin')
  })

  it('+250 ml logs a glass to the selected day, with Undo', async () => {
    await mount(<Home />)
    await click(button('Add a glass of water, 250 ml'))
    expect(puts()).toHaveLength(1)
    expect(puts()[0].body.water.map(w => w.amount)).toEqual([250, 250])
    expect(metric(1).value).toBe('500')
    expect(useUI.getState().toastMsg).toBe('Water added')
    await act(async () => { useUI.getState().runToastAction() })
    await settle()
    expect(metric(1).value).toBe('250')
  })

  it('Log food opens the picker for the selected day and the meal of the hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${TODAY}T12:10:00`))
    try {
      await mount(<Home />)
      await click(action('Log food'))
      expect(lastSheet().querySelector('.food-picker-sheet .logging-to').textContent).toBe('Logging toToday · Lunch')
    } finally { vi.useRealTimers() }
  })

  it('the day\'s meals as pills: energy where there is food, a + where there is none; a pill logs to its meal', async () => {
    await mount(<Home />)
    expect(host.querySelector('.sec-h-t').textContent).toBe('Today’s food')
    expect(pills().map(p => p.textContent)).toEqual(['Breakfast228', 'Lunch450', 'Dinner', 'Snacks'])
    expect(pills()[2].querySelector('[data-icon="plus"]')).toBeTruthy()
    // WCAG 2.5.3: the name holds the visible words, "Breakfast 228", in that order.
    expect(pills()[0].getAttribute('aria-label')).toBe('Breakfast 228 kcal, Log food')
    expect(pills()[1].getAttribute('aria-label')).toMatch(/^Lunch 450\b/)
    expect(pills()[2].getAttribute('aria-label')).toBe('Log food to Dinner')
    await click(pills()[2])
    expect(lastSheet().querySelector('.logging-to').textContent).toBe('Logging toToday · Dinner')
  })

  it('Diary opens the whole day on Nutrition', async () => {
    await mount(<Home />)
    await click(button('Diary'))
    expect(navigate).toHaveBeenCalledWith('/food')
  })

  it('a day before today: eaten against its target, Log workout first and Weigh in for that day last', async () => {
    useFake({ days: { [TODAY]: fixtureDay(TODAY), [yesterday]: { ...fixtureDay(yesterday), items: [] } } })
    await mount(<Home />)
    await click(day(yesterday))
    expect(useDiarySelection.getState().day()).toBe(yesterday)
    expect(nt.requests.some(r => r.path === `/nt/api/diary/${yesterday}`)).toBe(true)
    expect(host.querySelector('.hero-e').textContent).toBe(fmtDate(yesterday, true))
    expect(host.querySelector('.hero-t').textContent).toBe('Rest day')
    expect(metric(0)).toEqual({ value: '0', unit: 'kcal', label: 'Eaten', sub: 'of 2,200 kcal' })
    expect(host.querySelector('.sec-h-t').textContent).toBe('Food')
    expect(actions()).toEqual(['Log workout', 'Log food', '+250 ml', 'Weigh in'])
    await click(action('Weigh in'))
    expect(lastSheet().textContent).toContain(fmtDate(yesterday, true))
    await act(async () => { useUI.setState({ sheets: [] }) })
    await click(action('Log workout'))
    expect(lastSheet().querySelector('input[type="date"]').value).toBe(yesterday)
    await act(async () => { useUI.setState({ sheets: [] }) })
    await click(button('Today'))
    expect(useDiarySelection.getState().day()).toBe(TODAY)
    expect(actions()[3]).toBe('Scan')
  })

  it('a day to come is never the date: tapping it opens "change this day" for that day', async () => {
    await mount(<Home />)
    // Tomorrow is in this week's strip unless today ends the week; then the week after shows it.
    if (!day(tomorrow)) {
      const days = host.querySelectorAll('.wk-d')
      await act(async () => { days[6].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
      await settle()
    }
    expect(day(tomorrow).disabled).toBe(false)
    await click(day(tomorrow))
    expect(useDiarySelection.getState().day()).toBe(TODAY)
    expect(lastSheet().querySelector('h3').textContent).toBe(fmtDate(tomorrow, true))
    // A screen reader is told which day it opened.
    expect(host.querySelector('[role="status"].sr-only').textContent).toBe('Change this day, ' + fmtDate(tomorrow, true))
  })

  // The month's calendar disables days to come for a date picker; on Home and Training they open
  // "change this day" instead, on Nutrition they stay dimmed.
  const calendarDay = iso => {
    const cell = [...lastSheet().querySelectorAll('.cal-d')].find(b => b.textContent === String(Number(iso.slice(-2))))
    return cell
  }
  const openCalendar = async iso => {
    await click(host.querySelector('.month-bar-l'))
    if (iso.slice(0, 7) !== TODAY.slice(0, 7)) await click(button('Next month', lastSheet()))
  }

  it('a day to come in the calendar opens "change this day" for it and leaves the date, announced', async () => {
    await mount(<Home />)
    await openCalendar(tomorrow)
    expect(calendarDay(tomorrow).disabled).toBe(false)
    await click(calendarDay(tomorrow))
    expect(useDiarySelection.getState().day()).toBe(TODAY)
    expect(lastSheet().querySelector('h3').textContent).toBe(fmtDate(tomorrow, true))
    expect(host.querySelector('[role="status"].sr-only').textContent).toBe('Change this day, ' + fmtDate(tomorrow, true))
    // Days up to today still pick the date.
    await act(async () => { useUI.setState({ sheets: [] }) })
    if (yesterday.slice(0, 7) === TODAY.slice(0, 7)) {
      await openCalendar(yesterday)
      await click(calendarDay(yesterday))
      expect(useDiarySelection.getState().day()).toBe(yesterday)
    }
  })

  it('on Nutrition a day to come stays dimmed in the calendar', async () => {
    await mount(<DayNav future="off" />)
    await openCalendar(tomorrow)
    expect(calendarDay(tomorrow).disabled).toBe(true)
    expect(host.querySelector('[role="status"]')).toBeNull()
  })

  it('on first run the hero says the numbers count from the first log, and stops once there is one', async () => {
    useFake({ days: { [TODAY]: emptyDay(TODAY) } })
    await mount(<Home />)
    expect(text()).toContain('Counts from your first log')
    expect(pills().every(p => p.querySelector('[data-icon="plus"]'))).toBe(true)
    await click(button('Add a glass of water, 250 ml'))
    expect(text()).not.toContain('Counts from your first log')
    // Gone for good, even on a day that is empty again.
    await act(async () => { useUI.getState().runToastAction() })
    await settle()
    expect(metric(1).value).toBe('0')
    expect(text()).not.toContain('Counts from your first log')
  })

  it('says nothing about a first log to someone whose diary has food', async () => {
    await mount(<Home />)
    expect(text()).not.toContain('Counts from your first log')
  })

  it('an existing user with an empty today but yesterday logged never sees the first-run line, and it stays gone', async () => {
    useFake({ days: { [TODAY]: emptyDay(TODAY), [yesterday]: fixtureDay(yesterday) } })
    await mount(<Home />)
    expect(text()).not.toContain('Counts from your first log')
    expect(localStorage.getItem('gains.diaryLogged')).toBe('1')
  })

  it('offers yesterday\'s meal again while today\'s is empty, and the row goes once it is logged', async () => {
    useFake({ days: { [TODAY]: emptyDay(TODAY), [yesterday]: fixtureDay(yesterday) } })
    useDiarySelection.getState().setMeal(0)
    await mount(<Home />)
    expect(text()).toContain('Yesterday’s Breakfast')
    await click(button('Log again'))
    expect(nt.state.days[TODAY].items.map(i => i.name)).toEqual(['Rolled oats'])
    expect(text()).not.toContain('Yesterday’s Breakfast')
    expect(useUI.getState().toastMsg).toBe('Logged to Breakfast')
  })

  it('does not offer yesterday\'s meal when today\'s already has food', async () => {
    useFake({ days: { [TODAY]: fixtureDay(TODAY), [yesterday]: fixtureDay(yesterday) } })
    useDiarySelection.getState().setMeal(0)
    await mount(<Home />)
    expect(text()).not.toContain('Yesterday’s Breakfast')
  })

  it('without nutrition (a guest, the phone build): the training row, Weigh in, then History or Check in; no food', async () => {
    useStore.setState({ user: null })
    await mount(<Home />)
    expect(actions()).toEqual(['Workout', 'Weigh in', 'History'])
    expect(host.querySelector('.hero-m')).toBeNull()
    expect(host.querySelector('.meal-pills')).toBeNull()
    expect(nt.requests).toHaveLength(0)
    await click(action('History'))
    expect(navigate).toHaveBeenCalledWith('/train/history')
    act(() => useStore.setState(s => ({ S: { ...s.S, checkIn: true } })))
    await settle()
    expect(actions()).toEqual(['Workout', 'Weigh in', 'Check in'])
  })

  // Blocker: nothing is shown or logged for a day that has not happened.
  it('stops at today: no future date, no future log', async () => {
    await mount(<Home />)
    act(() => useDiarySelection.getState().setDate(tomorrow))
    expect(useDiarySelection.getState().day()).toBe(TODAY)
    const before = nt.requests.length
    await expect(useNutrition.getState().logWater(tomorrow, useNutrition.getState().draftWater(250))).rejects.toMatchObject({ code: 'invalid' })
    expect(nt.requests.length).toBe(before)
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
    // A tab root has no "Here" rows of its own.
    expect(sheet.querySelectorAll('.sect')).toHaveLength(1)
    expect(button('Log food', sheet)).toBeTruthy()
    expect(button('Scan', sheet)).toBeTruthy()
    vi.useRealTimers()
  })

  it('with a day before today picked, offers to log a workout to it, from any screen', async () => {
    useDiarySelection.getState().setDate(yesterday)
    await useNutrition.getState().loadSettings()
    await mount(<></>)
    await act(async () => { openPlusSheet('/home') })
    await settle()
    const here = lastSheet().querySelector('.sect')
    expect(here.querySelector('.sect-t').textContent).toBe('Here')
    expect(here.querySelector('.lrow-t').textContent).toBe('Log workout for ' + fmtDate(yesterday, true))
    await click(here.querySelector('.lrow'))
    expect(lastSheet().querySelector('input[type="date"]').value).toBe(yesterday)
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
  it('a weigh-in pushes Gains, then asks the hub to sync now', async () => {
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

describe('the calendar as the date picker', () => {
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

  it('the month on Home opens it, and the day picked there is the date', async () => {
    await mount(<Home />)
    await click(host.querySelector('.month-bar-l'))
    const cell = [...lastSheet().querySelectorAll('.cal-d')].find(b => b.textContent === String(Number(yesterday.slice(-2))))
    // Yesterday is in last month on the 1st; the calendar opened on this one.
    if (yesterday.slice(0, 7) !== TODAY.slice(0, 7)) return
    await click(cell)
    expect(useDiarySelection.getState().day()).toBe(yesterday)
  })
})
