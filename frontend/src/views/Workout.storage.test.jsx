// @vitest-environment happy-dom
//
// Deliberate departure from the task brief's literal Step-1 skeleton: it imported render/screen/
// fireEvent from @testing-library/react, which is not a dependency of this project (frontend is
// React + Router + Zustand only — CONTRIBUTING.md's dependency-light constraint, a "hard sell"
// for anything new) and is not installed anywhere in this repo. The brief's own comment says to
// mirror the harness the existing Workout tests use rather than inventing a second one — and the
// harness this repo actually uses for a real store + real Workout.jsx + real DOM (as opposed to
// Workout.test.jsx's fully-mocked store) is the `@vitest-environment happy-dom` + react-dom/client
// createRoot/act pattern already proven in views/Workout.remove.test.jsx and
// sheets.workoutview.test.jsx. This file follows that pattern instead — same assertions, same
// real modules, no new dependency.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'gym_state_v1'
const ACTIVE_KEY = 'gym_active_v1'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => { localStorage.clear(); vi.resetModules() })

describe('logging a set does not touch the profile (A29, A30)', () => {
  it('a set toggle writes only gym_active_v1', async () => {
    const { useStore } = await import('../store/useStore.js')
    const Workout = (await import('./Workout.jsx')).default
    useStore.getState().update(s => { s.unit = 'kg' })
    useStore.getState().setActive({
      id: 'a1', d: '2026-09-22', start: 1, name: 'Push', cur: 0,
      entries: [{ id: 'bench-press', target: { reps: 8, weight: 60 }, sets: [{ w: 60, r: 8, done: false }] }]
    })
    const profileBefore = localStorage.getItem(KEY)
    const tsBefore = useStore.getState().S._ts

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => { root.render(<MemoryRouter><Workout /></MemoryRouter>) })

    const checkbox = container.querySelector('[role="checkbox"]')
    expect(checkbox).toBeTruthy()
    act(() => { checkbox.dispatchEvent(new Event('click', { bubbles: true })) })

    expect(JSON.parse(localStorage.getItem(ACTIVE_KEY)).entries[0].sets[0].done).toBe(true)
    expect(localStorage.getItem(KEY)).toBe(profileBefore)
    expect(useStore.getState().S._ts).toBe(tsBefore)

    act(() => { root.unmount() })
    container.remove()
  })
})

describe('finish and discard (A31, A32)', () => {
  it('finish writes the workout into S once and clears A and the key (A31)', async () => {
    const { useStore } = await import('../store/useStore.js')
    const { finishWorkout } = await import('../sheets.jsx')
    useStore.getState().setActive({
      id: 'a1', d: '2026-09-22', start: 1, name: 'Push', cur: 0,
      entries: [{ id: 'bench-press', target: { reps: 8, weight: 60 }, sets: [{ w: 60, r: 8, done: true }] }]
    })
    // happy-dom's localStorage implements setItem as its own instance property, not one
    // inherited via Storage.prototype — spying on the prototype silently misses every real
    // call, so the spy has to sit on the instance itself.
    const setItem = vi.spyOn(localStorage, 'setItem')
    finishWorkout()
    expect(useStore.getState().S.workouts).toHaveLength(1)
    expect(useStore.getState().A).toBe(null)
    expect(localStorage.getItem(ACTIVE_KEY)).toBe(null)
    expect(setItem.mock.calls.filter(c => c[0] === KEY)).toHaveLength(1)
    setItem.mockRestore()
  })
  it('discard clears A and the key and leaves S untouched (A32)', async () => {
    const { useStore } = await import('../store/useStore.js')
    useStore.getState().update(s => { s.unit = 'kg' })
    const profileBefore = localStorage.getItem(KEY)
    useStore.getState().setActive({ id: 'a1', d: '2026-09-22', start: 1, name: 'Push', cur: 0, entries: [] })
    useStore.getState().clearActive()
    expect(useStore.getState().A).toBe(null)
    expect(localStorage.getItem(ACTIVE_KEY)).toBe(null)
    expect(localStorage.getItem(KEY)).toBe(profileBefore)
  })
})

describe('PUT /api/data carries no session (A33)', () => {
  it('the pushed body has no active field', async () => {
    const api = await import('../lib/api.js')
    const spy = vi.spyOn(api, 'api').mockResolvedValue({ rev: 1 })
    const { useStore } = await import('../store/useStore.js')
    useStore.setState({ user: { id: 'u1' }, ready: true })
    useStore.getState().setActive({ id: 'a1', d: '2026-09-22', start: 1, name: 'Push', cur: 0, entries: [] })
    useStore.getState().update(s => { s.unit = 'kg' })
    await useStore.getState().pushState()
    const body = JSON.parse(spy.mock.calls.find(c => c[0] === '/api/data')[1].body)
    expect(body.state.active).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('"a1"')
    spy.mockRestore()
  })
})
