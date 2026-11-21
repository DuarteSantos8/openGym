// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* Settings → Account → "Sign in with {provider}" (#130): linking asks the usual proof and then
   goes to the provider; unlinking is never offered when the provider is the last way in; a linked
   profile can confirm a change with a fresh provider sign-in, and a stale one goes to get it. */
const mocks = vi.hoisted(() => {
  const m = { user: { id: 'u', name: 'Bo' }, config: { oidc: { label: 'Authentik' } }, sheets: [], toasts: [], api: null }
  m.snapshot = () => ({ user: m.user, config: m.config })
  return m
})
vi.mock('../store/useStore.js', () => {
  const useStore = sel => sel ? sel(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: t => mocks.toasts.push(t), openSheet: r => { mocks.sheets.push(r); return {} } })
  const useUI = sel => sel ? sel(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/api.js', () => ({
  api: (...a) => mocks.api(...a), webauthnOK: () => true, passkeyAssertion: vi.fn(async () => ({ cid: 'c', credential: { id: 'k' } })),
  passwordLogin: vi.fn(), passwordRegister: vi.fn(), passwordResetRedeem: vi.fn()
}))
vi.mock('../lib/oidc.js', async orig => ({ ...(await orig()), startWebSignIn: vi.fn() }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn() }))

import { OidcRow, OidcSheet } from './OidcAccount.jsx'
import { startWebSignIn } from '../lib/oidc.js'

const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent === text)
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
beforeEach(() => { mocks.user = { id: 'u', name: 'Bo' }; mocks.config = { oidc: { label: 'Authentik' } }; mocks.sheets.length = 0; mocks.toasts.length = 0; startWebSignIn.mockClear() })
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

describe('OidcAccount', () => {
  it('nothing without OIDC on the server', () => {
    mocks.config = {}
    expect(mount(<OidcRow state={{ passkeys: [] }} />).textContent).toBe('')
  })

  it('links: the passkey proof, then off to the ticket the server gave', async () => {
    mocks.api = vi.fn(async () => ({ url: '/api/oidc/start?mode=link&ticket=T' }))
    const row = mount(<OidcRow state={{ passkeys: [{ id: 'k' }], password: false }} />)
    expect(row.textContent).toContain('Not linked yet.')
    const sheet = mount(<OidcSheet close={vi.fn()} linked={false} label="Authentik" state={{ passkeys: [{ id: 'k' }] }} />)
    await act(async () => button(sheet, 'Confirm with a passkey').click())
    await flush()
    expect(mocks.api).toHaveBeenCalledWith('/api/oidc/link', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(mocks.api.mock.calls[0][1].body).cid).toBe('c')
    expect(startWebSignIn).toHaveBeenCalledWith('/api/oidc/start?mode=link&ticket=T')
  })

  it('the last way in: no unlink button, just why', () => {
    mocks.user = { id: 'u', name: 'Bo', oidc: true }
    const sheet = mount(<OidcSheet close={vi.fn()} linked label="Authentik" state={{ passkeys: [], password: false }} />)
    expect(sheet.textContent).toContain('Authentik is the only way into this profile')
    expect(button(sheet, 'Confirm with Authentik')).toBeUndefined()
  })

  it('unlink with a fresh provider sign-in; a stale one goes to the provider first', async () => {
    mocks.user = { id: 'u', name: 'Bo', oidc: true }
    mocks.api = vi.fn(async () => { throw Object.assign(new Error('x'), { status: 403, data: { code: 'reauth-required' } }) })
    const close = vi.fn()
    const sheet = mount(<OidcSheet close={close} linked label="Authentik" state={{ passkeys: [{ id: 'k' }], password: false }} />)
    await act(async () => button(sheet, 'Confirm with Authentik').click())
    await flush()
    expect(JSON.parse(mocks.api.mock.calls[0][1].body)).toEqual({ provider: true })
    expect(startWebSignIn).toHaveBeenCalledWith('reauth')
    mocks.api = vi.fn(async () => ({ ok: true }))
    const unlinked = vi.fn()
    const again = mount(<OidcSheet close={close} linked label="Authentik" state={{ passkeys: [{ id: 'k' }] }} unlinked={unlinked} />)
    await act(async () => button(again, 'Confirm with Authentik').click())
    await flush()
    expect(mocks.api).toHaveBeenCalledWith('/api/oidc/unlink', expect.anything())
    expect(unlinked).toHaveBeenCalled()
    expect(mocks.toasts.at(-1)).toContain('Unlinked')
  })
})
