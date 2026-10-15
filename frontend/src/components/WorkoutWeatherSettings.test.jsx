// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ authorizeWeather: vi.fn(), cancelWeather: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios' }, registerPlugin: () => native }))
import { useStore, DEF } from '../store/useStore.js'
import { disableWorkoutWeather, workoutWeatherEnabled } from '../lib/workout-weather.js'
import WorkoutWeatherSettings from './WorkoutWeatherSettings.jsx'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host
beforeEach(() => {
  localStorage.clear(); disableWorkoutWeather(); vi.clearAllMocks()
  native.authorizeWeather.mockResolvedValue({}); native.cancelWeather.mockResolvedValue({})
  useStore.setState({ S: structuredClone(DEF), user: { id: 'one' }, sync: { server: 'https://gym.example' } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
const render = () => act(async () => root.render(<WorkoutWeatherSettings />))
it('discloses the external provider before asking for location', async () => {
  await render()
  expect(host.textContent).toContain('approximate location')
  expect(host.querySelector('a').href).toBe('https://open-meteo.com/')
  expect(native.authorizeWeather).not.toHaveBeenCalled()
  await act(async () => host.querySelector('[role=switch]').click())
  expect(native.authorizeWeather).toHaveBeenCalledOnce()
  expect(workoutWeatherEnabled(useStore)).toBe(true)
})
it('reports permission failure without enabling weather', async () => {
  native.authorizeWeather.mockRejectedValueOnce(new Error('Location permission denied'))
  await render(); await act(async () => host.querySelector('[role=switch]').click())
  expect(host.querySelector('[role=alert]').textContent).toContain('Location permission denied')
  expect(workoutWeatherEnabled(useStore)).toBe(false)
})
it('does not transfer pending location consent to a different account', async () => {
  let finish
  native.authorizeWeather.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await render(); await act(async () => host.querySelector('[role=switch]').click())
  act(() => useStore.setState({ user: { id: 'two' } }))
  await act(async () => finish({}))
  expect(workoutWeatherEnabled(useStore)).toBe(false)
  expect(host.querySelector('[role=switch]').getAttribute('aria-checked')).toBe('false')
})
