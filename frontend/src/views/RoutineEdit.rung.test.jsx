// @vitest-environment happy-dom
// A calisthenics chain: the routine row shows the exercise of the track's current rung, while the
// settings sheet it opens still edits the occurrence itself.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sheets = vi.hoisted(() => ({
  exConfigSheet: vi.fn(), exercisePicker: vi.fn(), glyphPicker: vi.fn(), confirmSheet: vi.fn(),
  occurrenceSummary: vi.fn(() => ''), quickOccurrence: vi.fn(),
}))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../sheets.jsx', () => sheets)
vi.mock('../components/Media.jsx', () => ({ Thumb: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null }))

import RoutineEdit from './RoutineEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { EXIDX } from '../lib/exercises.js'
import { exerciseNameFor } from '../lib/i18n.js'
import { ruleOccurrence } from '../lib/test-fixtures.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const slot = ruleOccurrence('0652', { occurrenceId: 'occ-pull', preset: 'bodyweight_ladder', options: { rungs: [{ name: 'Assisted', exerciseId: '0017' }, 'Pull-up'] } })
let root, host

beforeEach(() => {
  Object.values(sheets).forEach(mock => mock.mockReset())
  const S = clone(DEF)
  S.routines = [{ id: 'r1', name: 'Pull', emoji: 'dumbbell', ex: [clone(slot)] }]
  useStore.setState({ S, user: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={['/plan/r/r1']}><Routes><Route path="/plan/r/:id" element={<RoutineEdit />} /></Routes></MemoryRouter>))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('RoutineEdit — a chain of exercises', () => {
  it('shows the current rung\'s exercise on the row', () => {
    expect(host.querySelector('[data-routine-row] .tt').textContent).toBe(exerciseNameFor(EXIDX['0017']))
  })

  it('opens the occurrence\'s own exercise, so a Save keeps it', () => {
    act(() => host.querySelector('[data-routine-row] .item').click())
    const [ex, existing, onSave] = sheets.exConfigSheet.mock.calls[0]
    expect(ex.id).toBe('0652')
    act(() => onSave({ ...existing }))
    expect(useStore.getState().S.routines[0].ex[0].exerciseId).toBe('0652')
  })
})
