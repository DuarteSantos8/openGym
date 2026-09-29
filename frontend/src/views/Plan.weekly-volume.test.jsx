// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import Plan from './Plan.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  dayAssignSheet: vi.fn(), dayAddRoutineSheet: vi.fn(), starterPlanSheet: vi.fn(), planToolsSheet: vi.fn(),
}))

const press = { id: 'press', n: 'Press', primaries: ['chest'], secondaries: ['triceps'], custom: true }
const routines = [{ id: 'push', name: 'Push', emoji: null, ex: [{ id: press.id, sets: 2 }] }]
let host, root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  useStore.setState(s => ({
    S: { ...s.S, lang: 'en', routines, customEx: [press], week: { 1: ['push'] }, dayPlan: {}, workouts: [] },
    user: null,
  }))
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = () => act(() => root.render(<Plan />))
const summary = () => host.querySelector('[data-weekly-muscle-volume]')

describe('Plan — weekly muscle volume', () => {
  it('shows every non-zero effective-set total from the recurring schedule', () => {
    mount()
    expect(summary().textContent).toContain('Weekly muscle volume')
    expect(summary().textContent).toContain('Chest2 sets')
    expect(summary().textContent).toContain('Triceps0.8 sets')
  })

  it('updates when the live weekly schedule changes', () => {
    mount()
    act(() => useStore.setState(s => ({ S: { ...s.S, week: { 1: ['push'], 3: 'push' } } })))
    expect(summary().textContent).toContain('Chest4 sets')
    expect(summary().textContent).toContain('Triceps1.6 sets')
  })

  it('keeps the summary mounted when the recurring plan has no volume', () => {
    useStore.setState(s => ({ S: { ...s.S, week: { 1: ['stale'] } } }))
    mount()
    expect(summary().textContent).toContain('No muscle volume planned.')
    expect(summary().querySelector('.mrow')).toBeNull()
  })
})
