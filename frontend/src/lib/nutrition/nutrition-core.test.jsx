// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../../store/useStore.js'
import { NtApi, HubSync } from './api.js'
import { useNutrition } from './store.js'
import { useDiarySelection, useDiaryTarget, MEAL_PICK_MS } from './selection.js'
import { syncNow, useHubSync, workoutSyncRow, resetSyncThrottle, refreshHubStatus, SYNC_MIN_INTERVAL_MS } from './sync.js'
import { offResults, offSearchUrl } from './off.js'
import { atPortion, calorieTarget, defaultMeal, energyOf, macroTarget, mealItems, mealsOf, recentFoods, matchesFood, totalsOf, waterOf, waterTotal } from './diary.js'
import { createFakeNutriTrace, fixtureActivity, fixtureActivitySum, fixtureDay, fixtureFoods, fixtureOffSearch, fixtureSettings, fixtureSyncStatus } from './fake-nutritrace.js'

const DAY = '2026-10-14'
let nt
const n = () => useNutrition.getState()
const serverItems = () => nt.state.days[DAY].items
const cachedUuids = () => n().days[DAY].entry.items.map(i => i.uuid)
const bread = () => ({ ...fixtureFoods()[1], imgUrl: '' })

function useFake(opts) {
  nt = createFakeNutriTrace(opts)
  vi.stubGlobal('fetch', nt.fetch)
}

