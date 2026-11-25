// @vitest-environment happy-dom
// Form check on the exercise ⋯ menu: for an exercise some drill judges (a squat, a chin-up, a
// side plank), only where the iPhone app can run it. Its "Use N reps" puts the counted reps into
// the open set without ticking it; a hold's "Use N s" puts the seconds into the open timed set, and
// is left out, with a line saying why, when the exercise's sets are not timed. The camera side
// (lib/form-check-native.js) is a stand-in here; the rest is the real store and sheets.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ available: true, result: null, runs: [] }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), appBase: () => '/' }))
vi.mock('../lib/form-check-native.js', () => ({
  formCheckAvailable: () => Promise.resolve(h.available),
  runFormCheck: opts => { h.runs.push(opts); return Promise.resolve(h.result) },
}))

const { default: Workout } = await import('./Workout.jsx')
const { DEF, useStore } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const SQUAT = '3593'   // barbell squat
const BENCH = '0289'   // dumbbell bench press
const CHIN_UP = '1326'
const SIDE_PLANK = '0715'
const entry = id => ({ id, rid: 'main', target: { sets: 2, reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: false }] })
const timedEntry = id => ({ id, rid: 'main', target: { mode: 'time', sets: 3, sec: 30 }, sets: [{ sec: 30, w: 0, done: true }, { sec: 30, w: 0, done: false }, { sec: 30, w: 0, done: false }] })
const HELD = {
  count: 75, missed: 4, reps: [{ counted: true, reason: null, lost: false }], tiles: [], details: [[]],
  cue: 'Out of line for 4 s: the hips dropped. Try pushing them up towards the ceiling.', cueId: 'missed', drill: 'side-plank', kind: 'hold',
}

let root, container, sheetRoot, sheetContainer

