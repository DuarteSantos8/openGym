// @vitest-environment happy-dom
// Move / copy a planned exercise to another routine from the exercise settings sheet.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sheets = vi.hoisted(() => ({
  exConfigSheet: vi.fn(), exercisePicker: vi.fn(), glyphPicker: vi.fn(), confirmSheet: vi.fn(),
  transferToRoutineSheet: vi.fn(),
}))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../sheets.jsx', () => sheets)
vi.mock('../components/Media.jsx', () => ({ Thumb: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null }))
vi.mock('../lib/nav.js', () => ({ nav: vi.fn(), closeThenNav: vi.fn(), navToWorkout: vi.fn() }))

import RoutineEdit, { transferRoutineExerciseAction, undoTransferRoutineExercise } from './RoutineEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { nav } from '../lib/nav.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const BENCH = '0025', ROW = '0027'
let root, host

function mount(routines) {
  const S = clone(DEF)
  S.routines = routines
  useStore.setState({ S, user: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={['/plan/r/r1']}><Routes><Route path="/plan/r/:id" element={<RoutineEdit />} /></Routes></MemoryRouter>))
}

beforeEach(() => {
  localStorage.clear()
  Object.values(sheets).forEach(mock => mock.mockReset())
  nav.mockReset()
  useUI.setState({ toastMsg: '', toastAction: null })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('RoutineEdit — transfer exercise between routines', () => {
  it('offers Move and Copy on the exercise settings sheet', () => {
    mount([
      { id: 'r1', name: 'Push', emoji: 'dumbbell', ex: [{ id: BENCH, sets: 3, mode: 'reps', reps: 8, weight: 60 }] },
      { id: 'r2', name: 'Pull', emoji: 'pullup', ex: [] },
    ])
    act(() => host.querySelector('[data-routine-row] .item .tap-main').click())
    const opts = sheets.exConfigSheet.mock.calls[0][8]
    expect(opts.onMove).toBeTypeOf('function')
    expect(opts.onCopy).toBeTypeOf('function')
    act(() => opts.onMove())
    expect(sheets.transferToRoutineSheet).toHaveBeenCalledOnce()
    const [ex, fromId, index, mode] = sheets.transferToRoutineSheet.mock.calls[0]
    expect(ex.id).toBe(BENCH)
    expect(fromId).toBe('r1')
    expect(index).toBe(0)
    expect(mode).toBe('move')
  })

  it('moves the slot to the chosen routine with Undo', () => {
    const slot = { id: BENCH, sets: 4, mode: 'reps', reps: 6, weight: 80, note: 'pause', sg: 'g1' }
    mount([
      { id: 'r1', name: 'Push', emoji: 'dumbbell', ex: [clone(slot), { id: ROW, sets: 3, mode: 'reps', reps: 10, weight: 50, sg: 'g1' }] },
      { id: 'r2', name: 'Pull', emoji: 'pullup', ex: [] },
    ])
    act(() => { transferRoutineExerciseAction('r1', 0, 'r2', 'move') })
    const routines = () => useStore.getState().S.routines
    expect(routines()[0].ex.map(e => e.id)).toEqual([ROW])
    expect(routines()[0].ex[0].sg).toBeUndefined()
    expect(routines()[1].ex).toEqual([{ id: BENCH, sets: 4, mode: 'reps', reps: 6, weight: 80, note: 'pause' }])
    expect(useUI.getState().toastMsg).toBe('“Barbell Bench Press” moved to Pull')
    const pending = useUI.getState().toastAction
    expect(pending.label).toBe('Undo')
    act(() => pending.run())
    expect(routines()[0].ex.map(e => e.id)).toEqual([BENCH, ROW])
    expect(routines()[1].ex).toEqual([])
  })

  it('copies without removing the source, and creating a new routine navigates there', () => {
    mount([
      { id: 'r1', name: 'Push', emoji: 'dumbbell', ex: [{ id: BENCH, sets: 3, mode: 'reps', reps: 8, weight: 60 }] },
    ])
    act(() => { transferRoutineExerciseAction('r1', 0, '_new', 'copy') })
    const routines = useStore.getState().S.routines
    expect(routines).toHaveLength(2)
    expect(routines[0].ex).toHaveLength(1)
    expect(routines[1].ex).toEqual([{ id: BENCH, sets: 3, mode: 'reps', reps: 8, weight: 60 }])
    expect(routines[1].name).toBe('New routine')
    expect(nav).toHaveBeenCalledWith('/plan/r/' + routines[1].id)
    expect(useUI.getState().toastMsg).toBe('“Barbell Bench Press” copied to New routine')
  })
})

describe('undoTransferRoutineExercise', () => {
  it('re-inserts when the lists have changed since the move', () => {
    useStore.setState({
      S: {
        ...clone(DEF),
        routines: [
          { id: 'r1', name: 'Push', ex: [{ id: ROW, sets: 3, mode: 'reps', reps: 10, weight: 50 }] },
          { id: 'r2', name: 'Pull', ex: [{ id: BENCH, sets: 4, mode: 'reps', reps: 6, weight: 80 }, { id: 'extra', sets: 2, mode: 'reps', reps: 12, weight: 20 }] },
        ],
      },
      user: null,
    })
    const slot = { id: BENCH, sets: 4, mode: 'reps', reps: 6, weight: 80 }
    undoTransferRoutineExercise({
      fromId: 'r1', toId: 'r2', index: 0, slot,
      fromBefore: [slot, { id: ROW, sets: 3, mode: 'reps', reps: 10, weight: 50 }],
      fromAfter: JSON.stringify([{ id: ROW, sets: 3, mode: 'reps', reps: 10, weight: 50 }]),
      fromBase: 0, fromDel: 1,
      targetBefore: [],
      targetAfter: JSON.stringify([slot]),
      targetBase: 0, targetDel: 1,
    })
    const routines = useStore.getState().S.routines
    expect(routines[0].ex.map(e => e.id)).toEqual([BENCH, ROW])
    expect(routines[1].ex.map(e => e.id)).toEqual(['extra'])
  })
})
