// @vitest-environment happy-dom
// "Don't count for progression" from an exercise's ⋯ menu (Discord, asierlama: an injury day),
// against the real store, sheets and progression engine: the toggle, the marker and its undo,
// and what the next session is then built from.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { buildCompletedWorkout } from '../lib/finish-workout.js'
import { nextPrescription } from '../lib/progression.js'
import { lastEntryFor } from '../lib/history.js'
import { buildSessionEntries } from '../lib/session-start.js'
import { swapActiveWorkoutExercise } from '../sheets.jsx'
import { EXDB } from '../lib/exercises.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), restOver: vi.fn(), vibrate: vi.fn(), unlock: vi.fn(), countdown: vi.fn(), hush: vi.fn(), holdSession: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), appBase: () => '/' }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const BENCH = '0025'
const ROW = '0027'
const routines = [
  { id: 'main', name: 'Main', ex: [{ id: BENCH, sets: 1, reps: 5, weight: 100 }] },
  { id: 'deload', name: 'Deload', excludeFromProgression: true, ex: [{ id: ROW, sets: 1, reps: 8, weight: 40 }] },
]
const history = [{
  id: 'w1', d: '2026-09-20', routineIds: ['main'],
  entries: [{ id: BENCH, rid: 'main', target: { sets: 1, reps: 5, weight: 100 }, sets: [{ w: 100, r: 5, done: true }] }],
}]
const entry = (id, rid, w, extra = {}) => ({ id, rid, target: { sets: 1, reps: 5, weight: w }, sets: [{ w, r: 5, done: false }], ...extra })

let root
let container
let sheetRoot
let sheetContainer

