// @vitest-environment happy-dom
// "Repeat last workout": a routine-wide switch that opens every exercise at last time's numbers
// with no progression rule (lib/session-start.js repeatsLast).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RoutineEdit from './RoutineEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../sheets.jsx', () => ({ glyphPicker: vi.fn(), exercisePicker: vi.fn(), exConfigSheet: vi.fn(), confirmSheet: vi.fn() }))
vi.mock('../components/Media.jsx', () => ({ Thumb: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))

let root
let container

function renderRoutine(routine) {
  const S = clone(DEF)
  S.routines = [{ id: 'r1', name: 'Technique', emoji: 'dumbbell', ex: [], ...routine }]
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(
    <MemoryRouter initialEntries={['/routine/r1']}>
      <Routes><Route path="/routine/:id" element={<RoutineEdit />} /></Routes>
    </MemoryRouter>
  ))
}

const rowTitled = title => [...container.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const note = () => container.querySelector('.sect-b + .small.dim').textContent

beforeEach(() => { localStorage.clear() })
afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
  root = null
  container = null
})

describe('the routine\'s "Repeat last workout" switch', () => {
  it('writes startFromLast only while on', () => {
    renderRoutine({})
    const toggle = () => act(() => rowTitled('Repeat last workout').querySelector('[role="switch"]').click())
    toggle()
    expect(useStore.getState().S.routines[0].startFromLast).toBe(true)
    toggle()
    expect('startFromLast' in useStore.getState().S.routines[0]).toBe(false)
  })

  it('says the progression above does not apply while it is on', () => {
    renderRoutine({ startFromLast: true })
    expect(note()).toBe('This routine repeats your last workout, so the progression above does not apply to it.')
  })

  it('is not offered on a deload routine, which opens at its own numbers', () => {
    renderRoutine({ excludeFromProgression: true, startFromLast: true })
    expect(rowTitled('Repeat last workout')).toBeUndefined()
    expect(note().startsWith('A deload routine opens at the numbers set here')).toBe(true)
  })
})