beforeEach(() => {
  useFake({ days: { [DAY]: fixtureDay(DAY) }, activity: { [DAY]: fixtureActivity(DAY) }, activitySum: { [DAY]: fixtureActivitySum(DAY) } })
  useStore.setState({ user: { id: 3, name: 'Ana' }, pushState: vi.fn(async () => {}) })
  n().reset()
  useDiarySelection.getState().reset()
  useHubSync.getState().reset()
  resetSyncThrottle()
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('NutriTrace client', () => {
  it('reaches NutriTrace through /nt/api on the same origin', async () => {
    const day = await NtApi.getDiaryDate(DAY)
    expect(nt.requests[0]).toMatchObject({ method: 'GET', path: `/nt/api/diary/${DAY}` })
    expect(day.items).toHaveLength(2)
    expect(day.tombstones).toEqual([])
  })

  it('throws an error with the status and code the caller branches on', async () => {
    nt.failNext('GET', '/nt/api/settings', { status: 502, error: 'upstream unavailable' })
    await expect(NtApi.getSettings()).rejects.toMatchObject({ status: 502, code: 'http' })
    nt.failNext('GET', '/nt/api/settings', 'offline')
    await expect(NtApi.getSettings()).rejects.toMatchObject({ status: 0, code: 'offline' })
  })

  it('saves a food as private and without an image, as the hub requires', async () => {
    const [nutella] = offResults(fixtureOffSearch())
    const made = await NtApi.createFood({ ...nutella, visibility: 'group', img_url: 'data:image/png;base64,AA' })
    expect(nt.writes()[0].body).toMatchObject({ visibility: 'private' })
    expect(nt.writes()[0].body).not.toHaveProperty('img_url')
    expect(nt.writes()[0].body).not.toHaveProperty('imgUrl')
    expect(made.id).toBeGreaterThan(13)
  })

  it('builds the one proxy URL the hub forwards, and the fake refuses any other', async () => {
    const url = new URL(offSearchUrl('greek yoghurt', { lang: 'de', pageSize: 500 }))
    expect(url.origin + url.pathname).toBe('https://search.openfoodfacts.org/search')
    expect([...url.searchParams.keys()].sort()).toEqual(['langs', 'page', 'page_size', 'q'])
    expect(url.searchParams.get('page_size')).toBe('50')
    await expect(NtApi.searchOnline('   ')).rejects.toMatchObject({ status: 403 })
    await expect(NtApi.searchOnline('milk')).resolves.toMatchObject({ count: 2 })
  })

  it('stops a search when its signal aborts', async () => {
    const ctl = new AbortController()
    const slow = nt.hold('GET', '/nt/api/proxy')
    const p = n().searchOnline('milk', 'en', { signal: ctl.signal })
    ctl.abort()
    slow.release()
    await expect(p).rejects.toMatchObject({ code: 'aborted' })
  })

  it('takes the hub\'s null status for a person it has not stored yet', async () => {
    useFake({ syncStatus: null })
    await expect(HubSync.status()).resolves.toBeNull()
    await expect(refreshHubStatus()).resolves.toBeNull()
    expect(useHubSync.getState().status).toBeNull()
  })
})

describe('the diary store', () => {
  it('loads a day and adds it up as NutriTrace does', async () => {
    await n().loadDay(DAY)
    const entry = n().days[DAY].entry
    expect(totalsOf(entry.items)).toEqual({ calories: 678, proteins: 8.1, carbohydrates: 36, fat: 4.2 })
    expect(mealItems(entry, 1).map(i => i.name)).toEqual(['Quick Calories'])
    expect(waterTotal(entry)).toBe(250)
  })

  it('a failed load is an error state, not an empty day', async () => {
    nt.failNext('GET', '/nt/api/diary/', 'offline')
    await n().loadDay(DAY)
    expect(n().days[DAY]).toMatchObject({ status: 'error', error: { code: 'offline' } })
  })

  it('logs a food by household unit, keeping the day in log order', async () => {
    const item = await n().logFood(DAY, n().draftFood({ food: bread(), meal: 0, portion: 2, unit: 'slice', servings: 1 }))
    const put = nt.writes().find(r => r.method === 'PUT')
    expect(put.body).not.toHaveProperty('body_stats')
    expect(put.body).not.toHaveProperty('notes')
    expect(Math.round(item.nutrition.calories)).toBe(178)
    expect(item).toMatchObject({ meal: 0, quantity: 1, portion: 2, unit: 'slice', id: 12, food_server_id: 12 })
    expect(item).not.toHaveProperty('alt_units')
    expect(serverItems().map(i => i.uuid)).toEqual(['it-oats', 'it-quick', item.uuid])
    expect(cachedUuids()).toEqual(['it-oats', 'it-quick', item.uuid])
    expect(nt.requests.some(r => r.method === 'POST' && r.path === '/nt/api/foods/12/used' && r.body.date === DAY)).toBe(true)
  })

  it('refuses servings of 0, a bad portion and water that is not a positive number', () => {
    expect(() => n().draftFood({ food: bread(), meal: 0, portion: 50, unit: 'g', servings: 0 })).toThrow(expect.objectContaining({ code: 'invalid' }))
    expect(() => n().draftFood({ food: bread(), meal: 0, portion: -1, unit: 'g', servings: 1 })).toThrow(expect.objectContaining({ code: 'invalid' }))
    for (const ml of [0, -250, NaN, Infinity, '250ml']) expect(() => n().draftWater(ml)).toThrow(expect.objectContaining({ code: 'invalid' }))
    expect(() => n().draftQuick({ kcal: 0, meal: 1 })).toThrow(expect.objectContaining({ code: 'invalid' }))
  })

  // Blocker 1: a write that lands but whose answer is lost must not log twice on the retry.
  it.each([
    ['a lost answer (504)', { lost: true, status: 504 }],
    ['a lost connection after the save', { lost: true }],
  ])('a retry after %s logs the food once', async (_label, how) => {
    const [nutella] = offResults(fixtureOffSearch())
    const draft = n().draftFood({ food: nutella, meal: 2, portion: 15, unit: 'g', servings: 1 })
    nt.failNext('PUT', '/nt/api/diary/', how)
    await expect(n().logFood(DAY, draft)).rejects.toBeTruthy()
    expect(serverItems().filter(i => i.name === 'Nutella')).toHaveLength(1)
    await n().logFood(DAY, draft)
    expect(serverItems().filter(i => i.name === 'Nutella')).toHaveLength(1)
    expect(nt.state.foods.filter(f => f.name === 'Nutella')).toHaveLength(1)
    expect(Math.round(serverItems().at(-1).nutrition.calories)).toBe(81)
  })

  it('a retried quick kcal and water entry are logged once', async () => {
    const quick = n().draftQuick({ kcal: '320', proteins: 20, meal: 3 })
    const water = n().draftWater(250)
    nt.failNext('PUT', '/nt/api/diary/', { lost: true, status: 502 })
    await expect(n().logQuick(DAY, quick)).rejects.toBeTruthy()
    await n().logQuick(DAY, quick)
    nt.failNext('PUT', '/nt/api/diary/', { lost: true })
    await expect(n().logWater(DAY, water)).rejects.toBeTruthy()
    await n().logWater(DAY, water)
    expect(serverItems().filter(i => i.uuid === quick.uuid)).toHaveLength(1)
    expect(waterTotal(nt.state.days[DAY])).toBe(500)
  })

  // Blocker 2: answers that arrive out of order.
  it('two writes answering in reverse order keep both items', async () => {
    await n().loadDay(DAY)
    const a = n().draftQuick({ kcal: 100, meal: 0 })
    const b = n().draftQuick({ kcal: 200, meal: 0 })
    const slow = nt.hold('PUT', '/nt/api/diary/')
    const first = n().logQuick(DAY, a)
    await vi.waitFor(() => expect(nt.writes()).toHaveLength(1))
    await n().logQuick(DAY, b)
    slow.release()
    await first
    await vi.waitFor(() => expect(cachedUuids()).toEqual(expect.arrayContaining([a.uuid, b.uuid])))
  })

  it('a load in flight does not hide a log that just landed', async () => {
    await n().loadDay(DAY)
    const slow = nt.hold('GET', '/nt/api/diary/')
    const reload = n().loadDay(DAY, { force: true })
    const quick = n().draftQuick({ kcal: 300, meal: 1 })
    await n().logQuick(DAY, quick)
    slow.release()
    await reload
    expect(cachedUuids()).toContain(quick.uuid)
  })

  // Blocker 3: the next account never sees the last one's day.
  it('a load in flight when the account changes does not land in the next account', async () => {
    const slow = nt.hold('GET', '/nt/api/diary/')
    const load = n().loadDay(DAY)
    useHubSync.setState({ status: fixtureSyncStatus('error') })
    useDiarySelection.getState().setDate('2026-10-01')
    useStore.setState({ user: { id: 4, name: 'Bo' } })
    slow.release()
    await load
    expect(n().days).toEqual({})
    expect(useDiarySelection.getState().date).toBeNull()
    expect(useHubSync.getState().status).toBeNull()
  })

  it('undo removes the entry and NutriTrace keeps its tombstone', async () => {
    const quick = await n().logQuick(DAY, n().draftQuick({ kcal: 320, meal: 3 }))
    const day = await n().removeItem(DAY, quick.uuid)
    expect(day.items.some(i => i.uuid === quick.uuid)).toBe(false)
    expect(day.tombstones).toEqual([expect.objectContaining({ kind: 'item', uuid: quick.uuid })])
    // A stale resend of the removed entry does not bring it back.
    await NtApi.saveDiaryDate(DAY, { items: [quick], water: [], deleted_uuids: { items: [], water: [] } })
    expect(serverItems().some(i => i.uuid === quick.uuid)).toBe(false)
  })

  it('reads activity rows with their coverage', async () => {
    useFake({ activity: { [DAY]: fixtureActivity(DAY, 'garmin') }, activitySum: { [DAY]: fixtureActivitySum(DAY, 'garmin') } })
    await n().loadActivity(DAY, 'wearable_wins')
    expect(n().activity[DAY].rows[0]).toMatchObject({ source: 'opengym', covered_by: 'garmin' })
    expect(n().activity[DAY].sum.covered_by).toBe('garmin')
  })

  it('does not keep a failed goal input; the next call asks again', async () => {
    nt.failNext('GET', '/nt/api/wellness/calories-out', 'offline')
    await n().loadGoalInputs(DAY, 'dynamic')
    expect(DAY in n().goalInputs).toBe(false)
    nt.state.caloriesOut[DAY] = 2600
    await n().loadGoalInputs(DAY, 'dynamic')
    expect(n().caloriesOut(DAY)).toBe(2600)
  })

  it('marks logged days for the visible range only, never past today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-20T10:00:00'))
    useFake({ days: { [DAY]: fixtureDay(DAY), '2026-10-02': fixtureDay('2026-10-02'), '2025-01-01': fixtureDay('2025-01-01') } })
    await n().loadLogged('2026-10-01', '2026-10-31')
    expect([...n().logged.days].sort()).toEqual(['2026-10-02', DAY])
    expect(nt.requests.every(r => /^\/nt\/api\/diary\/2026-10-(0\d|1\d|20)$/.test(r.path))).toBe(true)
    expect(nt.requests).toHaveLength(20)
    await n().loadLogged('2026-10-01', '2026-10-31')
    expect(nt.requests).toHaveLength(20)
  })

  it('an aborted range read stops and leaves the days it did not reach alone', async () => {
    const ctl = new AbortController()
    ctl.abort()
    await n().loadLogged('2026-10-01', '2026-10-10', { signal: ctl.signal })
    expect(nt.requests).toHaveLength(0)
    expect(n().days).toEqual({})
  })

  it('refuses to log to a day after today', async () => {
    const later = '2999-01-01'
    await expect(n().logQuick(later, n().draftQuick({ kcal: 100, meal: 0 }))).rejects.toMatchObject({ code: 'invalid' })
    useDiarySelection.getState().setDate(later)
    expect(useDiarySelection.getState().date).toBeNull()
    expect(nt.requests).toHaveLength(0)
  })
})

