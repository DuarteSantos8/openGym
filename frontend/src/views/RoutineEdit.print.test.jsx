// @vitest-environment happy-dom
// #282: a single routine goes to paper from its editor — the browser's print dialog on the web,
// the native print flow in the app.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../sheets.jsx', () => ({ exConfigSheet: vi.fn(), exercisePicker: vi.fn(), glyphPicker: vi.fn(), confirmSheet: vi.fn(), printPlanSheet: vi.fn() }))
vi.mock('../components/Media.jsx', () => ({ Thumb: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null }))

import RoutineEdit from './RoutineEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { printPlanSheet } from '../sheets.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host

function mount(ex, name = 'Push day') {
  const S = JSON.parse(JSON.stringify(DEF))
  S.routines = [{ id: 'r1', name, emoji: 'dumbbell', ex }]
  useStore.setState({ S, user: { id: 'u1', name: 'Ana' } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={['/plan/r/r1']}><Routes><Route path="/plan/r/:id" element={<RoutineEdit />} /></Routes></MemoryRouter>))
}
const printButton = () => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Print / Save as PDF')

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

// The print itself (web dialog or the phone's print sheet, with or without pictures) is the
// print sheet's: components/PrintPlanSheet.test.jsx, lib/plan-print.test.js printPlan.
describe('RoutineEdit — print this routine (#282)', () => {
  it('opens the print step for this routine alone, named after it', () => {
    mount([{ id: '0025', sets: 3, mode: 'reps', reps: 5, weight: 80 }])
    act(() => printButton().click())
    expect(printPlanSheet).toHaveBeenCalledOnce()
    expect(printPlanSheet).toHaveBeenCalledWith({ routineId: 'r1', name: 'Push day' })
  })

  it('names the print job even when the routine has no name, which Android refuses', () => {
    mount([{ id: '0025', sets: 3, mode: 'reps', reps: 5, weight: 80 }], '')
    act(() => printButton().click())
    expect(printPlanSheet.mock.calls[0][0].name).toBe('Routine')
  })

  it('has nothing to print for an empty routine', () => {
    mount([])
    expect(printButton().disabled).toBe(true)
  })
})