function renderWorkout(entries, { withRoutines = routines, withHistory = history } = {}) {
  const S = clone(DEF)
  S.routines = clone(withRoutines)
  S.workouts = clone(withHistory)
  S.active = { id: 'noprog-test', d: '2026-09-23', start: Date.now(), routineIds: ['main'], routineId: 'main', name: 'Main', bw: null, cur: 0, entries }
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

const openMenu = () => {
  const more = container.querySelector('button[aria-label="More"]')
  expect(more).toBeTruthy()
  act(() => more.click())
  return renderTopSheet()
}
const menuItem = (menu, label) => [...menu.querySelectorAll('.menu-item')].find(it => it.querySelector('.tt')?.textContent === label)
const marker = () => container.querySelector('.noprog')
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

describe('don’t count this session for progression', () => {
  it('the ⋯ menu stamps the entry, the card says so, and Undo takes it back', () => {
    renderWorkout([entry(BENCH, 'main', 80)])
    expect(marker()).toBeNull()

    const menu = openMenu()
    const item = menuItem(menu, 'Don’t count for progression')
    expect(item).toBeTruthy()
    expect(item.querySelector('.ss').textContent).toBe('This exercise, this session only')
    expect(item.querySelector('.menu-on.is-on')).toBeNull()
    act(() => item.click())

    expect(active().entries[0].noProg).toBe(true)
    expect(marker().textContent).toContain('Not counted for progression')
    // the routine is not touched
    expect(useStore.getState().S.routines.find(r => r.id === 'main').excludeFromProgression).toBeUndefined()

    const undo = [...marker().querySelectorAll('button')].find(b => b.textContent === 'Undo')
    act(() => undo.click())
    expect(active().entries[0].noProg).toBeUndefined()
    expect(marker()).toBeNull()
  })

  it('the menu item is a switch: it shows it is on, and a second tap turns it off', () => {
    renderWorkout([entry(BENCH, 'main', 80, { noProg: true })])
    const item = menuItem(openMenu(), 'Don’t count for progression')
    expect(item.querySelector('.menu-on.is-on')).toBeTruthy()
    act(() => item.click())
    expect(active().entries[0].noProg).toBeUndefined()
  })

  it('only that exercise: the others in the session still count', () => {
    renderWorkout([entry(BENCH, 'main', 80), entry(ROW, 'main', 50)])
    const item = menuItem(openMenu(), 'Don’t count for progression')
    act(() => item.click())
    expect(active().entries.map(e => e.noProg === true)).toEqual([true, false])
  })

  it('the saved workout keeps it, and the next session progresses from the last one that counted', () => {
    renderWorkout([entry(BENCH, 'main', 80)])
    const item = menuItem(openMenu(), 'Don’t count for progression')
    act(() => item.click())
    useStore.getState().update(s => { s.active.entries[0].sets[0].done = true })

    const saved = buildCompletedWorkout(active(), { end: Date.now() })
    expect(saved.entries[0].noProg).toBe(true)

    const S = { ...useStore.getState().S, active: null, workouts: [...history, saved] }
    const cfg = routines[0].ex[0]
    const plan = nextPrescription(S, cfg, routines[0])
    // 100 × 5 on the 20th was the last session that counted, not today's 80
    expect(plan.weight).toBe(102.5)
    expect(lastEntryFor(S, BENCH, 'main').d).toBe('2026-09-20')
  })

  // The flag set by hand only stops the session from counting; the rows stay at the
  // prescription. A rebuild that read it as "a deload routine's exercise" put them back at the
  // routine's own numbers with no prescription, and the Undo then let those numbers count.
  describe('a rebuild of an exercise kept out by hand keeps its prescription', () => {
    // Main plans 60; the last session that counted was 100 × 5, so today opens at 102.5.
    const planned = [{ id: 'main', name: 'Main', ex: [{ id: BENCH, sets: 1, reps: 5, weight: 60 }, { id: ROW, sets: 1, reps: 8, weight: 30 }] }]
    const logged = [{
      id: 'w1', d: '2026-09-20', routineIds: ['main'],
      entries: [
        { id: BENCH, rid: 'main', target: { sets: 1, reps: 5, weight: 100 }, sets: [{ w: 100, r: 5, done: true }] },
        { id: ROW, rid: 'main', target: { sets: 1, reps: 8, weight: 70 }, sets: [{ w: 70, r: 8, done: true }] },
      ],
    }]
    const start = () => {
      const S = { ...clone(DEF), routines: clone(planned), workouts: clone(logged) }
      const [bench] = buildSessionEntries(S, planned[0]).map(e => ({ ...e, rid: 'main' }))
      renderWorkout([bench], { withRoutines: planned, withHistory: logged })
      expect(active().entries[0].sets.map(set => set.w)).toEqual([102.5])
      const keepOut = menuItem(openMenu(), 'Don’t count for progression')
      act(() => keepOut.click())
      expect(active().entries[0].noProg).toBe(true)
    }
    const undoAndFinish = () => {
      const undo = [...marker().querySelectorAll('button')].find(b => b.textContent === 'Undo')
      act(() => undo.click())
      expect(active().entries[0].noProg).toBeUndefined()
      useStore.getState().update(s => { s.active.entries[0].sets.forEach(set => { set.done = true }) })
      const saved = buildCompletedWorkout(active(), { end: Date.now() })
      return { ...useStore.getState().S, active: null, workouts: [...logged, saved] }
    }

    it('Progression settings saved unchanged, then Undo: the session counts at 102.5 and the next one goes on from there', () => {
      start()
      const settings = menuItem(openMenu(), 'Progression settings')
      act(() => settings.click())
      const sheet = renderTopSheet()
      const save = [...sheet.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save')
      act(() => save.click())

      const [bench] = active().entries
      expect(bench.noProg).toBe(true)
      expect(bench.sets.map(set => set.w)).toEqual([102.5])
      expect(bench.target.weight).toBe(102.5)
      expect(bench.plan.kind).not.toBe('off')

      const S = undoAndFinish()
      expect(nextPrescription(S, planned[0].ex[0], planned[0]).weight).toBe(105)
    })

    it('a swap, then Undo: the replacement counts at its own prescription, not the routine’s numbers', () => {
      start()
      swapActiveWorkoutExercise(0)
      const picker = useUI.getState().sheets.at(-1)
      act(() => picker.render(picker.close).props.onPick(EXDB.find(e => e.id === ROW)))
      const config = useUI.getState().sheets.at(-1)
      act(() => config.render(config.close).props.onSave({ ...planned[0].ex[1] }))

      const [row] = active().entries
      expect(row.id).toBe(ROW)
      // The mark stays on the slot, with its Undo on the card.
      expect(row.noProg).toBe(true)
      // 70 × 8 last time, and a row goes up in 5s: 75, the way the routine's own start builds it.
      const S0 = { ...clone(DEF), routines: clone(planned), workouts: clone(logged) }
      expect(buildSessionEntries(S0, planned[0])[1].sets.map(set => set.w)).toEqual([75])
      expect(row.sets.map(set => set.w)).toEqual([75])
      expect(row.plan.kind).not.toBe('off')

      const S = undoAndFinish()
      expect(nextPrescription(S, planned[0].ex[1], planned[0]).weight).toBe(80)
    })
  })

  it('a deload routine’s exercise saved in Progression settings stays at the routine’s own numbers', () => {
    // 70 × 8 in Main would put a counting row at 75; the deload keeps its 40.
    const rowInMain = { id: 'w0', d: '2026-09-18', routineIds: ['main'], entries: [{ id: ROW, rid: 'main', target: { sets: 1, reps: 8, weight: 70 }, sets: [{ w: 70, r: 8, done: true }] }] }
    renderWorkout([{ ...entry(ROW, 'deload', 40, { noProg: true }), target: { sets: 1, reps: 8, weight: 40 }, sets: [{ w: 40, r: 8, done: false }] }], { withHistory: [...history, rowInMain] })
    const settings = menuItem(openMenu(), 'Progression settings')
    act(() => settings.click())
    const save = [...renderTopSheet().querySelectorAll('button')].find(b => b.textContent.trim() === 'Save')
    act(() => save.click())
    const [row] = active().entries
    expect(row.noProg).toBe(true)
    expect(row.plan.kind).toBe('off')
    expect(row.sets.map(set => set.w)).toEqual([40])
  })

  it('a deload routine’s exercise shows the marker but offers neither the switch nor an undo', () => {
    renderWorkout([entry(ROW, 'deload', 40, { noProg: true })])
    expect(marker().textContent).toContain('Not counted for progression')
    expect(marker().querySelector('button')).toBeNull()
    expect(menuItem(openMenu(), 'Don’t count for progression')).toBeUndefined()
  })
})
