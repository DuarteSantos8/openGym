// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'
import { freshState, useStore } from '../store/useStore.js'

let host, root
const row = title => [...host.querySelectorAll('.lrow')].find(el => el.querySelector('.lrow-t')?.textContent === title)
function Route() {
  return <><output>{useLocation().pathname}</output><Settings /></>
}
const mount = () => act(() => root.render(<MemoryRouter initialEntries={['/settings']}><Route /></MemoryRouter>))
const click = el => act(() => el.click())
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  useStore.setState({ S: { ...freshState(), experience: 'beginner' }, user: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('shows at most eight actions, keeps Account and App help, and searches the full index', () => {
  mount()
  expect(host.querySelectorAll('.lrow').length).toBeLessThanOrEqual(8)
  expect(row('Show all settings')).toBeTruthy()
  expect(host.querySelector('[data-tour="settings-account"]')).toBeTruthy()
  expect(row('App help')).toBeTruthy()
  expect(row('Integrations')).toBeUndefined()
  const input = host.querySelector('input')
  const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set
  act(() => { setter.call(input, 'Integrations'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  click(row('Integrations'))
  expect(host.querySelector('output').textContent).toBe('/settings/integrations')
})

it('persists the expanded choice in the profile, and can switch it back after a reload', () => {
  mount()
  click(row('Show all settings'))
  expect(row('Integrations')).toBeTruthy()
  const saved = JSON.parse(localStorage.getItem('gym_state_v1'))
  expect(saved.settingsAll).toBe(true)
  act(() => root.unmount())
  useStore.setState({ S: { ...freshState(), ...saved } })
  root = createRoot(host)
  mount()
  click(row('Show fewer'))
  expect(JSON.parse(localStorage.getItem('gym_state_v1')).settingsAll).toBe(false)
  expect(row('Integrations')).toBeUndefined()
})

it('can show advanced pages for this visit when device storage refuses writes', async () => {
  mount()
  const saved = localStorage.getItem('gym_state_v1')
  const storage = localStorage
  vi.stubGlobal('localStorage', {
    getItem: key => storage.getItem(key),
    setItem: () => { throw new Error('quota') },
    removeItem: key => storage.removeItem(key),
  })
  await act(async () => row('Show all settings').click())
  expect(row('Integrations')).toBeTruthy()
  expect(row('Show fewer')).toBeTruthy()
  expect(localStorage.getItem('gym_state_v1')).toBe(saved)
})

it.each(['intermediate', 'advanced', undefined])('preserves the full root for %s', level => {
  useStore.setState({ S: { ...freshState(), experience: level } })
  mount()
  expect(row('Integrations')).toBeTruthy()
  expect(row('Show all settings')).toBeUndefined()
  expect(row('Show fewer')).toBeUndefined()
})
