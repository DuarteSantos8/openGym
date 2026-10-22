// @vitest-environment happy-dom
// A slot's planned backups from the exercise's ⋯ menu (#649): one tap and the backup takes the
// slot with the slot's own plan, in the Cards layout and in Focus, against the real store, sheets
// and session builder. The swap picker's side of it is in sheets.backups.test.jsx.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { buildSessionEntries } from '../lib/session-start.js'
import { EXIDX } from '../lib/exercises.js'
import { exerciseNameText } from '../lib/format.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), appBase: () => '/' }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const BENCH = '0025'
const INCLINE = '0047'
const DB_BENCH = '0289'
const ROW = '0027'
const name = id => exerciseNameText(EXIDX[id])
const routines = [{
  id: 'main', name: 'Main',
  ex: [
    { id: BENCH, sets: 3, reps: 8, weight: 80, restSec: 150, warmupSets: 2, subs: [INCLINE, DB_BENCH] },
    { id: ROW, sets: 3, reps: 10, weight: 60 },
  ],
}]
// Incline has been done in this routine, so a swap to it opens at its own weight (#275 rule).
const history = [{
  id: 'w1', d: '2026-09-20', routineIds: ['main'],
  entries: [{ id: INCLINE, rid: 'main', target: { sets: 3, reps: 8, weight: 60 }, sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: true }, { w: 60, r: 8, done: true }] }],
}]

let root
let container
let sheetRoot
let sheetContainer

function renderWorkout({ workoutView = 'cards', logged = false, cur = 0 } = {}) {
  const S = clone(DEF)
  S.routines = clone(routines)
  S.workouts = clone(history)
  S.workoutView = workoutView
  const entries = buildSessionEntries(S, S.routines[0]).map(e => ({ ...e, rid: 'main' }))
  if (logged) entries[0].sets[0].done = true
  S.active = { id: 'backups-test', d: '2026-09-23', start: Date.now(), routineIds: ['main'], routineId: 'main', name: 'Main', bw: null, cur, entries }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}

function renderTopSheet() {
  if (sheetRoot) act(() => sheetRoot.unmount())
  if (sheetContainer) sheetContainer.remove()
  const sheet = useUI.getState().sheets.at(-1)
  expect(sheet).toBeTruthy()
  sheetContainer = document.createElement('div')
  document.body.appendChild(sheetContainer)
  sheetRoot = createRoot(sheetContainer)
  act(() => sheetRoot.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return sheetContainer
}

// The Cards layout renders every card, so the menu is opened by card; Focus shows one.
const openMenu = (card = 0) => {
  const more = container.querySelectorAll('button[aria-label="More"]')[card]
  expect(more).toBeTruthy()
  act(() => more.click())
  return renderTopSheet()
}
const labels = menu => [...menu.querySelectorAll('.menu-item')].map(it => it.querySelector('.tt')?.textContent)
const menuItem = (menu, label) => [...menu.querySelectorAll('.menu-item')].find(it => it.querySelector('.tt')?.textContent === label)
const active = () => useStore.getState().S.active

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
  root = null; container = null; sheetRoot = null; sheetContainer = null
})

