// @vitest-environment happy-dom
// Scan logs to where the + sheet's Scan does: the date and the meal every tab shares, from Home's
// action row, Nutrition's action row and the search pill's barcode button alike. A meal slot past
// the end of the list (a meal removed in Profile after it was picked) falls back to the first.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { isoOf, todayISO } from '../lib/format.js'
import { useDiarySelection } from '../lib/nutrition/selection.js'
import { createFakeNutriTrace, fixtureDay } from '../lib/nutrition/fake-nutritrace.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { endSearch } from '../lib/search/session.js'
import HomeActions from './HomeActions.jsx'
import NutritionActions from './NutritionActions.jsx'
import RootHeader from './RootHeader.jsx'
import { scanToSelection } from './scan-to-selection.js'

const scanSheet = vi.fn()
vi.mock('./ScanSheet.jsx', () => ({ scanSheet: (...a) => scanSheet(...a) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const YESTERDAY = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return isoOf(d) })()
const day = { on: true, dayReady: true, settings: null }
let host, root

const entries = {
  'the Home action row': { path: '/', ui: <HomeActions date={todayISO()} day={day} />, press: () => labelled('Scan') },
  'the Nutrition action row': { path: '/food', ui: <NutritionActions date={todayISO()} day={day} />, press: () => labelled('Scan') },
  'the header\'s barcode button': { path: '/food', ui: <RootHeader title="Nutrition" />, open: true, press: () => labelled('Scan barcode') },
}
const labelled = name => [...host.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent).trim() === name)

async function press({ path, ui, open, press: find }) {
  await act(async () => { root.render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>) })
  if (open) await act(async () => { host.querySelector('.spill-i').focus() })
  await act(async () => { find().click() })
}

beforeEach(() => {
  scanSheet.mockClear()
  vi.stubGlobal('fetch', createFakeNutriTrace({ days: { [todayISO()]: fixtureDay(todayISO()) } }).fetch)
  useStore.setState(s => ({
    user: { id: 3, name: 'Ana' },
    S: { ...s.S, routines: [], workouts: [], dayPlan: {}, week: {}, active: null, checkIn: false, unit: 'kg' },
  }))
  useNutrition.getState().reset()
  useDiarySelection.getState().reset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  act(() => endSearch())
  vi.unstubAllGlobals()
})

describe.each(Object.entries(entries))('Scan from %s', (_, entry) => {
  it('logs to today and the meal by the clock when nothing was picked', async () => {
    await press(entry)
    expect(scanSheet).toHaveBeenCalledTimes(1)
    expect(scanSheet.mock.calls[0][0]).toMatchObject({ date: todayISO(), meal: useDiarySelection.getState().mealFor(null) })
  })

  it('logs to the picked date and meal, named', async () => {
    act(() => { useDiarySelection.getState().setDate(YESTERDAY); useDiarySelection.getState().setMeal(2) })
    await press(entry)
    expect(scanSheet.mock.calls[0][0]).toMatchObject({ date: YESTERDAY, meal: 2, mealName: 'Dinner' })
  })

  it('falls back to the first meal when the slot is past the end of the list', async () => {
    act(() => useDiarySelection.getState().setMeal(9))
    await press(entry)
    expect(scanSheet.mock.calls[0][0]).toMatchObject({ meal: 0, mealName: 'Breakfast' })
  })
})

describe('scanToSelection', () => {
  it('reads the selection at the tap, not at import', () => {
    useDiarySelection.getState().setMeal(1)
    scanToSelection()
    act(() => useDiarySelection.getState().setMeal(3))
    scanToSelection()
    expect(scanSheet.mock.calls.map(c => c[0].meal)).toEqual([1, 3])
  })
})
