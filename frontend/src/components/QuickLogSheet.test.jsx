// @vitest-environment happy-dom
// History → "Type a workout": every line says what it was read as before anything is saved, a line
// that cannot be saved says why, and Save files the workout through lib/log-workout.js.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ S: null, toast: vi.fn(), picker: vi.fn(), onPick: null, updates: 0 }))
vi.mock('../store/useStore.js', () => {
  const update = fn => { const d = JSON.parse(JSON.stringify(mocks.S)); fn(d); mocks.S = d; mocks.updates++ }
  const snap = () => ({ S: mocks.S, update })
  const useStore = selector => (selector ? selector(snap()) : snap())
  useStore.getState = snap
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: mocks.toast, openSheet: vi.fn() })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
// The library picker lives in the big sheets module; here it is a function that answers at once.
vi.mock('../sheets.jsx', () => ({ exercisePicker: (onPick, opts) => { mocks.picker(opts); mocks.onPick = onPick; return { close: vi.fn() } } }))

const { QuickLog, quickLogSheet } = await import('./QuickLogSheet.jsx')

let root, host, close
beforeEach(() => {
  mocks.toast.mockClear(); mocks.picker.mockClear(); mocks.updates = 0
  mocks.S = { unit: 'kg', workouts: [], routines: [], customEx: [], exAliases: {}, exWeights: {}, deleted: {}, edited: {} }
  close = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<QuickLog close={close} />))
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const type = value => act(() => {
  const el = host.querySelector('[data-quick-log]')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const rows = () => [...host.querySelectorAll('[data-quick-log-row]')]
const saveButton = () => [...host.querySelectorAll('button')].find(b => b.textContent.startsWith('Save'))

describe('QuickLog sheet', () => {
  it('shows each line as the exercise and sets it was read as', () => {
    type('Bench press 60x8, 60x8, 62.5x6\nPlank 3x60s')
    expect(rows().map(r => r.dataset.quickLogRow)).toEqual(['ok', 'ok'])
    expect(rows()[0].textContent).toMatch(/bench press/i)
    expect(rows()[0].textContent).toContain('60 × 8 · 60 × 8 · 62.5 × 6 kg')
    expect(rows()[1].textContent).toContain('1:00 · 1:00 · 1:00')
    expect(saveButton().disabled).toBe(false)
    expect(saveButton().textContent).toBe('Save · 2 exercises · 6 sets')
  })

  it('a line that cannot be saved says why, and Save waits for it', () => {
    type('Bench press 60x8\nSquat 100kg')
    expect(rows()[1].dataset.quickLogRow).toBe('reps')
    expect(rows()[1].textContent).toContain('How many reps?')
    expect(saveButton().disabled).toBe(true)
  })

  it('words besides the sets show as the note they will be saved as', () => {
    type('Squat 3x5 100 felt heavy')
    expect(rows()[0].dataset.quickLogRow).toBe('ok')
    expect(rows()[0].textContent).toContain('Note: felt heavy')
  })

  it('a number or sign it could not place is shown, and Save waits for it', () => {
    type('Bench press 60x8-10')
    expect(rows()[0].dataset.quickLogRow).toBe('unread')
    expect(rows()[0].textContent).toContain('Not read: -')
    expect(saveButton().disabled).toBe(true)
  })

  it('Save files the workout, says so and closes', () => {
    type('Bench press 60x8, 60x8')
    act(() => saveButton().click())
    expect(mocks.updates).toBe(1)
    expect(mocks.S.workouts).toHaveLength(1)
    expect(mocks.S.workouts[0].entries[0]).toMatchObject({ id: '0025', sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: true }] })
    expect(mocks.toast).toHaveBeenCalledWith('Workout saved')
    expect(close).toHaveBeenCalled()
  })

  it('the same workout twice is not filed again', () => {
    type('Bench press 60x8')
    act(() => saveButton().click())
    act(() => root.render(<QuickLog close={close} />))
    act(() => saveButton().click())
    expect(mocks.S.workouts).toHaveLength(1)
    expect(mocks.toast).toHaveBeenLastCalledWith('That workout is already in your history.')
  })

  it('tapping a line picks another exercise for that name', () => {
    type('bench 60x8')
    act(() => rows()[0].querySelector('button').click())
    expect(mocks.picker).toHaveBeenCalledWith(expect.objectContaining({ title: 'bench', like: '0025' }))
    act(() => mocks.onPick({ id: '0289' }))
    expect(rows()[0].textContent).toMatch(/dumbbell bench press/i)
    // the typed name stays visible beside the exercise it now stands for
    expect(rows()[0].textContent).toContain('bench')
  })

  it('not while a workout is running', () => {
    mocks.S = { ...mocks.S, active: { id: 'a', entries: [] } }
    quickLogSheet()
    expect(mocks.toast).toHaveBeenCalledWith('Finish the current workout first.')
  })
})
