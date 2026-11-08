// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const calls = []
vi.mock('../lib/api.js', () => ({
  api: vi.fn(async (path, init) => {
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : null })
    if (path.startsWith('/api/oauth/request')) {
      if (path.includes('gone')) throw new Error('expired')
      return { id: 'r1', client: 'Claude', redirectHost: 'claude.ai', scopes: { workouts: 'view', plans: 'off', bodyweight: 'off', measurements: 'off', notes: 'off' } }
    }
    return { redirect: 'https://claude.ai/api/mcp/auth_callback?code=c&state=s' }
  }),
  appBase: () => '/', remoteAuth: () => null
}))
const { default: Connect } = await import('./Connect.jsx')

let host, root
beforeEach(() => { calls.length = 0; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const mount = async id => { await act(async () => { root.render(<MemoryRouter initialEntries={['/connect/' + id]}><Routes><Route path="/connect/:id" element={<Connect />} /></Routes></MemoryRouter>) }); await act(async () => {}) }
const btn = text => [...host.querySelectorAll('.btn')].find(b => b.textContent.trim() === text)

describe('the connector consent screen', () => {
  it('names the assistant and where it goes back, and approves with the scopes it shows', async () => {
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true })
    await mount('r1')
    expect(host.textContent).toContain('Claude wants to use your openGym')
    expect(host.textContent).toContain('claude.ai')
    await act(async () => { btn('Allow').click() })
    const approve = calls.find(c => c.path === '/api/oauth/approve')
    expect(approve.body).toEqual({ id: 'r1', scopes: { workouts: 'view', plans: 'off', bodyweight: 'off', measurements: 'off', notes: 'off' }, days: 90 })
    expect(assign).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?code=c&state=s')
  })
  it('an expired request says so and makes nothing', async () => {
    await mount('gone')
    expect(host.textContent).toContain('This sign-in has expired')
    expect(calls.some(c => c.path === '/api/oauth/approve')).toBe(false)
  })
})
