// @vitest-environment happy-dom
// Card dismiss pass (1.4.4): a card or row that opens something and also holds a control of its own
// (the recap's ×, the streak's weekly-sets line, Add to my plan, the picker's quick add, Plan, a past
// workout's picture, the routine editor's rail) is not itself a button. Its primary is a real button
// stretched over it (.tap-main) and the other control is a sibling above it. A tap on the control
// does only that control's job, a tap on the card opens it, and nothing interactive sits inside
// anything interactive (the axe rule "nested-interactive", checked here in the DOM).
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { migratedFixture } from './lib/test-fixtures.js'
import { todayISO } from './lib/format.js'
import { RecapHomeCard } from './components/Recap.jsx'
import { exercisePicker, workoutDetailSheet, calendarSheet } from './sheets.jsx'
import Library from './views/Library.jsx'
import MuscleExplorer from './components/MuscleExplorer.jsx'
import Home from './views/Home.jsx'

const { navSpy } = vi.hoisted(() => ({ navSpy: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => navSpy, useLocation: () => ({ pathname: '/', state: null, search: '' }), useSearchParams: () => [new URLSearchParams()] }))
vi.mock('./sheets.jsx', async orig => ({ ...(await orig()), calendarSheet: vi.fn() }))

const BENCH = '0025'
const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [tabindex]:not([tabindex="-1"])'
/** Every interactive element that sits inside another one: what axe calls nested-interactive. */
const nestedInteractive = root => [...root.querySelectorAll(INTERACTIVE)]
  .filter(el => el.parentElement?.closest(INTERACTIVE) && root.contains(el.parentElement.closest(INTERACTIVE)))
  .map(el => `${el.tagName.toLowerCase()}.${el.className} in ${el.parentElement.closest(INTERACTIVE).className}`)
/** The name a screen reader reads for a control (aria-labelledby, aria-label, then its text). */
const nameOf = el => el.getAttribute('aria-labelledby')
  ? el.getAttribute('aria-labelledby').split(' ').map(id => document.getElementById(id)?.textContent).join(' ')
  : el.getAttribute('aria-label') || el.textContent.trim()

const mounted = []
const render = node => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(node))
  return host
}
const renderTop = () => { const sheet = useUI.getState().sheets.at(-1); return render(sheet.render(() => useUI.getState().closeSheet(sheet.id))) }
const sheets = () => useUI.getState().sheets.length
const bench = (d, extra = {}) => ({ id: 'w' + d, d, start: new Date(d + 'T10:00:00').getTime(), end: new Date(d + 'T11:00:00').getTime(), prs: [], routineIds: [], vol: 0,
  entries: [{ id: BENCH, target: { mode: 'reps' }, sets: [{ w: 100, r: 5, done: true }, { w: 100, r: 5, done: true }] }], ...extra })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  navSpy.mockClear(); calendarSheet.mockClear()
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }); vi.useRealTimers() })

describe('the recap card on Home', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-26T09:00:00'))   // a Monday
    useStore.setState(s => ({ S: { ...s.S, weekStart: 1, workouts: [bench('2026-10-20'), bench('2026-10-22')] } }))
  })
  it('is not a button: its text is, named by the title, and the × is a sibling', () => {
    const host = render(<RecapHomeCard S={useStore.getState().S} />)
    const card = host.querySelector('.recap-card')
    expect(card.getAttribute('role')).toBeNull()
    expect(card.hasAttribute('tabindex')).toBe(false)
    const main = card.querySelector('.tap-main')
    expect(main.tagName).toBe('BUTTON')
    expect(nameOf(main)).toBe('Your week')
    expect(main.getAttribute('aria-describedby')).toBeTruthy()
    const x = card.querySelector('[aria-label="Put it away"]')
    expect(main.contains(x)).toBe(false)
    expect(nestedInteractive(host)).toEqual([])
  })
  it('a tap on the × only puts it away; a tap on the card only opens the sheet', () => {
    const host = render(<RecapHomeCard S={useStore.getState().S} />)
    act(() => host.querySelector('[aria-label="Put it away"]').click())
    expect(useStore.getState().S.recapSeen).toBe('w:2026-10-19')
    expect(sheets()).toBe(0)
    useStore.setState(s => ({ S: { ...s.S, recapSeen: null } }))
    const again = render(<RecapHomeCard S={useStore.getState().S} />)
    act(() => again.querySelector('.recap-card .tap-main').click())
    expect(sheets()).toBe(1)
    expect(useStore.getState().S.recapSeen).toBe(null)
  })
})

