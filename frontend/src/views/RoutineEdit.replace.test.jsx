// @vitest-environment happy-dom
// Replace exercise in the routine editor (#110): the exercise's settings sheet offers Replace,
// the picker chooses the new exercise, and the slot keeps its place and its numbers.
import React, { act } from 'react'
import { planPhase } from '../lib/prescription/index.js'
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
import { useUI } from '../store/useUI.js'
import { EXIDX } from '../lib/exercises.js'
import { ruleOccurrence } from '../lib/test-fixtures.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const BENCH = '0025', DB_BENCH = '0289', ROW = '0027'
const benchSlot = { ...ruleOccurrence(BENCH, { occurrenceId: 'occ-bench' }), sg: 'g1', note: 'touch and go' }
const rowSlot = { ...ruleOccurrence(ROW, { occurrenceId: 'occ-row' }), sg: 'g1' }
let root, host, picker

function mount() {
  const S = clone(DEF)
  S.routines = [{ id: 'r1', name: 'Push', emoji: 'dumbbell', ex: [clone(benchSlot), clone(rowSlot)] }]
  useStore.setState({ S, user: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={['/plan/r/r1']}><Routes><Route path="/plan/r/:id" element={<RoutineEdit />} /></Routes></MemoryRouter>))
}
const slots = () => useStore.getState().S.routines[0].ex
// Tap the first row, then Replace on its settings sheet: the picker it opens is returned.
function openReplace() {
  act(() => host.querySelector('[data-routine-row] .item').click())
  const onReplace = sheets.exConfigSheet.mock.calls[0][6]
  expect(onReplace).toBeTypeOf('function')
  act(() => onReplace())
  expect(sheets.exercisePicker).toHaveBeenCalledOnce()
  const [onPick, opts] = sheets.exercisePicker.mock.calls[0]
  // #473: the picker is told what it replaces, so it opens on the same muscle.
  expect(opts).toEqual({ title: 'Replace exercise', like: BENCH })
  return onPick
}

beforeEach(() => {
  localStorage.clear()
  Object.values(sheets).forEach(mock => mock.mockReset())
  picker = { close: vi.fn() }
  sheets.exercisePicker.mockImplementation(() => picker)
  useUI.setState({ toastMsg: '' })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('RoutineEdit — Replace exercise', () => {
  it('"+" on a picker row swaps the exercise in place: same rule and note, same superset, its own progression line', () => {
    mount()
    const onPick = openReplace()
    act(() => onPick(EXIDX[DB_BENCH], true))
    const [swapped, untouched] = slots()
    expect(swapped).toMatchObject({ exerciseId: DB_BENCH, sg: 'g1', note: 'touch and go' })
    expect(swapped.occurrenceId).not.toBe('occ-bench')
    expect(swapped.rule).toMatchObject({ id: swapped.occurrenceId, exerciseId: DB_BENCH, preset: 'linear' })
    expect(planPhase(swapped.rule).parameters).toEqual(planPhase(benchSlot.rule).parameters)
    expect(untouched).toEqual(rowSlot)
    expect(picker.close).toHaveBeenCalledOnce()
    expect(useUI.getState().toastMsg).toBe('Replaced with “Dumbbell Bench Press”')
  })

  it('a tapped picker row opens the new exercise\'s settings at the slot\'s rule first', () => {
    mount()
    const onPick = openReplace()
    act(() => onPick(EXIDX[DB_BENCH], false))
    // No replace yet: the settings sheet for the new exercise is open, seeded with the slot.
    expect(slots()[0].exerciseId).toBe(BENCH)
    const [ex, seeded, onSave, onDelete, , , , saveLabel] = sheets.exConfigSheet.mock.calls[1]
    expect(ex.id).toBe(DB_BENCH)
    expect(seeded).toMatchObject({ exerciseId: DB_BENCH, sg: 'g1', note: 'touch and go' })
    expect(onDelete).toBeNull()
    // Saving there puts the exercise into the slot, and the button says so.
    expect(saveLabel).toBe('Replace')
    const saved = { occurrenceId: 'occ-new', exerciseId: DB_BENCH, rule: seeded.rule }
    act(() => onSave(saved))
    // Saved as the sheet left it, in the same place and the same superset.
    expect(slots()[0]).toEqual({ ...saved, sg: 'g1' })
    expect(slots()[1]).toEqual(rowSlot)
    expect(picker.close).toHaveBeenCalledOnce()
  })

  it('"+" on the exercise already in the slot changes nothing and says nothing', () => {
    mount()
    const onPick = openReplace()
    act(() => onPick(EXIDX[BENCH], true))
    expect(slots()).toEqual([benchSlot, rowSlot])
    expect(picker.close).toHaveBeenCalledOnce()
    expect(useUI.getState().toastMsg).toBe('')
  })

  it('seeds the new exercise\'s settings from the slot as it is now, not as the editor last drew it', () => {
    mount()
    const onPick = openReplace()
    // Another device edits the bench's note while the picker is open.
    act(() => useStore.getState().update(s => { s.routines[0].ex[0].note = 'changed elsewhere' }))
    act(() => onPick(EXIDX[DB_BENCH], false))
    expect(sheets.exConfigSheet.mock.calls[1][1]).toMatchObject({ exerciseId: DB_BENCH, note: 'changed elsewhere' })
  })

  it('leaves a slot alone that changed under the picker', () => {
    mount()
    const onPick = openReplace()
    // Another device's routine arrives while the picker is open: the rows moved.
    act(() => useStore.getState().update(s => { s.routines[0].ex.reverse() }))
    act(() => onPick(EXIDX[DB_BENCH], true))
    expect(slots().map(e => e.exerciseId)).toEqual([ROW, BENCH])
    expect(useUI.getState().toastMsg).toBe('')
  })
})
