// @vitest-environment happy-dom
// Profile's NutriTrace-backed rows (ia-proposal §5), against the fake hub: Diary & meals writes
// the keys the hub allows, one per request, and Features holds the Fasting switch whose Fast row
// then shows in the + sheet.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useFastingOn } from '../lib/nutrition/use-fasting.js'
import { createFakeNutriTrace, fixtureSettings } from '../lib/nutrition/fake-nutritrace.js'
import { pageExists, pageVisible, searchSettings } from '../views/settings-pages.js'
import { bindUI } from './ui.jsx'
import DiaryMealsPage from './DiaryMealsSettings.jsx'
import FeaturesList from './FeaturesList.jsx'
import NtSettingsGate from './NtSettingsGate.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))

// The page as Settings.jsx mounts it: behind the gate that waits for NutriTrace's settings.
const DiaryMealsSettings = () => <NtSettingsGate><DiaryMealsPage /></NtSettingsGate>



globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, nt
const toast = vi.fn()
const rowTitled = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)) })
const puts = () => nt.requests.filter(r => r.method === 'PUT' && r.path === '/nt/api/settings')

function setUp(settings = {}) {
  nt = createFakeNutriTrace({ settings: { ...fixtureSettings(), ...settings } })
  vi.stubGlobal('fetch', nt.fetch)
}

beforeEach(() => {
  useStore.setState({ user: { id: 3, name: 'Ana' }, pushState: vi.fn(async () => {}) })
  useUI.setState({ toast })
  useNutrition.getState().reset()
  toast.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('Diary & meals', () => {
  it('switches the activity section with one { key, value } write the hub allows', async () => {
    setUp({ diaryShowActivity: false })
    act(() => root.render(<DiaryMealsSettings />))
    await settle()
    const sw = rowTitled('Show activity under meals').querySelector('[role="switch"]')
    expect(sw.getAttribute('aria-checked')).toBe('false')
    await act(async () => { sw.click() })
    await settle()
    expect(puts().map(r => r.body)).toEqual([{ key: 'diaryShowActivity', value: true }])
    expect(nt.state.settings.diaryShowActivity).toBe(true)
    expect(rowTitled('Show activity under meals').querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('true')
  })

  it('a refused save keeps the old value and says so', async () => {
    setUp({ diaryShowActivity: false })
    act(() => root.render(<DiaryMealsSettings />))
    await settle()
    nt.failNext('PUT', '/nt/api/settings', { status: 400 })
    await act(async () => { rowTitled('Show activity under meals').querySelector('[role="switch"]').click() })
    await settle()
    expect(toast).toHaveBeenCalledWith('Not saved. Try again.')
    expect(rowTitled('Show activity under meals').querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('false')
  })

  it('offers the default fasting plan only while fasting is on', async () => {
    setUp({ fastingEnabled: false })
    act(() => root.render(<DiaryMealsSettings />))
    await settle()
    expect(rowTitled('Default fasting plan')).toBeUndefined()
    useNutrition.getState().reset()
    setUp({ fastingEnabled: true, fastingDefaultHours: 18 })
    act(() => root.render(<DiaryMealsSettings key="on" />))
    await settle()
    expect(rowTitled('Default fasting plan').querySelector('.lrow-v').textContent).toBe('18:6')
  })

  it('picking a plan writes fastingDefaultHours, one { key, value } the hub allows', async () => {
    let sheet = null
    bindUI({ getState: () => ({ openSheet: render => { sheet = render; return { close: () => {} } } }) })
    setUp({ fastingEnabled: true, fastingDefaultHours: 16 })
    act(() => root.render(<DiaryMealsSettings />))
    await settle()
    act(() => rowTitled('Default fasting plan').click())
    const box = document.createElement('div')
    document.body.appendChild(box)
    const sheetRoot = createRoot(box)
    act(() => sheetRoot.render(sheet(() => {})))
    const option = [...box.querySelectorAll('button.lrow')].find(b => b.querySelector('.lrow-t')?.textContent === '20:4')
    await act(async () => { option.click() })
    act(() => sheetRoot.unmount())
    box.remove()
    await settle()
    expect(puts().map(r => r.body)).toEqual([{ key: 'fastingDefaultHours', value: 20 }])
    expect(nt.state.settings.fastingDefaultHours).toBe(20)
    expect(rowTitled('Default fasting plan').querySelector('.lrow-v').textContent).toBe('20:4')
  })
})

describe('Features › Fasting', () => {
  function Harness() {
    const data = useNutrition(s => s.settings.data)
    const plusRow = useFastingOn()
    return <>
      <FeaturesList S={{}} ctx={{ nutrition: true, ntSettings: data, fastingOn: data?.fastingEnabled === true }} />
      <span className="plus-fast">{plusRow ? 'fast row' : 'no fast row'}</span>
    </>
  }

  it('turning it on writes fastingEnabled and the + sheet gets its Fast row', async () => {
    setUp({ fastingEnabled: false })
    await act(async () => { await useNutrition.getState().loadSettings() })
    act(() => root.render(<Harness />))
    await settle()
    expect(host.querySelector('.plus-fast').textContent).toBe('no fast row')
    await act(async () => { rowTitled('Fasting').querySelector('[role="switch"]').click() })
    await settle()
    expect(puts().map(r => r.body)).toEqual([{ key: 'fastingEnabled', value: true }])
    expect(host.querySelector('.plus-fast').textContent).toBe('fast row')
    expect(rowTitled('Fasting').querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('true')
  })

  it('settings that did not load say so with Try again, instead of a switch that never wakes', async () => {
    setUp({ fastingEnabled: false })
    nt.failNext('GET', '/nt/api/settings', { status: 500 })
    await act(async () => { await useNutrition.getState().loadSettings().catch(() => {}) })
    act(() => root.render(<Harness />))
    await settle()
    expect(rowTitled('Fasting').textContent).toContain('Your settings did not load.')
    expect(rowTitled('Fasting').querySelector('[role="switch"]')).toBeNull()
    await act(async () => { [...rowTitled('Fasting').querySelectorAll('button')].find(b => b.textContent === 'Try again').click() })
    await settle()
    const sw = rowTitled('Fasting').querySelector('[role="switch"]')
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(sw.disabled || sw.getAttribute('aria-disabled') === 'true').toBe(false)
  })
})

describe('where the nutrition rows show', () => {
  const web = { user: { id: 'u' }, mobile: false, nutrition: true }
  it('only where nutrition is reachable: the web app, signed in', () => {
    expect(pageVisible('goals', web)).toBe(true)
    expect(pageVisible('diary', { ...web, nutrition: false })).toBe(false)
    expect(pageExists('diary', { user: { id: 'u' }, mobile: false })).toBe(true)
    expect(pageExists('diary', { user: { id: 'u' }, mobile: true })).toBe(false)
    expect(pageExists('diary', { user: null, mobile: false })).toBe(false)
    expect(pageExists('goals', web)).toBe(false)   // it lives on Nutrition › Goals
  })
  it('the search finds them, and the calorie goal mode on Goals', () => {
    const tr = s => s
    expect(searchSettings('calorie goal', web, tr)[0]).toMatchObject({ page: 'goals', isPage: true })
    expect(searchSettings('fasting', web, tr).map(h => h.title)).toContain('Fasting')
    expect(searchSettings('fasting', { ...web, fastingOn: true }, tr).map(h => h.title)).toContain('Default fasting plan')
    expect(searchSettings('activity', web, tr).map(h => h.title)).toContain('Show activity under meals')
    expect(searchSettings('fasting', { ...web, nutrition: false }, tr)).toEqual([])
  })
})
