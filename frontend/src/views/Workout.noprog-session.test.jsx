// @vitest-environment happy-dom
// "Don't count for progression" for the whole workout, from the header ⋮ (Discord, asierlama:
// "exclude the current workout" on an injury day), against the real store, sheets and editor:
// every exercise gets the marker, it switches off again, what joins the session later follows it,
// and the #203 editor opens, changes and saves it.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { editCompletedSession } from '../lib/session-edit.js'
import { lastEntryFor } from '../lib/history.js'
import { EXDB } from '../lib/exercises.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), restOver: vi.fn(), vibrate: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), appBase: () => '/' }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const BENCH = '0025'
const ROW = '0027'
const SQUAT = '0043'
const routines = [
  { id: 'main', name: 'Main', ex: [{ id: BENCH, sets: 1, reps: 5, weight: 100 }, { id: ROW, sets: 1, reps: 8, weight: 60 }] },
  { id: 'legs', name: 'Legs', ex: [{ id: SQUAT, sets: 1, reps: 5, weight: 80 }] },
  { id: 'deload', name: 'Deload', excludeFromProgression: true, ex: [{ id: ROW, sets: 1, reps: 8, weight: 40 }] },
]
const entry = (id, rid, w, extra = {}) => ({ id, rid, target: { sets: 1, reps: 5, weight: w }, sets: [{ w, r: 5, done: false }], ...extra })
const HEADER_SUB = 'Every exercise in this workout'

let root
let container
let sheetRoot
let sheetContainer

