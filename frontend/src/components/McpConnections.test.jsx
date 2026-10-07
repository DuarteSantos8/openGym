// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
vi.mock('../lib/i18n.js', () => ({ t: (value, ...args) => args.reduce((s, a, i) => s.replaceAll(`{${i}}`, a), value) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))
import { api } from '../lib/api.js'
import McpConnections, { McpConnectionsRow } from './McpConnections.jsx'

let host, root, navigate
const fixture = () => ({ endpoint: 'https://mcp.example/mcp', profile: { id: 'owner', name: 'Owner' }, connections: [{ id: 'conn', name: 'Claude', scopes: ['opengym:read'] }], pending: [] })
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  api.mockReset()
  navigate = vi.fn()
  // The reachability check fetches MCP's /health directly. Never let it reach the network: a test
  // that cares stubs its own answer, every other one sees an unreachable host.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const render = async (props = {}) => { await act(async () => root.render(<McpConnections {...props} />)) }
const renderRow = async (props = {}) => { await act(async () => root.render(<McpConnectionsRow {...props} />)) }
const click = async text => { await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === text).click()) }

it('hides the opt-in feature when the operator has not enabled it', async () => {
  api.mockRejectedValue(Object.assign(new Error('disabled'), { status: 503 }))
  await render()
  expect(host.textContent).toBe('')
})
it('shows when a connection was registered and when it was last used', async () => {
  const data = fixture()
  data.connections[0].createdAt = Date.parse('2026-08-20T10:00:00Z')
  data.connections[0].lastUsedAt = Date.parse('2026-09-01T09:00:00Z')
  api.mockResolvedValue(data); await render()
  expect(host.textContent).toContain('Connected since')
  expect(host.textContent).toContain(new Date(data.connections[0].createdAt).toLocaleString())
  expect(host.textContent).toContain('Last used')
  expect(host.textContent).toContain(new Date(data.connections[0].lastUsedAt).toLocaleString())
})
it('hides last-used until the connection has actually been used', async () => {
  const data = fixture()
  data.connections[0].createdAt = Date.parse('2026-08-20T10:00:00Z')
  data.connections[0].lastUsedAt = null
  api.mockResolvedValue(data); await render()
  expect(host.textContent).toContain('Connected since')
  expect(host.textContent).not.toContain('Last used')
})
it('shows the endpoint, read-only access, and which profile the connection is scoped to', async () => {
  api.mockResolvedValue(fixture()); await render()
  expect(host.textContent).toContain('https://mcp.example/mcp')
  expect(host.textContent).toContain('Read only')
  expect(host.textContent).toContain('Owner')
})
it('checks the separate MCP hostname before declaring MCP ready', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  const data = fixture()
  api.mockResolvedValue(data); await render()
  await act(async () => {})
  expect(fetch).toHaveBeenCalledWith('https://mcp.example/health', expect.objectContaining({ cache: 'no-store' }))
  expect(host.textContent).toContain('MCP is ready on this domain.')
  expect(host.querySelector('a[href="https://chatgpt.com/plugins"]')).toBeTruthy()
  expect(host.querySelector('a[href="https://claude.ai/new#customize/connectors"]')).toBeTruthy()
})
it('walks an administrator through the second hostname when MCP_ORIGIN is not configured', async () => {
  const data = fixture(); data.endpoint = window.location.origin + '/mcp'
  api.mockResolvedValue(data); await render({ admin: true })
  await act(async () => {})
  expect(host.textContent).toContain('Set up the AI connector')
  expect(host.textContent).toContain('MCP needs its own public HTTPS hostname')
  expect(host.textContent).toContain('MCP_WEB_PORT=127.0.0.1:8086')
  expect(host.textContent).toContain('MCP_INTERNAL_URL=http://mcp:3001')
  expect(host.textContent).toContain('Networks → Tunnels')
  expect(host.textContent).toContain('Do not put Cloudflare Access')
  expect(host.textContent).toContain(window.location.origin + '/mcp-authorize')
})
it('fills the guide with the hostname already configured when it is only unreachable', async () => {
  api.mockResolvedValue(fixture()); await render({ admin: true })
  await act(async () => {})
  expect(host.textContent).toContain('The separate MCP hostname is not reachable yet.')
  expect(host.textContent).toContain('MCP_ORIGIN=https://mcp.example')
  expect(host.textContent).toContain('https://mcp.example/mcp')
})
it('tells a regular member to ask the owner instead of showing server steps', async () => {
  api.mockResolvedValue(fixture()); await render()
  await act(async () => {})
  expect(host.textContent).toContain('Ask the person who runs this openGym server')
  expect(host.textContent).not.toContain('MCP_ORIGIN=')
})
it('shows the full setup guide to an administrator when the server never enabled MCP', async () => {
  api.mockRejectedValue(Object.assign(new Error('disabled'), { status: 503 }))
  await render({ admin: true })
  expect(host.textContent).toContain('not enabled on this server yet')
  expect(host.textContent).toContain('docker compose --profile mcp up -d --build')
  expect(host.textContent).toContain('MCP_INTERNAL_URL=http://mcp:3001')
})
it('asks an administrator only to start the service when it is enabled but down', async () => {
  api.mockRejectedValue(Object.assign(new Error('MCP service is unavailable.'), { status: 502 }))
  await render({ admin: true })
  expect(host.textContent).toContain('its service is not running')
  expect(host.textContent).toContain('docker compose --profile mcp up -d --build')
  expect(host.textContent).not.toContain('MCP_ORIGIN=')
})
it('checks again when asked, and leaves the guide once MCP answers', async () => {
  api.mockRejectedValueOnce(Object.assign(new Error('disabled'), { status: 503 }))
  await render({ admin: true })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  api.mockResolvedValue(fixture())
  await click('Check again'); await act(async () => {})
  expect(host.textContent).toContain('MCP is ready on this domain.')
  expect(host.textContent).not.toContain('Set up the AI connector')
})
it('shows revocation failure and leaves the existing connection visible', async () => {
  api.mockResolvedValueOnce(fixture()).mockRejectedValueOnce(new Error('offline'))
  await render(); await click('Revoke connection')
  expect(host.querySelector('[role="status"]').textContent).toBe('offline')
  expect(host.textContent).toContain('Claude')
})
it('Settings row: hides itself from a regular member when the operator has not enabled MCP', async () => {
  api.mockRejectedValue(Object.assign(new Error('disabled'), { status: 503 }))
  await renderRow(); await act(async () => {})
  expect(host.textContent).toBe('')
})
it('Settings row: leads an administrator to the setup guide when MCP is not enabled', async () => {
  api.mockRejectedValue(Object.assign(new Error('disabled'), { status: 503 }))
  await renderRow({ admin: true }); await act(async () => {})
  expect(host.textContent).toContain('Not set up yet — see how')
  await act(async () => host.querySelector('button').click())
  expect(navigate).toHaveBeenCalledWith('/settings/mcp')
})
it('Settings row: shows a single entry point and navigates to the dedicated screen', async () => {
  api.mockResolvedValue(fixture())
  await renderRow(); await act(async () => {})
  expect(host.textContent).toContain('Connect AI assistants')
  expect(host.textContent).not.toContain('Revoke connection')
  await act(async () => host.querySelector('button').click())
  expect(navigate).toHaveBeenCalledWith('/settings/mcp')
})
it('approves only the displayed request id', async () => {
  const data = fixture(); data.pending = [{ id: 'approval', tool: 'delete_workout', summary: 'workout_id: test' }]
  api.mockResolvedValue(data); await render()
  expect(host.textContent).toContain('Deletion awaiting approval')
  expect(host.textContent).toContain('delete_workout')
  await click('Approve deletion')
  const [, options] = api.mock.calls.find(([route]) => route.endsWith('/approve'))
  expect(JSON.parse(options.body)).toEqual({ id: 'approval' })
})