async function renderWorkout(entries) {
  const S = clone(DEF)
  S.routines = [{ id: 'main', name: 'Main', ex: entries.map(e => ({ id: e.id, sets: 2, reps: 5, weight: 60 })) }]
  S.active = { id: 'fc', d: '2026-11-25', start: Date.now(), routineIds: ['main'], routineId: 'main', name: 'Main', bw: null, cur: 0, entries }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
  // useFormCheckAvailable answers after a promise.
  await act(async () => { await Promise.resolve() })
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
const button = (c, text) => [...c.querySelectorAll('button')].find(b => b.textContent.trim() === text)

beforeEach(() => {
  localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
  h.available = true; h.runs = []
  // Seven counted and one too shallow: "Use 7 reps" takes the counted ones only.
  const rep = (counted, depth) => ({ counted, reason: counted ? null : 'shallow', lost: false, measures: { view: 'side', depth, downSec: 2, upSec: 1 } })
  h.result = {
    count: 7, missed: 1,
    reps: [...Array.from({ length: 7 }, () => rep(true, 'below')), rep(false, 'above')],
    tiles: [{ id: 'depth', label: 'Depth', value: '7 of 8', sub: 'at parallel or deeper' }],
    details: Array.from({ length: 8 }, () => [{ label: 'Depth', value: 'Below parallel' }]),
    cue: 'Reps that did not count: 1. The hip stayed above the knee.', cueId: 'missed', standard: 'parallel', drill: 'squat', kind: 'reps',
  }
  root = null; container = null; sheetRoot = null; sheetContainer = null
})

afterEach(() => {
  if (sheetRoot) act(() => sheetRoot.unmount())
  if (sheetContainer) sheetContainer.remove()
  if (root) act(() => root.unmount())
  if (container) container.remove()
  useUI.getState().stopRest()
})

describe('Form check on the exercise menu', () => {
  it('is there for an exercise a drill judges (a squat) on an iPhone that can run it', async () => {
    await renderWorkout([entry(SQUAT)])
    const item = menuItem(openMenu(), 'Form check')
    expect(item).toBeTruthy()
    expect(item.textContent).toContain('Counts your reps with the camera')
  })

  it('is a button on the drawing too, top corner, and opens the same sheet', async () => {
    await renderWorkout([entry(SQUAT)])
    const btn = document.querySelector('.exmedia .formcheck-btn')
    expect(btn).toBeTruthy()
    expect(btn.getAttribute('aria-label')).toBe('Form check')
    act(() => btn.click())
    expect(button(renderTopSheet(), 'Start')).toBeTruthy()
  })

  it('has no button on the drawing of a bench press, or where it cannot run', async () => {
    await renderWorkout([entry(BENCH)])
    expect(document.querySelector('.formcheck-btn')).toBeNull()
  })

  it('is not there for a bench press', async () => {
    await renderWorkout([entry(BENCH)])
    expect(menuItem(openMenu(), 'Form check')).toBeFalsy()
  })

  it('is not there where it cannot run (the web, Android, the simulator)', async () => {
    h.available = false
    await renderWorkout([entry(SQUAT)])
    expect(menuItem(openMenu(), 'Form check')).toBeFalsy()
  })

  it('is there for a chin-up and a side plank too, a hold said as timed', async () => {
    await renderWorkout([entry(CHIN_UP)])
    expect(menuItem(openMenu(), 'Form check').textContent).toContain('Counts your reps with the camera')
    act(() => root.unmount()); container.remove(); root = null
    await renderWorkout([timedEntry(SIDE_PLANK)])
    expect(menuItem(openMenu(), 'Form check').textContent).toContain('Times your hold with the camera')
  })

  it('puts the seconds held into the open timed set of a side plank, unticked', async () => {
    h.result = HELD
    await renderWorkout([timedEntry(SIDE_PLANK)])
    const item = menuItem(openMenu(), 'Form check')
    act(() => item.click())
    const intro = renderTopSheet()
    expect(intro.querySelector('[data-fc-drill] b').textContent).toBe('Side plank')
    await act(async () => { button(intro, 'Start').click(); await Promise.resolve(); await Promise.resolve() })
    expect(h.runs[0]).toMatchObject({ drill: 'side-plank' })
    const result = renderTopSheet()
    expect(result.querySelector('[data-fc-count]').textContent).toBe('1:15')
    act(() => button(result, 'Use 75 s').click())
    const sets = useStore.getState().S.active.entries[0].sets
    expect(sets[1]).toMatchObject({ sec: 75, done: false })
    expect(sets[0].sec).toBe(30)
    expect(sets[2].sec).toBe(30)
  })

  it('has no "Use N s" for a side plank logged in reps, and says why', async () => {
    h.result = HELD
    await renderWorkout([entry(SIDE_PLANK)])
    const item = menuItem(openMenu(), 'Form check')
    act(() => item.click())
    const intro = renderTopSheet()
    await act(async () => { button(intro, 'Start').click(); await Promise.resolve(); await Promise.resolve() })
    const result = renderTopSheet()
    expect(button(result, 'Use 75 s')).toBeUndefined()
    expect(result.querySelector('[data-fc-use-note]').textContent).toBe('This exercise’s sets are not timed, so the seconds are not put into a set.')
  })

  it('runs with the camera picked and puts the counted reps into the open set, unticked', async () => {
    await renderWorkout([entry(SQUAT)])
    // Opened outside act(): the menu renders through nested act() calls an outer one would hold back.
    const item = menuItem(openMenu(), 'Form check')
    act(() => item.click())
    const intro = renderTopSheet()
    // The setup line is the drill's: no longer side-on only.
    expect(intro.textContent).toContain('Phone at knee height and level')
    act(() => button(intro, 'Front camera').click())
    act(() => button(intro, 'Below parallel').click())
    await act(async () => { button(intro, 'Start').click(); await Promise.resolve(); await Promise.resolve() })
    expect(h.runs[0]).toMatchObject({ camera: 'front', standard: 'below', drill: 'squat' })
    const result = renderTopSheet()
    expect(result.querySelector('[data-fc-count]').textContent).toBe('7')
    expect(result.querySelector('[data-fc-missed]').textContent).toBe('1 did not count')
    act(() => button(result, 'Use 7 reps').click())
    const sets = useStore.getState().S.active.entries[0].sets
    expect(sets[1]).toMatchObject({ r: 7, done: false })
    expect(sets[0].r).toBe(5)
  })
})