function mount(S) {
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}
function renderWorkout(entries, { workouts = [] } = {}) {
  const S = clone(DEF)
  S.routines = clone(routines)
  S.workouts = clone(workouts)
  // List view: every exercise's card is on screen at once.
  S.active = { id: 'session', d: '2026-09-24', start: Date.now(), routineIds: ['main'], routineId: 'main', name: 'Main', bw: null, cur: 0, workoutView: 'list', entries }
  mount(S)
}
function renderEditor(saved) {
  const S = clone(DEF)
  S.routines = clone(routines)
  S.workouts = [clone(saved)]
  S.workoutView = 'list'
  editCompletedSession(S, saved.id)
  mount(S)
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
const openHeaderMenu = () => {
  const more = container.querySelector('button[aria-label="Workout view"]')
  expect(more).toBeTruthy()
  act(() => more.click())
  return renderTopSheet()
}
const headerItem = () => [...openHeaderMenu().querySelectorAll('.menu-item')]
  .find(it => it.querySelector('.tt')?.textContent === 'Don’t count for progression' && it.querySelector('.ss')?.textContent === HEADER_SUB)
// Opened outside act(): the menu is rendered by nested act() calls, which an outer one would
// batch until it ends, so the item would not be there yet to tap.
const tapHeaderItem = () => {
  const item = headerItem()
  expect(item).toBeTruthy()
  act(() => item.click())
}
const isOn = item => !!item.querySelector('.menu-on.is-on')
const markers = () => [...container.querySelectorAll('.noprog')]
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

describe('don’t count the whole workout for progression', () => {
  it('the header ⋮ keeps every exercise out, each card shows the marker, and a second tap counts them again', () => {
    renderWorkout([entry(BENCH, 'main', 100), entry(ROW, 'main', 60)])
    const item = headerItem()
    expect(item).toBeTruthy()
    expect(isOn(item)).toBe(false)
    act(() => item.click())

    expect(active().noProg).toBe(true)
    expect(active().entries.map(e => e.noProg)).toEqual([true, true])
    expect(markers()).toHaveLength(2)
    expect(markers().every(m => m.textContent.includes('Not counted for progression'))).toBe(true)
    // The routine is not touched.
    expect(useStore.getState().S.routines.find(r => r.id === 'main').excludeFromProgression).toBeUndefined()

    const again = headerItem()
    expect(isOn(again)).toBe(true)
    act(() => again.click())
    expect(active().noProg).toBeUndefined()
    expect(active().entries.map(e => e.noProg)).toEqual([undefined, undefined])
    expect(markers()).toHaveLength(0)
  })

  it('switched off, an exercise a deload routine keeps out stays out', () => {
    renderWorkout([entry(BENCH, 'main', 100), entry(ROW, 'deload', 40, { noProg: true })])
    tapHeaderItem()
    tapHeaderItem()
    expect(active().entries.map(e => e.noProg)).toEqual([undefined, true])
  })

  it('is not offered when a deload routine already keeps every exercise out', () => {
    renderWorkout([entry(ROW, 'deload', 40, { noProg: true })])
    expect(headerItem()).toBeUndefined()
  })

  it('one card’s Undo counts that exercise again and the header no longer says the whole workout', () => {
    renderWorkout([entry(BENCH, 'main', 100), entry(ROW, 'main', 60)])
    tapHeaderItem()
    const undo = [...markers()[1].querySelectorAll('button')].find(b => b.textContent === 'Undo')
    act(() => undo.click())
    expect(active().entries.map(e => e.noProg)).toEqual([true, undefined])
    expect(active().noProg).toBeUndefined()
    expect(isOn(headerItem())).toBe(false)
  })

  it('an exercise added afterwards joins it', () => {
    renderWorkout([entry(BENCH, 'main', 100)])
    tapHeaderItem()
    const add = [...container.querySelectorAll('button')].find(b => b.textContent.trim() === 'Add exercise')
    act(() => add.click())
    const picker = useUI.getState().sheets.at(-1)
    act(() => picker.render(picker.close).props.onPick(EXDB.find(e => e.id === SQUAT), true))
    expect(active().entries.map(e => [e.id, e.noProg])).toEqual([[BENCH, true], [SQUAT, true]])
  })

  it('a routine added afterwards joins it, with its own prescription kept', () => {
    renderWorkout([entry(BENCH, 'main', 100)])
    tapHeaderItem()
    const addRoutine = [...openHeaderMenu().querySelectorAll('.menu-item')].find(it => it.querySelector('.tt')?.textContent === 'Add routine')
    act(() => addRoutine.click())
    const legs = [...renderTopSheet().querySelectorAll('.item')].find(it => it.textContent.includes('Legs'))
    expect(legs).toBeTruthy()
    act(() => legs.click())
    const squat = active().entries.find(e => e.id === SQUAT)
    expect(squat.noProg).toBe(true)
    expect(squat.plan?.kind).not.toBe('off')
  })

  it('without it, an exercise kept out on its own is not passed on to one added after it', () => {
    renderWorkout([entry(BENCH, 'main', 100, { noProg: true })])
    expect(isOn(headerItem())).toBe(false)
    const add = [...container.querySelectorAll('button')].find(b => b.textContent.trim() === 'Add exercise')
    act(() => add.click())
    const picker = useUI.getState().sheets.at(-1)
    act(() => picker.render(picker.close).props.onPick(EXDB.find(e => e.id === SQUAT), true))
    expect(active().entries.find(e => e.id === SQUAT).noProg).toBeUndefined()
  })
})

// The #203 editor is the same screen on a copy of the saved workout.
describe('the whole-workout switch in the saved-workout editor', () => {
  const done = (id, w) => ({ id, rid: 'main', target: { sets: 1, reps: 5, weight: w }, sets: [{ w, r: 5, done: true }] })
  const counting = { id: 'saved', d: '2026-09-22', start: 1000, end: 2000, routineIds: ['main'], name: 'Main', entries: [done(BENCH, 100), done(ROW, 60)] }
  const excluded = { ...counting, excludeFromProgression: true, entries: counting.entries.map(e => ({ ...e, noProg: true })) }
  const earlier = { id: 'earlier', d: '2026-09-20', start: 0, end: 1, routineIds: ['main'], name: 'Main', entries: [done(BENCH, 90)] }
  const saveButton = () => container.querySelector('button[aria-label="Save changes"]')
  const saved = () => useStore.getState().S.workouts.find(w => w.id === 'saved')

  it('a workout kept out as a whole opens with the switch on; switched off and saved, it counts again', () => {
    renderEditor(excluded)
    expect(active().editingWorkoutId).toBe('saved')
    expect(markers()).toHaveLength(2)
    const item = headerItem()
    expect(isOn(item)).toBe(true)
    act(() => item.click())
    act(() => saveButton().click())

    expect(active()).toBeNull()
    expect(saved()).not.toHaveProperty('excludeFromProgression')
    expect(saved().entries.some(e => 'noProg' in e)).toBe(false)
    expect(lastEntryFor(useStore.getState().S, BENCH, 'main').d).toBe('2026-09-22')
  })

  it('switched on in the editor and saved, the workout is kept out like one finished that way', () => {
    renderEditor(counting)
    act(() => useStore.getState().update(s => { s.workouts.push(clone(earlier)) }))
    tapHeaderItem()
    expect(markers()).toHaveLength(2)
    act(() => saveButton().click())

    expect(saved().excludeFromProgression).toBe(true)
    expect(saved().entries.every(e => e.noProg === true)).toBe(true)
    expect(saved()).not.toHaveProperty('noProg')
    expect(lastEntryFor(useStore.getState().S, BENCH, 'main').d).toBe('2026-09-20')
  })
})