describe('Home: the streak card and check-in', () => {
  const mount = patch => {
    useStore.setState(s => ({ S: { ...s.S, routines: [], workouts: [bench(todayISO())], homeMuscleSets: true, ...patch } }))
    return render(<Home />)
  }
  it('the weekly-sets line opens Stats → Lifts and not the calendar; the card opens the calendar', () => {
    const host = mount()
    const card = host.querySelector('.streak-card')
    expect(card.getAttribute('role')).toBeNull()
    act(() => card.querySelector('.wsets-home').click())
    expect(navSpy).toHaveBeenCalledWith('/stats?section=lifts')
    expect(calendarSheet).not.toHaveBeenCalled()
    act(() => card.querySelector('.tap-main').click())
    expect(calendarSheet).toHaveBeenCalledTimes(1)
  })
  it('check-in opens from its text, a real button', () => {
    const host = mount()
    const main = host.querySelector('.checkin-card .tap-main')
    expect(nameOf(main)).toBe('Check in')
    act(() => main.click())
    expect(navSpy).toHaveBeenCalledWith('/checkin')
  })
  it('nothing on Home is a control inside a control', () => {
    expect(nestedInteractive(mount())).toEqual([])
  })
})

describe('exercise rows with a trailing button', () => {
  it('Library: Add to my plan does not open the exercise, the name does', () => {
    const host = render(<Library />)
    const row = [...host.querySelectorAll('.list .item.tap-host')][0]
    expect(row.getAttribute('role')).toBeNull()
    act(() => row.querySelector('.lib-add').click())
    const afterAdd = useUI.getState().sheets.slice()
    expect(afterAdd.length).toBeLessThanOrEqual(1)
    if (afterAdd.length) expect(renderTop().querySelector('.exdetail-name')).toBeNull()
    useUI.setState({ sheets: [] })
    act(() => row.querySelector('.tap-main').click())
    expect(sheets()).toBe(1)
    expect(renderTop().querySelector('.exdetail-name')).not.toBeNull()
    expect(nestedInteractive(host)).toEqual([])
  })
  it('the add-exercise picker: the quick add commits, the name opens the config, never both', () => {
    const onPick = vi.fn()
    exercisePicker(onPick)
    const host = renderTop()
    const row = host.querySelector('.list .item.tap-host')
    act(() => row.querySelector('.iconbtn.chev').click())
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0][1]).toBe(true)
    act(() => row.querySelector('.tap-main').click())
    expect(onPick).toHaveBeenCalledTimes(2)
    expect(onPick.mock.calls[1][1]).toBeUndefined()
    expect(nestedInteractive(host)).toEqual([])
  })
  it('the muscle explorer: Plan plans, the name opens the details', () => {
    const onPlan = vi.fn(), onDetail = vi.fn()
    const host = render(<MuscleExplorer onPlan={onPlan} onDetail={onDetail} initial="chest" />)
    const row = host.querySelector('.list .item.tap-host')
    act(() => [...row.querySelectorAll('button')].find(b => b.textContent.trim() === 'Plan').click())
    expect(onPlan).toHaveBeenCalledTimes(1)
    expect(onDetail).not.toHaveBeenCalled()
    act(() => row.querySelector('.tap-main').click())
    expect(onDetail).toHaveBeenCalledTimes(1)
    expect(onPlan).toHaveBeenCalledTimes(1)
    expect(nestedInteractive(host)).toEqual([])
  })
  it('a past workout: the picture opens the details, the row the history', () => {
    const w = migratedFixture({ ...structuredClone(DEF), engineSchemaVersion: 1, workouts: [bench('2026-09-15')] }).workouts[0]
    useStore.setState(s => ({ S: { ...s.S, workouts: [w] } }))
    workoutDetailSheet(w)
    const host = renderTop()
    const row = host.querySelector('.wd-ex')
    expect(row.getAttribute('role')).toBeNull()
    act(() => row.querySelector('.wd-thumb').click())
    expect(sheets()).toBe(2)
    expect(renderTop().textContent).not.toContain('Exercise history')
    act(() => useUI.getState().closeSheet(useUI.getState().sheets.at(-1).id))
    act(() => row.querySelector('.tap-main').click())
    expect(sheets()).toBe(2)
    expect(renderTop().textContent).toContain('Exercise history')
    expect(nestedInteractive(host)).toEqual([])
  })
})