afterEach(() => {
  if (sheetRoot) act(() => sheetRoot.unmount())
  if (sheetContainer) sheetContainer.remove()
  if (root) act(() => root.unmount())
  if (container) container.remove()
  useUI.getState().stopRest()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('the exercise’s ⋯ menu', () => {
  it('lists the slot’s backups right after Swap exercise, one tap each', () => {
    renderWorkout()
    const list = labels(openMenu())
    const at = list.indexOf('Swap exercise')
    expect(at).toBeGreaterThanOrEqual(0)
    expect(list.slice(at, at + 3)).toEqual(['Swap exercise', 'Do ' + name(INCLINE) + ' instead', 'Do ' + name(DB_BENCH) + ' instead'])
    expect(menuItem(sheetContainer, 'Do ' + name(INCLINE) + ' instead').querySelector('.ss').textContent).toBe('Planned backup')
  })

  it('a slot without backups offers none', () => {
    renderWorkout({ cur: 1 })
    const list = labels(openMenu())
    expect(list).toContain('Swap exercise')
    expect(list.some(l => l.startsWith('Do '))).toBe(false)
  })

  it('one tap: the backup takes the slot with the slot’s plan, its own weight, and the bench as its first backup', () => {
    renderWorkout()
    const before = active().entries[0]
    expect(before.id).toBe(BENCH)
    // Opened outside act: openMenu renders the sheet in an act of its own, and nested it would
    // not have flushed by the time the item is looked up.
    const item = menuItem(openMenu(), 'Do ' + name(INCLINE) + ' instead')
    act(() => item.click())

    const [now, row] = active().entries
    expect(now.id).toBe(INCLINE)
    expect(now.rid).toBe('main')
    expect(row.id).toBe(ROW)
    expect(active().entries).toHaveLength(2)
    // The slot's sets and targets: 3 × 8, its rest, its warm-ups; the weight is incline's own.
    expect([now.target.sets, now.target.reps, now.target.restSec, now.target.warmupSets]).toEqual([3, 8, 150, 2])
    expect(now.sets.filter(s => !s.warm && !s.warmup).length).toBeGreaterThanOrEqual(3)
    // 60 × 8 × 3 last time in this routine, and the default rule moves it up a step: 62.5, the
    // way incline's own session in Main would open, not the bench's 80.
    expect(now.sets.at(-1).w).toBe(62.5)
    expect(now.sets.every(s => s.done !== true)).toBe(true)
    // Swapping back is one tap too: the bench stands first among the backups now.
    expect(now.target.subs).toEqual([BENCH, DB_BENCH])
    expect(useUI.getState().toastMsg).toBe('Replaced with “' + name(INCLINE) + '”')
    const again = labels(openMenu())
    const at = again.indexOf('Swap exercise')
    expect(again.slice(at + 1, at + 3)).toEqual(['Do ' + name(BENCH) + ' instead', 'Do ' + name(DB_BENCH) + ' instead'])
    // The routine itself is untouched: a swap changes today's workout only.
    expect(useStore.getState().S.routines[0].ex[0].id).toBe(BENCH)
    expect(useStore.getState().S.routines[0].ex[0].subs).toEqual([INCLINE, DB_BENCH])
  })

  it('with a set already logged it asks first, like any swap, and nothing moves until then', () => {
    renderWorkout({ logged: true })
    // Opened outside act: openMenu renders the sheet in an act of its own, and nested it would
    // not have flushed by the time the item is looked up.
    const item = menuItem(openMenu(), 'Do ' + name(INCLINE) + ' instead')
    act(() => item.click())
    const ask = renderTopSheet()
    expect(ask.querySelector('h3').textContent).toBe('Swap exercise?')
    expect(active().entries[0].id).toBe(BENCH)
    expect(active().entries).toHaveLength(2)
    act(() => [...ask.querySelectorAll('button')].find(b => b.textContent === 'Continue').click())
    // Logged sets stay with the bench; incline is inserted after it, at the slot's plan.
    expect(active().entries.map(e => e.id)).toEqual([BENCH, INCLINE, ROW])
    expect(active().entries[1].target.reps).toBe(8)
    expect(active().entries[1].target.subs).toEqual([BENCH, DB_BENCH])
  })
})

describe('the Focus layout’s menu', () => {
  it('offers the same one tap', () => {
    renderWorkout({ workoutView: 'focus' })
    const menu = openMenu()
    const item = menuItem(menu, 'Do ' + name(DB_BENCH) + ' instead')
    expect(item).toBeTruthy()
    expect(item.querySelector('.ss').textContent).toBe('Planned backup')
    act(() => item.click())
    const [now] = active().entries
    expect(now.id).toBe(DB_BENCH)
    expect([now.target.sets, now.target.reps]).toEqual([3, 8])
    expect(now.target.subs).toEqual([BENCH, INCLINE])
  })
})
