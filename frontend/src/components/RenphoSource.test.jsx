// @vitest-environment happy-dom
// Settings → Health → RENPHO Health: hidden without a server, the sign-in form, a connected
// account with its last sync, and RENPHO's refusal shown in words with a way to connect again.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn(), user: { id: 'u1' }, pull: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: m.api }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, shareExport: vi.fn() }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: m.toast }) } }))
vi.mock('../store/useStore.js', () => ({ useStore: sel => sel({ user: m.user, pullState: m.pull }) }))

import RenphoSource from './RenphoSource.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
beforeEach(() => { m.api.mockReset(); m.toast.mockReset(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const mount = async () => { await act(async () => { root.render(<RenphoSource />) }); await act(async () => {}) }
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent === label)
const input = label => host.querySelector(`input[aria-label="${label}"]`)
const type = (el, v) => act(() => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
})

describe('RENPHO Health card', () => {
  it('shows nothing where there is no server account', async () => {
    m.api.mockRejectedValue(Object.assign(new Error('x'), { status: 401 }))
    await mount()
    expect(host.innerHTML).toBe('')
  })

  it('signs in with e-mail and password, and forgets the password on the device', async () => {
    m.api.mockImplementation(async (p, o) => {
      if (p === '/api/renpho' && !o) return { connected: false }
      if (p === '/api/renpho/connect') return { connected: true, email: 'me@example.com', syncing: true }
    })
    await mount()
    expect(host.textContent).toContain('RENPHO Health')
    type(input('E-mail'), 'me@example.com')
    type(input('Password'), 'secret-pass')
    await act(async () => { button('Connect').click() })
    const call = m.api.mock.calls.find(c => c[0] === '/api/renpho/connect')
    expect(JSON.parse(call[1].body)).toEqual({ email: 'me@example.com', password: 'secret-pass', areaCode: 'US' })
    expect(host.textContent).toContain('me@example.com')
    expect(host.querySelector('input[aria-label="Password"]')).toBe(null)
  })

  it('a connected account: last sync, what came, sync now and disconnect', async () => {
    m.api.mockImplementation(async (p, o) => {
      if (p === '/api/renpho' && !o) return { connected: true, email: 'me@example.com', lastSync: Date.now() - 120000, lastResult: { measurements: 12, added: 3, updated: 1 }, fields: ['weight', 'bodyFat', 'segFatLeftArm'], segmental: true }
      if (p === '/api/renpho/sync') return { connected: true, email: 'me@example.com', syncing: true }
      return { ok: true }
    })
    await mount()
    expect(host.textContent).toContain('2 min ago')
    expect(host.textContent).toContain('12 measurements · 3 new · 1 updated')
    expect(host.textContent).toContain('Weight, Body fat')
    expect(host.textContent).toContain('Segmental too')
    await act(async () => { button('Sync').click() })
    expect(m.api).toHaveBeenCalledWith('/api/renpho/sync', { method: 'POST', body: '{}' })
    await act(async () => { button('Disconnect').click() })
    expect(m.api).toHaveBeenCalledWith('/api/renpho', { method: 'DELETE' })
  })

  it('RENPHO no longer taking the sign-in is said in words, with a way to connect again', async () => {
    m.api.mockResolvedValue({ connected: true, email: 'me@example.com', lastSync: null, error: { code: 'auth' } })
    await mount()
    expect(host.textContent).toContain('RENPHO did not accept the e-mail and password. Connect again.')
    await act(async () => { button('Connect').click() })
    expect(input('Password')).toBeTruthy()
  })

  it('a refused sign-in says so and keeps no password', async () => {
    m.api.mockImplementation(async (p, o) => {
      if (p === '/api/renpho' && !o) return { connected: false }
      throw Object.assign(new Error('x'), { status: 401, data: { code: 'auth' } })
    })
    await mount()
    type(input('E-mail'), 'me@example.com')
    type(input('Password'), 'wrong')
    await act(async () => { button('Connect').click() })
    expect(m.toast).toHaveBeenCalledWith('RENPHO did not accept the e-mail and password. Connect again.')
    expect(input('Password').value).toBe('')
  })

  it('RENPHO\'s own reason, when it gave one, follows ours: on the toast and on the failed sync', async () => {
    m.api.mockImplementation(async (p, o) => {
      if (p === '/api/renpho' && !o) return { connected: false }
      throw Object.assign(new Error('x'), { status: 401, data: { code: 'auth', reason: '50012: account locked' } })
    })
    await mount()
    type(input('E-mail'), 'me@example.com')
    type(input('Password'), 'pw')
    await act(async () => { button('Connect').click() })
    expect(m.toast).toHaveBeenCalledWith('RENPHO did not accept the e-mail and password. Connect again. — RENPHO: 50012: account locked')
    act(() => root.unmount()); root = createRoot(host)
    m.api.mockReset()
    m.api.mockResolvedValue({ connected: true, email: 'me@example.com', lastSync: null, error: { code: 'rejected', reason: '401: token expired' } })
    await mount()
    expect(host.textContent).toContain('RENPHO refused the request. Try again, or connect again. — RENPHO: 401: token expired')
  })
})
