// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { setLang } from '../lib/i18n.js'
import Nutrition from './Nutrition.jsx'

const mocks = vi.hoisted(() => ({ user: { id: 'u1', name: 'Client name' }, api: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: mocks.api }))
vi.mock('../store/useStore.js', () => ({ useStore: select => select({ user: mocks.user }) }))

let host, root
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  mocks.user = { id: 'u1', name: 'Client name' }
  mocks.api.mockReset()
  await setLang('en')
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => { act(() => root.unmount()); host.remove(); await setLang('en') })
const mount = () => act(() => root.render(<MemoryRouter initialEntries={['/nutrition']}>
  <Routes><Route path="/nutrition" element={<Nutrition />} /><Route path="/home" element={<div>Home route</div>} /></Routes>
</MemoryRouter>))
const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 0)))

it('loads the API greeting and returns through the existing navigation', async () => {
  let resolve
  mocks.api.mockReturnValue(new Promise(r => { resolve = r }))
  mount()
  expect(host.querySelector('[role="status"]').textContent).toBe('Loading…')
  expect(mocks.api).toHaveBeenCalledWith('/api/nutrition/hello')
  await act(async () => resolve({ message: 'Hi, Server name!' }))
  expect(host.textContent).toContain('Hi, Server name!')
  expect(host.textContent).not.toContain('Client name')
  act(() => host.querySelector('[aria-label="Back"]').click())
  expect(host.textContent).toBe('Home route')
})

it('shows a localized error and can retry', async () => {
  await setLang('ru')
  mocks.api.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ message: 'Hi, Илья!' })
  mount(); await settle()
  expect(host.querySelector('h1').textContent).toBe('Нутрициология')
  expect(host.querySelector('[role="alert"]').textContent).toBe('Нутрициология недоступна. Попробуй ещё раз.')
  const retry = [...host.querySelectorAll('button')].find(b => b.textContent === 'Повторить')
  act(() => retry.click()); await settle()
  expect(mocks.api).toHaveBeenCalledTimes(2)
  expect(host.textContent).toContain('Hi, Илья!')
})

it('requires a real account in guest/local mode without contacting the API', () => {
  mocks.user = null
  mount()
  expect(host.textContent).toContain('Sign in to use Nutrition.')
  expect(mocks.api).not.toHaveBeenCalled()
})

it('treats a revoked session as an authentication error', async () => {
  mocks.api.mockRejectedValue(Object.assign(new Error('not signed in'), { status: 401 }))
  mount(); await settle()
  expect(host.querySelector('[role="alert"]').textContent).toBe('Sign in to use Nutrition.')
})

it('does not render a malformed service response as success', async () => {
  mocks.api.mockResolvedValue({ user: { name: 'Mallory' } })
  mount(); await settle()
  expect(host.querySelector('[role="alert"]').textContent).toContain('Nutrition is unavailable.')
})

it('discards an old account response when the account changes', async () => {
  let oldAnswer
  mocks.api.mockReturnValueOnce(new Promise(r => { oldAnswer = r })).mockResolvedValueOnce({ message: 'Hi, Second!' })
  mount()
  mocks.user = { id: 'u2', name: 'Second' }
  mount(); await settle()
  await act(async () => oldAnswer({ message: 'Hi, First!' }))
  expect(host.textContent).toContain('Hi, Second!')
  expect(host.textContent).not.toContain('Hi, First!')
})
