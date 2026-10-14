// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import McpSettings from './McpSettings.jsx'
import { api } from '../lib/api.js'
import { copyText } from '../lib/clipboard.js'
import { confirmSheet } from '../sheets.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ user: { id: 'alice' }, demo: false, toast: vi.fn() }))
vi.mock('../store/useStore.js', () => {
  const snapshot = () => ({ user: mocks.user })
  const useStore = select => select(snapshot())
  useStore.getState = snapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => ({ useUI: select => select({ toast: mocks.toast }) }))
vi.mock('../lib/demo.js', () => ({ get DEMO() { return mocks.demo } }))
vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
vi.mock('../lib/clipboard.js', () => ({ copyText: vi.fn(async () => true) }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: vi.fn() }))

const settings = () => ({ enabled: true, url: 'https://gym.example/mcp', timezone: 'Europe/Berlin',
  clients: [{ client_id: 'opengym-chatgpt', client_name: 'ChatGPT' }],
  scopes: ['training.read', 'nutrition.read', 'nutrition.write'] })
const grant = { grantId: 'own-grant', clientId: 'opengym-chatgpt', scopes: ['nutrition.read'], created: '2026-10-14T06:00:00Z' }
let host, root
beforeEach(() => {
  vi.clearAllMocks()
  mocks.user = { id: 'alice' }; mocks.demo = false
  api.mockImplementation(async path => path === '/api/mcp/settings' ? settings() : { connections: [grant] })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const mount = async () => { await act(async () => { root.render(<McpSettings />) }) }
const button = title => [...host.querySelectorAll('button')].find(element => element.textContent.trim() === title)
const input = (selector, text) => act(() => {
  const element = host.querySelector(selector)
  Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(element, text)
  element.dispatchEvent(new Event('input', { bubbles: true }))
})

it('shows public MCP details and revokes only the confirmed owned connection', async () => {
  await mount()
  expect(host.textContent).toContain('https://gym.example/mcp')
  expect(host.textContent).toContain('Europe/Berlin')
  expect(host.textContent).toContain('nutrition.write')
  expect(host.querySelector('form')).toBeNull()
  const url = [...host.querySelectorAll('.lrow')].find(row => row.querySelector('.lrow-t')?.textContent === 'MCP URL')
  await act(async () => url.click())
  expect(copyText).toHaveBeenCalledWith('https://gym.example/mcp')
  act(() => button('Revoke access').click())
  expect(api).not.toHaveBeenCalledWith('/api/mcp/connections/revoke', expect.anything())
  expect(confirmSheet.mock.calls[0][0].message).toContain('opengym-chatgpt')
  await act(async () => confirmSheet.mock.calls[0][0].onConfirm())
  expect(api).toHaveBeenCalledWith('/api/mcp/connections/revoke', { method: 'POST', body: JSON.stringify({ grantId: 'own-grant' }) })
  expect(host.textContent).toContain('No MCP connections yet.')
  expect(mocks.toast).toHaveBeenCalledWith('MCP access revoked')
})

it('admin saves a complete configuration without pretending it is active before restart', async () => {
  mocks.user = { id: 'admin', admin: true }
  const saved = { enabled: false, url: 'https://gym.example/mcp', clients: [] }
  api.mockImplementation(async (path, options) => path === '/api/mcp/settings'
    ? { ...settings(), enabled: false, clients: [], saved: options ? JSON.parse(options.body) : saved, restartRequired: !!options }
    : { connections: [] })
  await mount()
  act(() => host.querySelector('[role="switch"]').click())
  expect(api.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(0)
  act(() => button('Add OAuth client').click())
  input('#mcp-client-id-0', 'opengym-chatgpt')
  input('#mcp-client-name-0', 'ChatGPT')
  input('#mcp-callbacks-0', 'https://client.example/callback')
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  const put = api.mock.calls.find(([, options]) => options?.method === 'PUT')
  expect(put[0]).toBe('/api/mcp/settings')
  expect(JSON.parse(put[1].body)).toEqual({ enabled: true, url: 'https://gym.example/mcp', clients: [
    { client_id: 'opengym-chatgpt', client_name: 'ChatGPT', redirect_uris: ['https://client.example/callback'] }
  ] })
  expect(host.textContent).toContain('Saved changes are pending. Restart the API to apply them.')
  const status = [...host.querySelectorAll('.lrow')].find(row => row.querySelector('.lrow-t')?.textContent === 'Remote MCP')
  expect(status.querySelector('.lrow-v').textContent).toBe('Off')
})

it('guests and demo profiles get instructions without remote requests or admin controls', async () => {
  mocks.user = null
  await mount()
  expect(host.textContent).toContain('Sign in to manage MCP connections.')
  expect(host.textContent).toContain('Connect ChatGPT or another MCP client')
  expect(api).not.toHaveBeenCalled()
  mocks.user = { id: 'demo', admin: true }; mocks.demo = true
  await mount()
  expect(host.querySelector('form')).toBeNull()
  expect(api).not.toHaveBeenCalled()
})

it('load failures offer reload and failed revocation keeps the connection visible', async () => {
  api.mockRejectedValue(new Error('offline'))
  await mount()
  expect(host.querySelector('[role="alert"]').textContent).toBe('Could not load MCP settings. Try again.')
  api.mockImplementation(async path => path === '/api/mcp/settings' ? settings()
    : path.endsWith('/revoke') ? Promise.reject(new Error('offline')) : { connections: [grant] })
  await act(async () => button('Reload').click())
  act(() => button('Revoke access').click())
  await act(async () => confirmSheet.mock.calls[0][0].onConfirm())
  expect(button('Revoke access')).toBeDefined()
  expect(host.querySelector('[role="alert"]').textContent).toBe('Could not revoke access. Reload and try again.')
})

it('an admin validation error preserves the unsaved form and does not claim success', async () => {
  mocks.user = { id: 'admin', admin: true }
  api.mockImplementation(async (path, options) => {
    if (options?.method === 'PUT') throw new Error('OAuth callback must be HTTPS')
    return path === '/api/mcp/settings' ? { ...settings(), saved: { enabled: true, url: settings().url,
      clients: [{ ...settings().clients[0], redirect_uris: ['https://client.example/callback'] }] } } : { connections: [] }
  })
  await mount()
  input('#mcp-callbacks-0', 'http://evil.example/callback')
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(host.querySelector('[role="alert"]').textContent).toBe('OAuth callback must be HTTPS')
  expect(host.querySelector('#mcp-callbacks-0').value).toBe('http://evil.example/callback')
  expect(mocks.toast).not.toHaveBeenCalledWith('MCP settings saved')
})
