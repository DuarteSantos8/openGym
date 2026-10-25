// @vitest-environment happy-dom
//
// "Your account": where a profile connects the provider account its own Coach runs are paid
// from, on an instance whose admin chose "each profile connects its own". The sheet is tested
// by what it WRITES: which route it calls, with what body, and that the token is never drawn
// back. The server's rules (409 in instance mode, no fallback to the instance credential) are
// api/test/profile-credential.test.js's; this is the screen that drives them.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountSheet, accountSubtitle } from './CoachAccount.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  account: null,
  fetchAccount: vi.fn(),
  connectOwn: vi.fn(),
  disconnectOwn: vi.fn(),
  testOwn: vi.fn(),
  toast: vi.fn(),
  confirmSheet: vi.fn(),
}))

vi.mock('../lib/coach-account.js', () => ({
  fetchAccount: (...a) => mocks.fetchAccount(...a),
  connectOwn: (...a) => mocks.connectOwn(...a),
  disconnectOwn: (...a) => mocks.disconnectOwn(...a),
  testOwn: (...a) => mocks.testOwn(...a),
}))
vi.mock('../sheets.jsx', () => ({ confirmSheet: (...a) => mocks.confirmSheet(...a) }))
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => mocks.toast(...a) })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})

// Shaped like GET /api/coach/account in profile mode (api/coach/config.js accountFor).
const claude = (over = {}) => ({
  mode: 'profile', provider: 'claude', providerLabel: 'Claude (Anthropic)', account: null, connected: false,
  reason: 'no-credential', message: 'Connect yours in the Coach settings', accepts: ['cli-token', 'apikey'],
  keyPlaceholder: null, type: null, connectedAt: null, ...over,
})
const connected = (over = {}) => claude({ connected: true, reason: null, message: null, account: 'me@example.com', type: 'cli-token', connectedAt: '2026-10-01T10:00:00Z', ...over })
const openai = (over = {}) => claude({ provider: 'openai', providerLabel: 'OpenAI', accepts: ['apikey'], keyPlaceholder: 'sk-…', ...over })

let host, root
beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetchAccount.mockImplementation(() => Promise.resolve(mocks.account))
  mocks.connectOwn.mockResolvedValue({ ok: true })
  mocks.disconnectOwn.mockResolvedValue({ ok: true })
  mocks.testOwn.mockResolvedValue({ ok: true })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const mount = async (props = {}) => {
  const p = { close: vi.fn(), onChange: vi.fn(), ...props }
  act(() => { root.render(<AccountSheet {...p} />) })
  await settle()
  return p
}
const btn = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
const tap = async el => { await act(async () => { el.click(); await new Promise(r => setTimeout(r, 0)) }) }
const type = async (el, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 0))
  })
}
const fields = () => [...host.querySelectorAll('input')]

