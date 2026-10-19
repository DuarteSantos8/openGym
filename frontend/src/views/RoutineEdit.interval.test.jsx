// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import RoutineEdit from './RoutineEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { supersetSheet } from '../sheets.jsx'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../sheets.jsx', () => ({ glyphPicker: vi.fn(), exercisePicker: vi.fn(), exConfigSheet: vi.fn(), confirmSheet: vi.fn(), supersetSheet: vi.fn() }))
vi.mock('../components/Media.jsx', () => ({ Thumb: () => null }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host
afterEach(() => { act(() => root.unmount()); host.remove() })
it('saves interval settings on routine members with numeric counts and reopens their saved values', () => {
  const S = structuredClone(DEF)
  S.routines = [{ id: 'routine', name: 'Routine', ex: [
    { id: '0025', sg: 'pair', sets: 3, reps: 8 }, { id: '0007', sg: 'pair', sets: 4, reps: 8 },
  ] }]
  useStore.setState({ S, user: null })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={['/routine/routine']}><Routes><Route path="/routine/:id" element={<RoutineEdit />} /></Routes></MemoryRouter>))
  act(() => host.querySelector('.ss-label-btn').click())
  const settings = { mode: 'interval', work: 40, intervalRest: 7, roundRest: 0, prep: 5 }
  act(() => supersetSheet.mock.calls.at(-1)[1](settings))
  expect(useStore.getState().S.routines[0].ex.map(e => e.sets)).toEqual([3, 4])
  for (const e of useStore.getState().S.routines[0].ex) expect(e).toMatchObject({ mode: 'time', sec: 40, sgMode: 'interval', sgWork: 40, sgIntervalRest: 7, sgRoundRest: 0, sgPrep: 5 })
  act(() => host.querySelector('.ss-label-btn').click())
  expect(supersetSheet.mock.calls.at(-1)[0]).toMatchObject(settings)
})