describe('diary arithmetic', () => {
  const settings = fixtureSettings()

  it('scales by grams, by household unit and by plain ratio', () => {
    expect(Math.round(atPortion(bread(), 50, 'g').nutrition.calories)).toBe(124)
    expect(Math.round(atPortion(bread(), 1, 'slice').nutrition.calories)).toBe(89)
    expect(Math.round(atPortion({ ...bread(), portion: 1, unit: 'piece' }, 2, 'piece').nutrition.calories)).toBe(494)
  })

  it('computes the target per mode, activity added only to a fixed target with the opt-in', () => {
    expect(calorieTarget({ settings, date: DAY, effectiveActive: 190 })).toMatchObject({ target: 2200, added: 0, adjust: false })
    const optIn = { ...settings, calorieAdjustFromActivity: true }
    expect(calorieTarget({ settings: optIn, date: DAY, effectiveActive: 190 })).toMatchObject({ target: 2390, added: 190 })
    const adaptive = { ...optIn, calorieGoalMode: 'adaptive', calorieGoalFactor: 0.8 }
    expect(calorieTarget({ settings: adaptive, date: DAY, adaptiveTdee: 2600, effectiveActive: 190 })).toMatchObject({ target: 2080, fromBurn: true, added: 0 })
    expect(calorieTarget({ settings: adaptive, date: DAY, adaptiveTdee: null, effectiveActive: 190 })).toMatchObject({ target: 2390, fromBurn: false })
  })

  it('converts percentage macro goals with NutriTrace\'s densities', () => {
    const goals = { ...settings.goals, 'saturated-fat': { max: 10, isPercent: true }, sugars: { max: 10, isPercent: true } }
    expect(macroTarget({ goals }, 'carbohydrates', DAY, 2200)).toBe(165)
    expect(macroTarget({ goals }, 'proteins', DAY, 2200)).toBe(160)
    expect(macroTarget({ goals }, 'saturated-fat', DAY, 1800)).toBe(20)
    expect(macroTarget({ goals }, 'sugars', DAY, 1800)).toBe(45)
  })

  it('shows energy and water in the person\'s units', () => {
    expect(energyOf(500, { energyUnit: 'kJ' })).toEqual({ value: 2092, unit: 'kJ' })
    expect(energyOf(500, {})).toEqual({ value: 500, unit: 'kcal' })
    expect(waterOf(500, { waterUnit: 'oz' })).toEqual({ value: 17, unit: 'fl oz' })
    expect(waterOf(2500, { waterUnit: 'L' })).toEqual({ value: 2.5, unit: 'L' })
    expect(waterOf(250, {})).toEqual({ value: 250, unit: 'ml' })
  })

  it('tells NutriTrace\'s default meal names from saved ones', () => {
    expect(mealsOf({})[0]).toEqual({ slot: 0, name: 'Breakfast', isDefault: true })
    expect(mealsOf({ mealNames: ['Breakfast', 'Pre-workout'] })).toEqual([
      { slot: 0, name: 'Breakfast', isDefault: false }, { slot: 1, name: 'Pre-workout', isDefault: false },
    ])
  })

  it('picks the meal whose time is nearest, never a meal without a time', () => {
    const at = h => new Date(2026, 9, 14, h, 0)
    expect(defaultMeal(settings, at(6))).toBe(0)
    expect(defaultMeal(settings, at(11))).toBe(1)
    expect(defaultMeal(settings, at(16))).toBe(2)
    expect(defaultMeal(settings, at(23))).toBe(2)
    expect(defaultMeal({ ...settings, notifMealTimes: ['07:00', '13:00', '19:00', '22:00'] }, at(23))).toBe(3)
  })

  it('orders recents by last use and searches accents aside', () => {
    expect(recentFoods(fixtureFoods()).map(f => f.id)).toEqual([11, 12])
    expect(fixtureFoods().filter(f => matchesFood(f, 'creme')).map(f => f.id)).toEqual([13])
  })

  it('maps Open Food Facts hits per 100 g and drops unusable ones', () => {
    const foods = offResults(fixtureOffSearch())
    expect(foods).toHaveLength(1)
    expect(foods[0]).toMatchObject({ name: 'Nutella', brand: 'Ferrero', barcode: '3017620422003', portion: 100, unit: 'g', nutrition: { calories: 539, proteins: 6.3, fat: 30.9 } })
    expect(foods[0].nutrition.sodium).toBe(42.8)
    expect(foods[0].client_key).toBeTruthy()
  })
})

