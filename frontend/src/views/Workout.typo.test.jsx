// @vitest-environment happy-dom
// A likely typo asks at the tick (lib/typo-check.js): 300 typed where the best is 30 is not
// logged until you say so, and Fix it leaves the set unticked to correct.
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

const BENCH = '0025'
const entry = sets => ({ id: BENCH, target: { sets: sets.length, reps: 8, mode: 'reps' }, sets })
const past = sets => ({ id: 'w1', d: '2026-10-01', start: 1, entries: [{ id: BENCH, sets }] })

let roots = []
beforeEach(() => { useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null }) })
afterEach(() => {
  for (const [root, el] of roots) { act(() => root.unmount()); el.remove() }
  roots = []
})
function render(node) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  act(() => root.render(node))
  roots.push([root, el])
  return el
}
function mount(sets, workouts) {
  const S = clone(DEF)
  S.unit = 'kg'
  S.workoutView = 'list'
  S.workouts = workouts
  S.active = { id: 'typo-test', d: '2026-10-09', start: Date.now(), routineId: null, name: 'Typo', bw: null, cur: 0, entries: [entry(sets)], workoutView: 'list' }
  useStore.setState({ S, user: null })
  return render(<MemoryRouter><Workout /></MemoryRouter>)
}
const tick = (el, n = 1) => act(() => el.querySelector(`[aria-label="Set ${n} done"]`).click())
const setAt = i => useStore.getState().S.active.entries[0].sets[i]
const sheet = () => render(useUI.getState().sheets.at(-1).render(() => {}))
const button = (el, text) => [...el.querySelectorAll('button')].find(b => b.textContent === text)

describe('typo check at the tick', () => {
  it('asks before logging a weight over twice the best, and Fix it leaves it unticked', () => {
    const el = mount([{ w: 300, r: 8, done: false }], [past([{ w: 30, r: 8, done: true }])])
    tick(el)
    expect(setAt(0).done).toBe(false)
    const dialog = sheet()
    expect(dialog.textContent).toContain('Weight: 300 kg is more than twice your heaviest, 30 kg.')
    act(() => button(dialog, 'Fix it').click())
    expect(setAt(0).done).toBe(false)
  })

  it('Log as typed ticks it as typed', () => {
    const el = mount([{ w: 30, r: 1, done: false }], [past([{ w: 30, r: 10, done: true }])])
    tick(el)
    const dialog = sheet()
    expect(dialog.textContent).toContain('Reps: 1 is under a third of last time’s 10.')
    act(() => button(dialog, 'Log as typed').click())
    expect(setAt(0)).toMatchObject({ w: 30, r: 1, done: true })
  })

  it('ticks a normal set, a first time and an untick without asking', () => {
    // Two sets, so ticking one does not finish the workout and open its own sheet.
    const open = w => [{ w, r: 8, done: false }, { w, r: 8, done: false }]
    let el = mount(open(32.5), [past([{ w: 30, r: 8, done: true }])])
    tick(el)
    expect(setAt(0).done).toBe(true)
    tick(el)
    expect(setAt(0).done).toBe(false)
    el = mount(open(300), [])
    tick(el)
    expect(setAt(0).done).toBe(true)
    expect(useUI.getState().sheets).toHaveLength(0)
  })
})
