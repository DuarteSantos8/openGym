// @vitest-environment happy-dom
// A routine's colour reaches the editor too: its body map is shaded in it, not the accent.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../sheets.jsx', () => ({ exConfigSheet: vi.fn(), exercisePicker: vi.fn(), confirmSheet: vi.fn(), printPlanSheet: vi.fn() }))
vi.mock('../components/Media.jsx', () => ({ Thumb: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => <i data-bodymap /> }))

import RoutineEdit from './RoutineEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host

function mount(color) {
  const S = JSON.parse(JSON.stringify(DEF))
  S.routines = [{ id: 'r1', name: 'Push', emoji: 'dumbbell', color, ex: [{ id: '0025', sets: 3, mode: 'reps', reps: 5, weight: 80 }] }]
  useStore.setState({ S, user: { id: 'u1', name: 'Ana' } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={['/plan/r/r1']}><Routes><Route path="/plan/r/:id" element={<RoutineEdit />} /></Routes></MemoryRouter>))
}
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('RoutineEdit body map colour', () => {
  it('is shaded in the routine colour', () => {
    mount('purple')
    expect(host.querySelector('[data-bodymap]').parentElement.style.getPropertyValue('--acc')).toBe('var(--purple)')
  })
  it('keeps the accent when the routine has no colour', () => {
    mount(undefined)
    expect(host.querySelector('[data-bodymap]').parentElement.style.getPropertyValue('--acc')).toBe('')
  })
})