describe('date and meal selection', () => {
  it('a picked meal holds for a while, a picked date clears it', () => {
    useDiarySelection.getState().setDate('2026-10-01')
    expect(useDiarySelection.getState().day()).toBe('2026-10-01')
    const now = new Date(2026, 9, 14, 12, 0)
    expect(useDiarySelection.getState().mealFor(fixtureSettings(), now)).toBe(1)
    useDiarySelection.getState().setMeal(3, now.getTime())
    expect(useDiarySelection.getState().mealFor(fixtureSettings(), now)).toBe(3)
    expect(useDiarySelection.getState().mealFor(fixtureSettings(), new Date(now.getTime() + MEAL_PICK_MS + 1))).toBe(1)
    useDiarySelection.getState().setDate('2026-10-02')
    expect(useDiarySelection.getState().meal).toBeNull()
  })

  it('useDiaryTarget re-renders on a pick, at midnight and when the clock moves the meal', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(new Date(2026, 9, 14, 23, 59, 40))
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const seen = []
    function Probe() { const t = useDiaryTarget(fixtureSettings()); seen.push(t); return null }
    const host = document.createElement('div')
    const root = createRoot(host)
    act(() => root.render(<Probe />))
    expect(seen.at(-1)).toEqual({ date: '2026-10-14', meal: 2 })
    act(() => useDiarySelection.getState().setMeal(3))
    expect(seen.at(-1).meal).toBe(3)
    act(() => { vi.advanceTimersByTime(60 * 1000) })
    expect(seen.at(-1).date).toBe('2026-10-15')
    act(() => { vi.advanceTimersByTime(MEAL_PICK_MS) })
    expect(seen.at(-1).meal).toBe(0)
    act(() => root.unmount())
  })
})

