// @vitest-environment happy-dom
// Redesign step 3 (workout logging) on the one-exercise page: the How-to card, the Last column
// lined up with last time's work sets, the Note · Plates · Swap · More row under the sets, a
// wide Add set, and the Up next card. The list view keeps its rows as they were.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn(), restOver: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const BENCH = '0025', SQUAT = '0043'
let root, container
beforeEach(() => { useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null }) })
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); root = container = null })

function mount({ view = 'cards', history = true } = {}) {
  const S = clone(DEF)
  Object.assign(S, { unit: 'kg', workoutView: view })
  if (history) S.workouts = [{ id: 'w1', d: '2026-10-01', name: 'Push', entries: [{ id: BENCH, sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 7, done: true }] }] }]
  S.active = { id: 'a', d: '2026-10-09', start: Date.now(), routineId: null, name: 'Push', bw: null, cur: 0, workoutView: view, entries: [
    { id: BENCH, target: { mode: 'reps', sets: 3, reps: 8 }, sets: [{ w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }] },
    { id: SQUAT, target: { mode: 'reps', sets: 2, reps: 5 }, sets: [{ w: 100, r: 5, done: false }, { w: 100, r: 5, done: false }] },
  ] }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}
const sheetTitles = () => useUI.getState().sheets.map(s => s.title || '')

describe('workout logging (redesign step 3)', () => {
  it('lines last time’s work sets up with today’s rows, and leaves a row with no match empty', () => {
    mount()
    expect(container.querySelector('.sethead .last-sp')?.textContent).toBe('Last')
    expect([...container.querySelectorAll('.setrow .last')].map(e => e.textContent)).toEqual(['60×8', '60×7', ''])
  })
  it('has no Last column without a last time', () => {
    mount({ history: false })
    expect(container.querySelector('.setrow .last')).toBeNull()
    expect(container.querySelector('.sethead .last-sp')).toBeNull()
  })
  it('puts How to do it, the action row and a wide Add set on the page', () => {
    mount()
    expect(container.querySelector('.howto')?.textContent).toContain('How to do it')
    const acts = [...container.querySelectorAll('.wk-acts button')]
    expect(acts.map(b => b.textContent || b.getAttribute('aria-label'))).toEqual(['Note', 'Plates', 'Swap', 'Exercise options'])
    expect(container.querySelector('.wk-add.wk-add-wide')).not.toBeNull()
  })
  it('the action row and How-to open their sheets', () => {
    mount()
    const before = useUI.getState().sheets.length
    act(() => container.querySelector('.howto').click())
    expect(useUI.getState().sheets.length).toBe(before + 1)
    act(() => useUI.getState().closeAll())
    act(() => [...container.querySelectorAll('.wk-acts button')][0].click())
    expect(useUI.getState().sheets.length).toBe(before + 1)
    act(() => useUI.getState().closeAll())
    act(() => [...container.querySelectorAll('.wk-acts button')].at(-1).click())
    expect(useUI.getState().sheets.length).toBe(before + 1)
    expect(sheetTitles().length).toBeGreaterThan(0)
  })
  it('Up next names the next exercise and its sets, and goes there', () => {
    mount()
    const up = container.querySelector('.upnext')
    expect(up.textContent).toContain('Up next')
    expect(up.textContent).toMatch(/2 sets/)
    act(() => up.click())
    expect(useStore.getState().S.active.cur).toBe(1)
    expect(container.querySelector('.upnext')).toBeNull()   // the last page has nothing up next
  })
  it('the list view keeps its rows as they were', () => {
    mount({ view: 'list' })
    expect(container.querySelector('.howto')).toBeNull()
    expect(container.querySelector('.wk-acts')).toBeNull()
    expect(container.querySelector('.setrow .last')).toBeNull()
  })
})
