// @vitest-environment happy-dom
// Settings → Integrations → API tokens: the list, making a token (shown once), revoking, and the
// MCP address, against a mocked API.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ config: { api_tokens: true }, sheets: [], toasts: [], calls: [], answers: {}, confirm: null }))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ S: {}, user: { id: 'u1' }, config: mocks.config })
  const useStore = selector => (selector ? selector(snap()) : snap())
  useStore.getState = snap
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: m => mocks.toasts.push(m), openSheet: render => { mocks.sheets.push(render) } })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
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

const { default: ApiTokensPage } = await import('./ApiTokens.jsx')
const { tokenLine, mcpAddress } = await import('../lib/api-tokens.js')

let host, root
const render = async el => { await act(async () => { root.render(el) }); await act(async () => {}) }
const openSheet = async () => {
  const el = mocks.sheets.at(-1)(() => { mocks.closed = true })
  const h = document.createElement('div'); document.body.appendChild(h)
  const r = createRoot(h)
  await act(async () => { r.render(el) })
  return h
}
const click = async el => { await act(async () => { el.click() }); await act(async () => {}) }
const byText = (h, txt) => [...h.querySelectorAll('button, .lrow, [role=button]')].find(b => b.textContent.includes(txt))

const TOK = { id: 't_1', name: 'Claude', hint: 'abcdef', scopes: { workouts: 'view', plans: 'apply', bodyweight: 'off', measurements: 'off', notes: 'off' }, created: Date.now() - 3600e3, exp: null, used: null }
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  mocks.sheets = []; mocks.calls = []; mocks.toasts = []; mocks.confirm = null
  mocks.answers = { '/api/tokens': b => (b ? { token: 'ogt_' + 'x'.repeat(43), tokens: [TOK], id: 't_1' } : { tokens: [], days: [7, 30, 90, 365, 0], defaultDays: 90, mcp: true }) }
})
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = '' })

describe('API tokens page', () => {
  it('shows the MCP address and an empty list, and makes a token that is shown once', async () => {
    await render(<ApiTokensPage />)
    expect(host.textContent).toContain('http://localhost:3000/mcp'.replace('http://localhost:3000', location.origin))
    expect(host.textContent).toContain('No tokens yet')
    await click(byText(host, 'New token'))
    const sheet = await openSheet()
    await click(byText(sheet, 'Make token'))
    expect(mocks.calls.at(-1)).toEqual(['/api/tokens', { name: 'API token', scopes: { workouts: 'view', plans: 'view', bodyweight: 'off', measurements: 'off', notes: 'off' }, days: 90 }])
    expect(sheet.querySelector('.intg-secret').textContent).toBe('ogt_' + 'x'.repeat(43))
    expect(sheet.textContent).toContain('only time openGym shows it')
    expect(host.textContent).toContain('Claude')
  })

  it('lists a token with what it may do, and revokes it', async () => {
    mocks.answers['/api/tokens'] = { tokens: [TOK], mcp: false }
    mocks.answers['/api/tokens/revoke'] = { tokens: [], revoked: 1 }
    await render(<ApiTokensPage />)
    expect(host.textContent).not.toContain('MCP address')
    expect(host.textContent).toContain('Sees: Workouts, Plans & routines. May change: Plans & routines')
    expect(host.textContent).toContain('Never used')
    await click(byText(host, 'Claude'))
    const sheet = await openSheet()
    expect(sheet.textContent).toContain('ogt_abcdef')
    await click(byText(sheet, 'Revoke'))
    expect(mocks.calls.at(-1)).toEqual(['/api/tokens/revoke', { id: 't_1' }])
    expect(mocks.toasts).toContain('Token revoked')
    expect(host.textContent).toContain('No tokens yet')
  })
})

describe('helpers', () => {
  it('tokenLine and mcpAddress', () => {
    expect(tokenLine({ workouts: 'off' })).toBe('Sees nothing right now')
    expect(mcpAddress({ base: 'https://gym.example.com/' })).toBe('https://gym.example.com/mcp')
    expect(mcpAddress(null, { origin: 'https://g.example', pathname: '/' })).toBe('https://g.example/mcp')
  })
})
