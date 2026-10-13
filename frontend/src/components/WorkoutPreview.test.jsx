// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import WorkoutPreparation, { ExercisePreview } from './WorkoutPreview.jsx'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { beginWorkout, repeatWorkout } from '../sheets.jsx'
import { setNav } from '../lib/nav.js'

vi.mock('./Media.jsx', () => ({ default: ({ ex }) => <div data-media={ex.id} /> }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host, original
beforeEach(() => {
  vi.useFakeTimers()
  original = useStore.getState().S
  useStore.setState({ S: { ...original, active: null, routines: [{ id: 'r', name: 'Test', ex: [{ id: '0025', sets: 2, reps: 8 }] }], weighIn: false } })
  setNav(() => {})
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  useUI.getState().stopRest()
  useStore.setState({ S: original })
  host.remove()
  vi.useRealTimers()
})
const mount = () => act(() => root.render(<MemoryRouter><WorkoutPreparation /></MemoryRouter>))
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent === text)

it('new sessions show preparation without running the clock, then start only on Ready', () => {
  act(() => beginWorkout(['r'], null))
  mount()
  expect(host.querySelector('[data-media="0025"]')).not.toBeNull()
  act(() => vi.advanceTimersByTime(120000))
  expect(useStore.getState().S.active.start).toBe(0)
  // Leaving and reopening preparation must not start it either.
  act(() => root.render(null))
  mount()
  expect(useStore.getState().S.active.preparing).toBe(true)
  const now = Date.now()
  act(() => button('Ready, start workout').click())
  expect(useStore.getState().S.active.start).toBe(now)
  expect(useStore.getState().S.active.preparing).toBeUndefined()
})

it('repeated workouts prepare too, while starting twice preserves the active session', () => {
  act(() => beginWorkout(['r'], null))
  const first = useStore.getState().S.active
  act(() => beginWorkout([], null))
  expect(useStore.getState().S.active).toBe(first)
  useStore.setState({ S: { ...useStore.getState().S, active: null } })
  act(() => repeatWorkout({ ...first, entries: first.entries.map(e => ({ ...e, sets: e.sets.map(s => ({ ...s, done: true })) })) }))
  expect(useStore.getState().S.active).toMatchObject({ preparing: true, start: 0 })
})

it('empty freestyle waits for an exercise before allowing start', () => {
  act(() => beginWorkout([], null))
  mount()
  expect(button('Ready, start workout').disabled).toBe(true)
  expect(button('Add exercise')).toBeTruthy()
})

it('renders the upcoming exercise media instead of the completed exercise', () => {
  const active = { entries: [{ id: '0025' }, { id: '0047' }] }
  act(() => root.render(<ExercisePreview active={active} next={{ idx: 1, i: 0 }} title="Up next" />))
  expect(host.querySelector('[data-media="0047"]')).not.toBeNull()
  expect(host.querySelector('[data-media="0025"]')).toBeNull()
})
