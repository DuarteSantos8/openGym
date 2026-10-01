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

function mount(entry) {
  const S = clone(DEF)
  S.unit = 'lb'
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