describe('Your account — not connected', () => {
  it('says so, names the provider, and offers the connect form with a setup token first for Claude', async () => {
    mocks.account = claude()
    await mount()
    expect(host.querySelector('[data-status]').textContent).toBe('Not connected')
    expect(host.textContent).toContain('every person uses their own Claude (Anthropic) account')
    expect(host.textContent).toContain('claude setup-token')
    expect(fields()[0].type).toBe('password')
    expect(fields()[0].placeholder).toBe('Paste the setup token')
    expect(btn('Connect').disabled).toBe(true)         // nothing pasted yet
    expect(btn('Disconnect')).toBeFalsy()
    expect(btn('Test my connection')).toBeFalsy()
  })

  it('posts the pasted token, the account label and the type, then clears the field and tells the screen', async () => {
    mocks.account = claude()
    const { onChange } = await mount()
    await type(fields()[0], 'sk-ant-oat01-AAAA BBBB')
    await type(fields()[1], ' me@example.com ')
    mocks.account = connected()
    await tap(btn('Connect'))
    expect(mocks.connectOwn).toHaveBeenCalledTimes(1)
    expect(mocks.connectOwn).toHaveBeenCalledWith({ type: 'cli-token', token: 'sk-ant-oat01-AAAA BBBB', account: 'me@example.com' })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(mocks.fetchAccount).toHaveBeenCalledTimes(2)   // re-read, not trusted
    expect(host.querySelector('[data-status]').textContent).toBe('Connected · me@example.com · Claude Code setup token')
    // The token is write-only: nothing on screen holds it any more.
    expect(host.textContent).not.toContain('AAAA')
    expect(fields()).toHaveLength(0)
  })

  it('Claude also takes an API key: the switch changes the type that is posted', async () => {
    mocks.account = claude()
    await mount()
    await tap(btn('API key'))
    await type(fields()[0], 'sk-ant-api03-xyz')
    await tap(btn('Connect'))
    expect(mocks.connectOwn).toHaveBeenCalledWith({ type: 'apikey', token: 'sk-ant-api03-xyz', account: '' })
  })

  it('an HTTP provider offers an API key only, with its own placeholder and no type switch', async () => {
    mocks.account = openai()
    await mount()
    expect(host.querySelector('.seg')).toBeFalsy()
    expect(fields()[0].placeholder).toBe('sk-…')
    await type(fields()[0], 'sk-live-1')
    await tap(btn('Connect'))
    expect(mocks.connectOwn).toHaveBeenCalledWith({ type: 'apikey', token: 'sk-live-1', account: '' })
  })

  it('a refused connect toasts the reason and keeps what was typed', async () => {
    mocks.account = openai()
    const { onChange } = await mount()
    mocks.connectOwn.mockRejectedValueOnce(new Error('openai does not take a credential of type "apikey"'))
    await type(fields()[0], 'sk-live-1')
    await tap(btn('Connect'))
    expect(mocks.toast).toHaveBeenCalledWith('openai does not take a credential of type "apikey"')
    expect(onChange).not.toHaveBeenCalled()
    expect(fields()[0].value).toBe('sk-live-1')
  })
})

describe('Your account — connected', () => {
  it('says whose account and which kind, and offers Test and Disconnect instead of the form', async () => {
    mocks.account = connected()
    await mount()
    expect(host.querySelector('[data-status]').textContent).toBe('Connected · me@example.com · Claude Code setup token')
    expect(btn('Test my connection')).toBeTruthy()
    expect(btn('Disconnect')).toBeTruthy()
    expect(fields()).toHaveLength(0)
  })

  it('"Test my connection" runs the caller\'s own test and shows the answer where the button is', async () => {
    mocks.account = connected()
    await mount()
    await tap(btn('Test my connection'))
    expect(mocks.testOwn).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[role="status"]').textContent).toBe('The connection works.')

    mocks.testOwn.mockResolvedValueOnce({ ok: false, error: '401 invalid x-api-key' })
    await tap(btn('Test my connection'))
    expect(host.querySelector('[role="status"]').textContent).toContain('The test failed.')
    expect(host.querySelector('[role="status"]').textContent).toContain('401 invalid x-api-key')
  })

  it('Disconnect asks first, and only the confirm removes the credential', async () => {
    mocks.account = connected()
    const { onChange } = await mount()
    await tap(btn('Disconnect'))
    expect(mocks.disconnectOwn).not.toHaveBeenCalled()
    const ask = mocks.confirmSheet.mock.calls.at(-1)?.[0]
    expect(ask, 'Disconnect should open a confirm').toBeTruthy()
    expect(ask.danger).toBe(true)

    mocks.account = claude()
    await act(async () => { await ask.onConfirm() })
    expect(mocks.disconnectOwn).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-status]').textContent).toBe('Not connected')
  })

  it('a provider that needs no account of its own shows no form and no Disconnect', async () => {
    mocks.account = claude({ provider: 'fixture', accepts: [], connected: true, reason: null, message: null })
    await mount()
    expect(host.textContent).toContain('needs no account of your own')
    expect(fields()).toHaveLength(0)
    expect(btn('Disconnect')).toBeFalsy()
  })
})

describe('the row in the Coach menu', () => {
  it('reads connected, with whose account when it is labelled', () => {
    expect(accountSubtitle(connected())).toBe('Connected · me@example.com')
    expect(accountSubtitle(connected({ account: null }))).toBe('Connected')
  })
  it('reads not connected, and says what that means for the Coach', () => {
    expect(accountSubtitle(claude())).toBe('Not connected. Connect it to use the Coach')
    expect(accountSubtitle(null)).toBe('')
  })
})
