// @vitest-environment happy-dom
// Use your subscription (sub-connect-146): the address to paste, the three assistants, the live
// "Connected via Claude" once the connector has used its token, disconnecting, and the honest
// screen where no assistant could reach this openGym.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ user: { id: 'u1' }, config: { api_tokens: true, mcp: true }, toasts: [], calls: [], answers: {}, confirm: null, navs: [] }))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ S: {}, user: mocks.user, config: mocks.config, refreshConfig: () => {} })
  const useStore = selector => (selector ? selector(snap()) : snap())
  useStore.getState = snap
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: m => mocks.toasts.push(m), openSheet: () => {} })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => to => mocks.navs.push(to) }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(async (path, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : null
    mocks.calls.push([path, body])
    const a = mocks.answers[path]
    return typeof a === 'function' ? a(body) : a ?? {}
  }),
  appBase: () => '/',
  remoteAuth: () => null,
}))
vi.mock('../lib/clipboard.js', () => ({ copyText: vi.fn(async () => true) }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: o => { mocks.confirm = o } }))

const { default: Assistants } = await import('./Assistants.jsx')
const { reachability, connectionOf, connectorsOf } = await import('../lib/assistants.js')

let host, root
const render = async el => { await act(async () => { root.render(el) }); await act(async () => {}) }
const click = async el => { await act(async () => { el.click() }); await act(async () => {}) }
const byText = (h, txt) => [...h.querySelectorAll('button')].find(b => b.textContent.includes(txt))
const CONN = (assistant, used) => ({ id: 't_' + assistant, name: 'x (connector)', hint: 'abc', scopes: { workouts: 'view', plans: 'apply', bodyweight: 'off', measurements: 'off', notes: 'off' }, created: 1, exp: null, used, connector: { assistant, client: assistant } })

beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  mocks.user = { id: 'u1' }; mocks.config = { api_tokens: true, mcp: true }
  mocks.toasts = []; mocks.calls = []; mocks.confirm = null; mocks.navs = []
  mocks.answers = { '/api/tokens': { tokens: [] } }
})
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = '' })

describe('lib/assistants', () => {
  it('knows which addresses the internet can reach', () => {
    expect(reachability('https://gym.example.com/mcp')).toBe('public')
    expect(reachability('http://gym.example.com/mcp')).toBe('http')
    expect(reachability('http://192.168.1.20:8080/mcp')).toBe('local')
    expect(reachability('https://opengym.local/mcp')).toBe('local')
    expect(reachability('http://localhost:5173/mcp')).toBe('local')
    expect(reachability('https://100.101.1.2/mcp')).toBe('local')
  })
  it('picks the used connection of an assistant, and only connector tokens', () => {
    const plain = { id: 'p', scopes: {}, created: 5 }
    const list = [plain, CONN('claude', null), { ...CONN('claude', 9), id: 't_c2' }, CONN('chatgpt', null)]
    expect(connectorsOf(list).map(t => t.id)).toEqual(['t_c2', 't_claude', 't_chatgpt'])
    expect(connectionOf(list, 'claude').id).toBe('t_c2')
    expect(connectionOf(list, 'gemini')).toBe(null)
  })
})

describe('Use your subscription', () => {
  it('shows the address, three assistants and the steps of the one picked', async () => {
    await render(<Assistants />)
    expect(host.querySelector('.as-addr code').textContent).toBe(location.origin + '/mcp')
    expect([...host.querySelectorAll('.as-card-t')].map(e => e.textContent)).toEqual(['Claude', 'ChatGPT', 'Gemini'])
    expect(host.textContent).toContain('Where available')
    await click(byText(host, 'Claude'))
    expect(host.querySelectorAll('.as-steps li')).toHaveLength(3)
    expect(host.textContent).toContain('Not connected yet')
    await click(byText(host, 'Copy server address'))
    expect(mocks.toasts).toContain('Copied')
  })

  it('says "Connected via Claude" once Claude has used its token, and disconnects it', async () => {
    mocks.answers['/api/tokens'] = { tokens: [CONN('claude', Date.now() - 60000)] }
    mocks.answers['/api/tokens/revoke'] = { tokens: [] }
    await render(<Assistants />)
    expect(host.querySelector('.as-card .as-ok')).toBeTruthy()
    await click(byText(host, 'Claude'))
    expect(host.querySelector('.as-status.ok').textContent).toContain('Connected via Claude')
    await click([...host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Disconnect')))
    expect(mocks.confirm.title).toContain('Claude')
    await act(async () => { await mocks.confirm.onConfirm() })
    expect(mocks.calls.at(-1)).toEqual(['/api/tokens/revoke', { id: 't_claude' }])
  })

  it('is honest when there is no server: in-app options instead, nothing to copy', async () => {
    mocks.user = null
    await render(<Assistants />)
    expect(host.querySelector('.as-addr')).toBe(null)
    expect(host.textContent).toContain('What works right now')
    expect(host.textContent).toContain('Got Claude Max?')
    expect(mocks.calls).toEqual([])
  })

  it('names the switch when the server has connectors off', async () => {
    mocks.config = { api_tokens: true }
    await render(<Assistants />)
    expect(host.textContent).toContain('MCP=on')
  })
})
