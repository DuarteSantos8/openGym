// @vitest-environment happy-dom
// "How hard was it?" on the finish summary (lib/workout-effort.js): only on an iPhone that can give
// a workout its effort in Apple Health and is writing there, and only while Settings asks for it.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkoutEffortPicker } from './WorkoutEffort.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const m = { S: null, effort: null, listeners: new Set() }
  m.update = vi.fn(fn => { m.S = structuredClone(m.S); fn(m.S); m.listeners.forEach(l => l()) })
  m.askEffort = vi.fn(async () => true)
  m.watchAsks = false
  return m
})
vi.mock('../store/useStore.js', async () => {
  const { useSyncExternalStore } = await import('react')
  const snap = () => ({ S: mocks.S, update: mocks.update })
  const sub = l => { mocks.listeners.add(l); return () => mocks.listeners.delete(l) }
  const useStore = selector => {
    const S = useSyncExternalStore(sub, () => mocks.S)
    return selector ? selector({ S, update: mocks.update }) : { S, update: mocks.update }
  }
  useStore.getState = snap
  return { useStore }
})
vi.mock('../lib/watch-sync.js', () => ({ watchAsksEffort: () => mocks.watchAsks }))
vi.mock('../lib/health-sync.js', () => ({
  effortSupport: () => Promise.resolve(mocks.effort),
  askEffort: (...a) => mocks.askEffort(...a),
}))

let host, root
beforeEach(() => {
  mocks.S = { workouts: [{ id: 'w1', entries: [] }] }
  mocks.effort = { supported: true, on: true, granted: true }
  mocks.watchAsks = false
  mocks.update.mockClear()
  mocks.askEffort.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = async () => { await act(async () => { root.render(<WorkoutEffortPicker wid="w1" />) }) }
const score = n => host.querySelector(`[data-effort="${n}"]`)

describe('WorkoutEffortPicker', () => {
  it('rates the saved workout with one tap, and takes it back with a second', async () => {
    await mount()
    expect(host.textContent).toContain('How hard was it?')
    expect(host.querySelectorAll('[role="radio"]')).toHaveLength(10)
    await act(async () => { score(7).click() })
    expect(mocks.S.workouts[0]).toMatchObject({ effort: 7, effortBy: 'phone' })
    expect(mocks.S.workouts[0]._ts).toBeGreaterThan(0)
    expect(score(7).getAttribute('aria-checked')).toBe('true')
    expect(host.textContent).toContain('Hard')
    expect(mocks.askEffort).toHaveBeenCalledTimes(1)
    await act(async () => { score(7).click() })
    expect(mocks.S.workouts[0].effort).toBeUndefined()
  })

  it('shows the automatic score already picked, and a tap makes it yours', async () => {
    mocks.S = { workoutEffort: 'auto', workouts: [{ id: 'w1', entries: [], effort: 4, effortBy: 'auto' }] }
    await mount()
    expect(score(4).getAttribute('aria-checked')).toBe('true')
    expect(host.textContent).toContain('set from your sets')
    await act(async () => { score(9).click() })
    expect(mocks.S.workouts[0]).toMatchObject({ effort: 9, effortBy: 'phone' })
  })

  it('leaves the question to the Apple Watch that asks it, unless the phone rated it already', async () => {
    mocks.watchAsks = true
    await mount()
    expect(host.innerHTML).toBe('')
    mocks.S = { workouts: [{ id: 'w1', entries: [], effort: 5, effortBy: 'phone' }] }
    act(() => root.unmount()); root = createRoot(host)
    await mount()
    expect(score(5).getAttribute('aria-checked')).toBe('true')
    // Set automatically: the watch does not ask, so the phone shows the score.
    mocks.S = { workoutEffort: 'auto', workouts: [{ id: 'w1', entries: [], effort: 4, effortBy: 'auto' }] }
    act(() => root.unmount()); root = createRoot(host)
    await mount()
    expect(score(4).getAttribute('aria-checked')).toBe('true')
  })

  it('is not there when Settings never asks, before iOS 18, or with Apple Health off', async () => {
    mocks.S = { workoutEffort: 'never', workouts: [{ id: 'w1', entries: [] }] }
    await mount()
    expect(host.innerHTML).toBe('')
    mocks.S = { workouts: [{ id: 'w1', entries: [] }] }
    mocks.effort = { supported: false, on: true, granted: false }
    act(() => root.unmount()); root = createRoot(host)
    await mount()
    expect(host.innerHTML).toBe('')
    mocks.effort = { supported: true, on: false, granted: false }
    act(() => root.unmount()); root = createRoot(host)
    await mount()
    expect(host.innerHTML).toBe('')
  })
})
