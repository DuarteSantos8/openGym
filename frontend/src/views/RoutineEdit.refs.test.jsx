// @vitest-environment happy-dom
// The routine's own 1RM preference (routine.refs, spec 6.1), shown only for a routine that works
// from a 1RM, and the review by hand of a newer 1RM for an exercise set to keep its own (spec 10.2).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../sheets.jsx', () => ({ exConfigSheet: vi.fn(), exercisePicker: vi.fn(), glyphPicker: vi.fn(), confirmSheet: vi.fn(), referenceSheet: vi.fn(), occurrenceSummary: () => '' }))
vi.mock('../components/Media.jsx', () => ({ Thumb: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null }))

import RoutineEdit from './RoutineEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { referenceSheet } from '../sheets.jsx'
import { bindUI } from '../components/ui.jsx'
import { ruleOccurrence } from '../lib/test-fixtures.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
bindUI(useUI)
let root, host
const BENCH = '0025'
const ref = (id, value, capturedAt) => ({ id, exerciseId: BENCH, value, unit: 'kg', source: 'estimated', capturedAt })

function mount(occ, more = {}) {
  const S = { ...JSON.parse(JSON.stringify(DEF)), routines: [{ id: 'r1', name: 'Push day', emoji: 'dumbbell', ex: [occ] }], ...more }
  useStore.setState({ S, user: null })
  useUI.setState({ sheets: [] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={['/plan/r/r1']}><Routes><Route path="/plan/r/:id" element={<RoutineEdit />} /></Routes></MemoryRouter>))
}
const rowOf = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('a routine\'s 1RM preference', () => {
  it('shows only for a routine worked from a 1RM, writes routine.refs, and offers a kept 1RM for review by hand', () => {
    mount(ruleOccurrence(BENCH, { occurrenceId: 'o1' }))
    expect(rowOf('New 1RM estimates')).toBeUndefined()
    act(() => root.unmount()); host.remove()

    const occ = { ...ruleOccurrence(BENCH, { occurrenceId: 'o1', options: { load: { mode: 'percent_1rm', percent: 70 }, step: { type: 'percentage_points', value: 2.5 } } }), ref: ref('b1', 100, '2026-10-01T10:00:00.000Z') }
    mount(occ, { oneRepMaxes: { b1: occ.ref, b2: ref('b2', 110, '2026-10-20T10:00:00.000Z') } })
    expect(rowOf('New 1RM estimates').querySelector('.lrow-s').textContent).toBe('Use my default (Ask me first)')
    // Asked about by itself: nothing to review here.
    expect(rowOf('New 1RM for Barbell Bench Press')).toBeUndefined()
    act(() => rowOf('New 1RM estimates').click())
    const picker = document.createElement('div'); document.body.appendChild(picker)
    const r = createRoot(picker)
    act(() => r.render(useUI.getState().sheets.at(-1).render(() => {})))
    act(() => [...picker.querySelectorAll('button.lrow')].find(b => b.querySelector('.lrow-t').textContent === 'Keep the one in use').click())
    act(() => r.unmount()); picker.remove()
    expect(useStore.getState().S.routines[0].refs).toBe('keep')
    const review = rowOf('New 1RM for Barbell Bench Press')
    expect(review.querySelector('.lrow-s').textContent).toBe('You keep the 1RM in use. Review the newer one here.')
    act(() => review.click())
    expect(referenceSheet).toHaveBeenCalledWith(expect.objectContaining({ exerciseId: BENCH, to: expect.objectContaining({ value: 110 }), contexts: [expect.objectContaining({ key: 'occ:o1', routineId: 'r1' })] }))
  })
})