describe('sync now', () => {
  it('pushes Gains first, then asks the hub, and keeps its status', async () => {
    const order = []
    useStore.setState({ pushState: vi.fn(async () => { order.push('push') }) })
    vi.stubGlobal('fetch', vi.fn((...a) => { order.push('hub'); return nt.fetch(...a) }))
    const status = await syncNow()
    expect(order).toEqual(['push', 'hub'])
    expect(status).toEqual(fixtureSyncStatus())
    expect(useHubSync.getState().status.state).toBe('ok')
  })

  it('coalesces calls: one in flight and any number more make one follow-up run', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const slow = nt.hold('POST', '/hub/api/sync/now')
    const calls = [syncNow(), syncNow(), syncNow(), syncNow()]
    await vi.advanceTimersByTimeAsync(0)
    slow.release()
    await vi.advanceTimersByTimeAsync(SYNC_MIN_INTERVAL_MS + 10)
    await Promise.all(calls)
    expect(nt.requests.filter(r => r.path === '/hub/api/sync/now')).toHaveLength(2)
    // Within the interval of the last run: held back, then one run.
    const later = syncNow()
    await vi.advanceTimersByTimeAsync(1)
    expect(nt.requests.filter(r => r.path === '/hub/api/sync/now')).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(SYNC_MIN_INTERVAL_MS)
    await later
    expect(nt.requests.filter(r => r.path === '/hub/api/sync/now')).toHaveLength(3)
  })

  it('never throws, and does nothing without a session', async () => {
    nt.failNext('POST', '/hub/api/sync/now', 'offline')
    await expect(syncNow()).resolves.toBeNull()
    useStore.setState({ user: null })
    const before = nt.requests.length
    await expect(syncNow()).resolves.toBeNull()
    await expect(workoutSyncRow('abc')).resolves.toBeNull()
    expect(nt.requests.length).toBe(before)
  })
})
