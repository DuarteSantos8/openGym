// @vitest-environment happy-dom
// #282: a single routine goes to paper from its editor — the browser's print dialog on the web,
// the native print flow in the app.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../sheets.jsx', () => ({ exConfigSheet: vi.fn(), exercisePicker: vi.fn(), glyphPicker: vi.fn(), confirmSheet: vi.fn(), printPlanSheet: vi.fn(), menuSheet: vi.fn(), occurrenceSummary: vi.fn(() => ''), quickOccurrence: vi.fn() }))
vi.mock('../components/Media.jsx', () => ({ Thumb: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null }))

import RoutineEdit from './RoutineEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { ruleOccurrence } from '../lib/test-fixtures.js'
import { printPlanSheet, menuSheet } from '../sheets.jsx'

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
const printItem = () => {
  act(() => host.querySelector('button[aria-label="More"]').click())
  return menuSheet.mock.calls.at(-1)[0].sections.flatMap(section => section.items).find(item => item.label === 'Print / Save as PDF')
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

// The print itself (web dialog or the phone's print sheet, with or without pictures) is the
// print sheet's: components/PrintPlanSheet.test.jsx, lib/plan-print.test.js printPlan.
describe('RoutineEdit — print this routine (#282)', () => {
  it('opens the print step for this routine alone, named after it', () => {
    mount([ruleOccurrence('0025', { options: { sets: { min: 3, max: 3 }, reps: { min: 5, max: 5 }, load: { mode: 'absolute', value: 80, unit: 'kg' } } })])
    act(() => printItem().onClick())
    expect(printPlanSheet).toHaveBeenCalledOnce()
    expect(printPlanSheet).toHaveBeenCalledWith({ routineId: 'r1', name: 'Push day' })
  })

  it('names the print job even when the routine has no name, which Android refuses', () => {
    mount([ruleOccurrence('0025', { options: { sets: { min: 3, max: 3 }, reps: { min: 5, max: 5 }, load: { mode: 'absolute', value: 80, unit: 'kg' } } })], '')
    act(() => printItem().onClick())
    expect(printPlanSheet.mock.calls[0][0].name).toBe('Routine')
  })

  it('has nothing to print for an empty routine', () => {
    mount([])
    expect(printItem().disabled).toBe(true)
  })
})
