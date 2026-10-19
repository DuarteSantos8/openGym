// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App.jsx'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'

vi.mock('./lib/sound.js', () => ({ setPlayOnSilent: vi.fn(), setVibrate: vi.fn(), setAlarmBuzzer: vi.fn(), beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('./lib/api.js', async original => ({ ...await original(), api: vi.fn(() => Promise.resolve({})), beacon: vi.fn() }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root, original
beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  original = useStore.getState()
  localStorage.setItem('gym_guest', '1')
  window.location.hash = '#/workout'
  window.scrollTo = vi.fn()
  const S = structuredClone(DEF)
  S.sound = false
  S.active = { id: 'interval', name: 'Intervals', start: Date.now(), cur: 0, entries: ['0025', '0007'].map(id => ({
    id, sg: 'pair', target: { mode: 'time', sgMode: 'interval', sgWork: 2, sgPrep: 3, sgIntervalRest: 1, sgRoundRest: 0 },
    sets: [{ sec: 2, done: false }, { sec: 2, done: false }],
  })) }
  useStore.setState({ S, user: null, ready: true, boot: vi.fn() })
  useUI.setState({ sheets: [], work: null, timer: null, intervalAction: null })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove()
  useUI.getState().stopRest(); useUI.getState().stopWork()
  useStore.setState(original); localStorage.clear(); vi.useRealTimers()
})
const bottom = () => host.querySelector('#tabbar .start')
const top = () => [...host.querySelectorAll('button')].find(b => !b.closest('#tabbar') && /^(Start|Stop) intervals$/.test(b.textContent))
const advance = ms => act(() => vi.advanceTimersByTime(ms))

it.each(['cards', 'list', 'compact', 'focus'])('starts preparation and automatic work/rest from the bottom in %s view', async workoutView => {
  useStore.getState().update(s => { s.active.workoutView = workoutView }, false)
  await act(async () => root.render(<App />))
  expect(top().classList.contains('primary')).toBe(true)
  expect(bottom().getAttribute('aria-label')).toBe('Start intervals')
  await act(async () => bottom().click())
  expect(useUI.getState().work.owner.prep).toBe(true)
  expect(top().textContent).toBe('Stop intervals')
  expect(bottom().textContent).toBe('Stop intervals')
  advance(3000)
  expect(useStore.getState().S.active.entries[0].sets[0].done).toBe(false)
  expect(useUI.getState().work.owner.idx).toBe(0)
  advance(2000)
  expect(useStore.getState().S.active.entries[0].sets[0].done).toBe(true)
  expect(useUI.getState().timer.total).toBe(1)
  advance(1000)
  expect(useUI.getState().work.owner.idx).toBe(1)
  await act(async () => bottom().click())
  expect(useUI.getState().work).toBeNull()
  expect(useStore.getState().S.active.entries[1].sets[0].done).toBe(false)
  expect(bottom().textContent).toBe('Start intervals')
})

it('stops top-started preparation from the bottom without logging work and clears the action on navigation', async () => {
  await act(async () => root.render(<App />))
  await act(async () => top().click())
  advance(1000)
  await act(async () => bottom().click())
  expect(useUI.getState().work).toBeNull()
  expect(useStore.getState().S.active.entries.every(e => e.sets.every(s => !s.done))).toBe(true)
  await act(async () => [...host.querySelectorAll('#tabbar button')].find(b => b.textContent === 'Plan').click())
  expect(useUI.getState().intervalAction).toBeNull()
  expect(bottom().getAttribute('aria-label')).toBe('Resume')
})
