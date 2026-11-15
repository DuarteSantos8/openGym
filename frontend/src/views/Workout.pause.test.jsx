// @vitest-environment happy-dom
// #976: Pause from the header's ⋯, against the real store and timers: the clock stands, a running
// rest holds, the screen says so with Resume, and a set ticked while paused carries on.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), appBase: () => '/' }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = v => JSON.parse(JSON.stringify(v))
let root, container, sheetRoot, sheetContainer

function mount() {
  const S = clone(DEF)
  S.weighIn = false
  S.active = { id: 's', d: '2026-11-03', start: Date.now() - 600_000, routineIds: [], name: 'Push', bw: null, cur: 0, workoutView: 'list',
    entries: [{ id: '0025', target: { sets: 2, reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: false }, { w: 60, r: 5, done: false }] }] }
  useStore.setState({ S, user: null })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}
function renderTopSheet() {
  if (sheetRoot) act(() => sheetRoot.unmount())
  if (sheetContainer) sheetContainer.remove()
  const sheet = useUI.getState().sheets.at(-1)
  sheetContainer = document.createElement('div'); document.body.appendChild(sheetContainer); sheetRoot = createRoot(sheetContainer)
  act(() => sheetRoot.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return sheetContainer
}
const menuItem = label => {
  act(() => container.querySelector('button[aria-label="Workout options"]').click())
  return [...renderTopSheet().querySelectorAll('.menu-item')].find(it => it.querySelector('.tt')?.textContent === label)
}
const A = () => useStore.getState().S.active

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
})
afterEach(() => {
  if (sheetRoot) act(() => sheetRoot.unmount())
  if (sheetContainer) sheetContainer.remove()
  act(() => root.unmount()); container.remove()
  useUI.getState().stopRest()
  vi.clearAllTimers(); vi.useRealTimers()
  sheetRoot = null; sheetContainer = null
})

describe('pausing a workout (#976)', () => {
  it('holds the clock and the rest, says so, and Resume carries on', () => {
    mount()
    act(() => useUI.getState().startRest(90, 0))
    const item = menuItem('Pause workout')
    expect(item).toBeTruthy()
    act(() => item.click())
    expect(A().pausedAt).toBeGreaterThan(0)
    expect(useUI.getState().timer.paused).toBe(true)
    expect(container.querySelector('.wpause')?.textContent).toContain('Workout paused')
    const clock = container.querySelector('.whdr-mid .sub').textContent
    act(() => vi.advanceTimersByTime(5 * 60_000))
    expect(container.querySelector('.whdr-mid .sub').textContent).toBe(clock)
    const start = A().start
    act(() => [...container.querySelectorAll('.wpause button')].find(b => b.textContent === 'Resume').click())
    expect(A().pausedAt).toBeUndefined()
    expect(A().start).toBe(start + 5 * 60_000)
    expect(useUI.getState().timer.paused).toBeFalsy()
    expect(container.querySelector('.wpause')).toBeNull()
  })

  it('a set ticked while paused resumes the workout', () => {
    mount()
    const item = menuItem('Pause workout')
    act(() => item.click())
    expect(A().pausedAt).toBeGreaterThan(0)
    act(() => container.querySelector('button.chk[aria-label^="Set 1 done"]').click())
    expect(A().entries[0].sets[0].done).toBe(true)
    expect(A().pausedAt).toBeUndefined()
  })
})
