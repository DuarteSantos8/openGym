// @vitest-environment happy-dom
// A search's Day result, end to end on the routed Nutrition root (ux-search.md §4): the result
// opens `/food?date=&find=<uuid>` as a visit of the overlay; Today's diary moves to that day, the
// meal holding the entry opens and the entry flashes; the address is left as the tab's own with
// the visit's state kept, and back on the overlay the day the diary had is put back. NutriTrace is
// faked at the fetch boundary (lib/nutrition/fake-nutritrace.js).
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { isoOf, todayISO } from '../lib/format.js'
import { setNav } from '../lib/nav.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useDiarySelection } from '../lib/nutrition/selection.js'
import { resetSyncThrottle, useHubSync } from '../lib/nutrition/sync.js'
import { createFakeNutriTrace, fixtureDay } from '../lib/nutrition/fake-nutritrace.js'
import { queryWords } from '../lib/search/match.js'
import { dayResults } from '../lib/search/results.js'
import { endSearch, openSearch, syncSearchWithHistory, useSearch } from '../lib/search/session.js'
import { openResult } from '../components/search/open-result.js'
import FoodHub from './FoodHub.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const TODAY = todayISO()
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return isoOf(d) }
const PICKED = daysAgo(1)
const FOUND = daysAgo(3)
let nt, host, root, where

// The router's navigate is the app's nav(), as App.jsx wires it; `where` is the location shown.
function Wiring() {
  setNav(useNavigate())
  where = useLocation()
  return null
}
const settle = async (ms = 0) => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, ms)) }) }

beforeEach(() => {
  nt = createFakeNutriTrace({ days: { [TODAY]: fixtureDay(TODAY), [PICKED]: fixtureDay(PICKED), [FOUND]: fixtureDay(FOUND) } })
  vi.stubGlobal('fetch', nt.fetch)
  useStore.setState(s => ({
    user: { id: 3, name: 'Ana' },
    pushState: vi.fn(async () => {}),
    S: { ...s.S, routines: [], workouts: [], bodyweight: [], dayPlan: {}, week: {}, active: null, checkIn: false, unit: 'kg' },
  }))
  useNutrition.getState().reset()
  useDiarySelection.getState().reset()
  useHubSync.getState().reset()
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null })
  resetSyncThrottle()
  history.replaceState({ idx: 0 }, '')
  vi.spyOn(history, 'back').mockImplementation(() => {})
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  act(() => endSearch())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('a Day result on Nutrition', () => {
  it('opens that day\'s diary for the visit, the entry\'s meal open and the entry flashed, and back puts the day back', async () => {
    // The diary was on yesterday when the search opened, from Home.
    act(() => useDiarySelection.getState().setDate(PICKED))
    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/home']}>
        <Wiring />
        <Routes><Route path="/home" element={<p>Home</p>} /><Route path="/food" element={<FoodHub />} /></Routes>
      </MemoryRouter>)
    })
    act(() => openSearch('home'))
    const { id, base } = useSearch.getState()

    // The row the overlay shows for "quick", from the day as the diary index holds it.
    const indexed = { date: FOUND, rev: '', kcal: 678, items: [
      { uuid: 'it-oats', name: 'Rolled oats', food_id: 11, meal: 0, kcal: 228 },
      { uuid: 'it-quick', name: 'Quick Calories', food_id: null, meal: 1, kcal: 450 },
    ] }
    const [row] = dayResults(queryWords('quick'), [indexed], ['Breakfast', 'Lunch', 'Dinner', 'Snacks'])
    expect(row).toMatchObject({ type: 'day', date: FOUND, uuid: 'it-quick' })
    await act(async () => openResult(row, { query: 'quick' }))
    await settle()

    // The real page, on the found day.
    expect(where.pathname).toBe('/food')
    expect(where.search).toBe('')
    expect(where.state).toMatchObject({ searchVisit: id })
    expect(useDiarySelection.getState().day()).toBe(FOUND)
    expect(nt.requests.some(r => r.path === `/nt/api/diary/${FOUND}`)).toBe(true)
    const toggles = [...host.querySelectorAll('.meal-toggle')]
    expect(toggles.map(b => b.getAttribute('aria-expanded'))).toEqual(['false', 'true', 'false', 'false'])
    expect(host.querySelector('li.flash-find').textContent).toContain('Quick')

    // Back on the overlay's entry: the diary's day is the one it had.
    await act(async () => syncSearchWithHistory({ idx: base, gainsSearch: id }))
    expect(useSearch.getState()).toMatchObject({ open: true, live: true })
    expect(useDiarySelection.getState().day()).toBe(PICKED)
  })

  it('a plain deep link picks the day for good, and finds nothing it was not asked to', async () => {
    await act(async () => {
      root.render(<MemoryRouter initialEntries={[`/food?date=${FOUND}`]}>
        <Wiring />
        <Routes><Route path="/food" element={<FoodHub />} /></Routes>
      </MemoryRouter>)
    })
    await settle()
    expect(where.search).toBe('')
    expect(useDiarySelection.getState().day()).toBe(FOUND)
    expect(host.querySelector('.flash-find')).toBeNull()
  })
})
