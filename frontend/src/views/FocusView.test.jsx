// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const SQUAT = '0043'

let root, container, sheetRoot, sheetContainer

function mount(entry, over = {}) {
  const S = clone(DEF)
  S.unit = 'lb'
  Object.assign(S, over)
  S.active = {
    id: 'focus-test', d: '2026-09-28', start: Date.now(), routineId: null,
    name: 'Focus', bw: null, cur: 0, workoutView: 'focus', entries: [entry],
  }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}

function openMenu() {
  act(() => container.querySelector('button[aria-label="More"]').click())
  const sheet = useUI.getState().sheets.at(-1)
  sheetContainer = document.createElement('div')
  document.body.appendChild(sheetContainer)
  sheetRoot = createRoot(sheetContainer)
  act(() => sheetRoot.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return sheetContainer
}

beforeEach(() => {
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
})

afterEach(() => {
  if (sheetRoot) act(() => sheetRoot.unmount())
  if (sheetContainer) sheetContainer.remove()
  if (root) act(() => root.unmount())
  if (container) container.remove()
  sheetRoot = sheetContainer = root = container = null
  useUI.getState().stopRest()
})

describe('Focus workout view', () => {
  it('omits a plan that repeats the prescription and keeps plate guidance in the badge row', () => {
    mount({
      id: SQUAT,
      target: { sets: 1, reps: 5, weight: 95 },
      planned: { sets: 1, reps: 5, weight: 95 },
      plan: { kind: 'up' },
      sets: [{ w: 95, r: 5, done: false }],
    })

    const summary = container.querySelector('.focus-prescription')
    expect(summary.textContent).not.toContain('Plan:')
    const plate = summary.querySelector('.focus-badge.plate')
    expect(plate).toBeTruthy()
    expect(plate.textContent).toContain('25 per side')
    expect(container.querySelector('.plateline')).toBeNull()
  })

  it('shows only a changed plan as a badge because the prescription already shows today', () => {
    mount({
      id: SQUAT,
      target: { sets: 4, reps: 8, weight: 95 },
      planned: { sets: 3, reps: 5, weight: 95 },
      plan: { kind: 'up' },
      sets: Array.from({ length: 4 }, () => ({ w: 95, r: 8, done: false })),
    })

    const summary = container.querySelector('.focus-prescription')
    const plan = summary.querySelector('.focus-badge.plan')
    expect(plan).toBeTruthy()
    expect(plan.textContent).toBe('Plan: 3 × 5')
    expect(summary.textContent).toContain('8 Reps')
    expect(summary.textContent).not.toContain('today')
  })

  it('offers the per-exercise progression switch and marks the current exercise', () => {
    mount({ id: SQUAT, target: { sets: 1, reps: 5, weight: 95 }, sets: [{ w: 95, r: 5, done: false }] })

    const item = [...openMenu().querySelectorAll('.menu-item')]
      .find(el => el.querySelector('.tt')?.textContent === 'Don’t count for progression')
    expect(item).toBeTruthy()
    act(() => item.click())

    expect(useStore.getState().S.active.entries[0].noProg).toBe(true)
    const status = container.querySelector('.focus-prescription .focus-badge.warning')
    expect(status).toBeTruthy()
    expect(status.textContent).toContain('Not counted for progression')
    expect(container.querySelector('.noprog')).toBeNull()
  })

  it('uses the exercise rest-pause duration for a new burst', () => {
    mount({
      id: SQUAT,
      target: { sets: 1, reps: 5, weight: 95, intensifier: { type: 'restpause', restSec: 7 } },
      sets: [{ w: 95, r: 5, done: false }],
    })

    act(() => container.querySelector('button[aria-label="Set menu"]').click())
    const sheet = useUI.getState().sheets.at(-1)
    sheetContainer = document.createElement('div')
    document.body.appendChild(sheetContainer)
    sheetRoot = createRoot(sheetContainer)
    act(() => sheetRoot.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
    const item = [...sheetContainer.querySelectorAll('.menu-item')]
      .find(el => el.querySelector('.tt')?.textContent === 'Add burst')
    act(() => item.click())

    expect(useStore.getState().S.active.entries[0].sets[0].clusters[0].restSec).toBe(7)
  })
})

// The speed stepper follows the profile's speed unit like the set row does (lib/speed.js): shown,
// stepped and typed in mph, stored in km/h. It used to say km/h whatever the setting.
describe('Focus view cardio speed', () => {
  const BIKE = '2138'   // stationary bike, cardio
  const bike = () => ({ id: BIKE, target: { sets: 1, min: 20, speed: 8 }, sets: [{ min: 20, speed: 8, done: false }] })
  const cell = () => container.querySelector('button[aria-label="Increase speed"]').closest('.stp-w')
  const stored = () => useStore.getState().S.active.entries[0].sets[0].speed
  const type = value => {
    const input = cell().querySelector('input')
    act(() => {
      Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('reads, steps and takes typing in mph for a profile in pounds, and stores km/h', () => {
    mount(bike())
    expect(cell().querySelector('.stp-l').textContent).toBe('Speed (mph)')
    expect(cell().querySelector('input').value).toBe('4.97')   // 8 km/h
    act(() => container.querySelector('button[aria-label="Increase speed"]').click())
    expect(stored()).toBe(8.8)
    type('6')
    expect(stored()).toBe(9.66)
  })

  it('follows a chosen unit over the weight unit, and leaves km/h as it was', () => {
    mount(bike(), { unit: 'kg', speedUnit: 'mph' })
    expect(cell().querySelector('.stp-l').textContent).toBe('Speed (mph)')
    act(() => root.unmount()); container.remove()
    mount(bike(), { speedUnit: 'kmh' })
    expect(cell().querySelector('.stp-l').textContent).toBe('Speed (km/h)')
    expect(cell().querySelector('input').value).toBe('8')
    act(() => container.querySelector('button[aria-label="Increase speed"]').click())
    expect(stored()).toBe(8.5)
  })

  // A timed exercise runs itself (Workout.jsx chainHold): the next hold starts on a row this
  // view's pointer never moved to, and while it runs the view shows the set being held.
  it('shows the set a running hold is on, for this exercise only', () => {
    mount({ id: 'plank', target: { mode: 'time', sec: 30 }, sets: [{ sec: 30, w: 0, done: true }, { sec: 30, w: 0, done: true }, { sec: 30, w: 0, done: false }] })
    const active = () => [...container.querySelectorAll('.focus-dots button')].findIndex(b => b.classList.contains('active'))
    expect(active()).toBe(2)                                      // the first open set, as before
    act(() => useUI.setState({ work: { left: 20, total: 30, endsAt: Date.now() + 20_000, label: 'Plank', owner: { idx: 0, i: 1, id: 'plank' } } }))
    expect(active()).toBe(1)
    act(() => useUI.setState({ work: { left: 20, total: 30, endsAt: Date.now() + 20_000, label: 'x', owner: { idx: 0, i: 0, id: 'not-this-one' } } }))
    expect(active()).toBe(2)
    act(() => useUI.setState({ work: null }))
    expect(active()).toBe(2)
  })
})
