// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App.jsx'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'

vi.mock('./lib/sound.js', () => ({
  setPlayOnSilent: vi.fn(), setVibrate: vi.fn(), setAlarmBuzzer: vi.fn(),
  beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn(),
}))
vi.mock('./lib/api.js', async importOriginal => ({
  ...await importOriginal(), api: vi.fn(() => Promise.resolve({})), beacon: vi.fn(),
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root, original

beforeEach(() => {
  original = useStore.getState()
  localStorage.setItem('gym_guest', '1')
  window.location.hash = '#/workout'
  window.scrollTo = vi.fn()
  const S = structuredClone(DEF)
  S.sound = false
  S.active = { id: 'test', name: 'Test', start: Date.now(), cur: 0, entries: [
    { id: '1001', target: { mode: 'reps' }, sets: [{ w: 10, r: 5, done: false }, { w: 10, r: 5, done: false }] },
  ] }
  useStore.setState({ S, user: null, ready: true, boot: vi.fn() })
  useUI.setState({ sheets: [], work: null, timer: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  useStore.setState(original)
  localStorage.clear()
})

it('shows only the action during a workout and restores navigation when minimized', async () => {
  await act(async () => root.render(<App />))
  expect(host.querySelectorAll('#tabbar button')).toHaveLength(1)
  expect(document.body.classList.contains('no-tabbar')).toBe(false)
  const action = host.querySelector('#tabbar button')
  expect(action.getAttribute('aria-label')).toBe('Complete set')
  await act(async () => action.click())
  expect(useStore.getState().S.active.entries[0].sets.map(s => s.done)).toEqual([true, false])
  expect(host.querySelector('#timer')).not.toBeNull()
  await act(async () => host.querySelector('.whdr button[aria-label="Minimize"]').click())
  expect(host.querySelectorAll('#tabbar button')).toHaveLength(5)
  expect(host.querySelector('#tabbar .start').getAttribute('aria-label')).toBe('Resume')
  await act(async () => host.querySelector('#tabbar .start').click())
  expect(host.querySelectorAll('#tabbar button')).toHaveLength(1)
  expect(useStore.getState().S.active.entries[0].sets.map(s => s.done)).toEqual([true, false])
})

it.each([{ editingWorkoutId: 'saved' }, { backfill: true }])('does not offer a live action for past workouts: %j', async flags => {
  useStore.getState().update(s => Object.assign(s.active, flags), false)
  await act(async () => root.render(<App />))
  expect(host.querySelector('#tabbar')).toBeNull()
  expect(document.body.classList.contains('no-tabbar')).toBe(true)
})
