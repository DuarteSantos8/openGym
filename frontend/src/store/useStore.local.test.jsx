// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('../lib/local.js', () => ({ LOCAL: true }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  useStore.setState({ S: structuredClone(DEF), ready: false, user: null })
})
it('boots empty without a backend or example history; saves personal records across boot', async () => {
  await useStore.getState().boot()
  expect(api).not.toHaveBeenCalled()
  expect(useStore.getState().S.workouts).toEqual([])
  expect(localStorage.getItem('gym_demo_seeded_v1')).toBeNull()
  useStore.getState().update(s => {
    s.routines = [{ id: 'personal', name: 'My plan', ex: [] }]
    s.workouts = [{ id: 'session', d: '2026-10-18', entries: [{ id: '0043', sets: [{ w: 40, r: 8, done: true }] }] }]
  })
  const saved = JSON.parse(localStorage.getItem('gym_state_v1'))
  expect(saved.workouts[0].entries[0].sets[0]).toEqual({ w: 40, r: 8, done: true })
  vi.resetModules()
  const { useStore: reopened } = await import('./useStore.js')
  await reopened.getState().boot()
  expect(reopened.getState().S.routines[0].name).toBe('My plan')
  expect(reopened.getState().S.workouts[0].entries[0].sets[0]).toEqual({ w: 40, r: 8, done: true })
  expect(api).not.toHaveBeenCalled()
})
