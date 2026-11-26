// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AppHelp from './AppHelp.jsx'
import { ensureAiConsent } from '../lib/coach-api.js'
import { api } from '../lib/api.js'
const nav = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
vi.mock('../lib/coach-api.js', () => ({ ensureAiConsent: vi.fn() }))
vi.mock('../components/ServerSync.jsx', () => ({ useOnline: () => true }))
let root, host
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))
const click = el => act(async () => { el.click() })
const change = question => act(() => {
  const input = host.querySelector('input')
  Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set.call(input, question)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
beforeEach(() => {
  vi.resetAllMocks()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<AppHelp ctx={{}} canExplain />))
})
afterEach(() => { act(() => root.unmount()); host.remove() })
it('keeps search local and sends only question and visible directions after consent', async () => {
  change('rest timer')
  expect(api).not.toHaveBeenCalled()
  expect(ensureAiConsent).not.toHaveBeenCalled()
  api.mockResolvedValue({ index: 0 })
  await click(button('Ask Coach to pick a result'))
  expect(ensureAiConsent).toHaveBeenCalledOnce()
  const [path, request] = api.mock.calls[0]
  expect(path).toBe('/api/coach/help')
  expect(request.timeout).toBe(0)
  const body = JSON.parse(request.body)
  expect(Object.keys(body).sort()).toEqual(['entries', 'question'])
  expect(body.question).toBe('rest timer')
  expect(body.entries.length).toBeLessThanOrEqual(3)
  for (const entry of body.entries) expect(Object.keys(entry).sort()).toEqual(['steps', 'title'])
  expect([...host.querySelectorAll('ol li')].map(li => li.textContent)).toEqual(['Settings', 'Workout', 'Rest timer'])
  expect(nav).not.toHaveBeenCalled()
})
it('keeps the local destination on declined consent or a substituted provider link', async () => {
  change('rest timer')
  ensureAiConsent.mockRejectedValueOnce(Object.assign(new Error(), { quiet: true }))
  await click(button('Ask Coach to pick a result'))
  expect(api).not.toHaveBeenCalled()
  api.mockResolvedValueOnce({ index: 'https://example.invalid/' })
  await click(button('Ask Coach to pick a result'))
  expect(host.querySelector('ol')).toBeNull()
  await click(button('Rest timer'))
  expect(nav.mock.lastCall[0]).toBe('/settings/workout')
})
