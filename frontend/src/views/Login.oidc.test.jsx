// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Login from './Login.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* The sign-in screen with an identity provider (OIDC, #130): the provider button comes first
   where the server offers it, OIDC_ONLY leaves it alone (passkeys tucked away for admins), and a
   refusal on the way back is said on the screen. */
const mocks = vi.hoisted(() => {
  const state = { webauthn: true, config: null, sheets: [] }
  state.snapshot = () => ({
    config: state.config, S: {},
    setUser: vi.fn(), adoptProfile: vi.fn(), setGuest: vi.fn(), loadConfig: vi.fn(async () => state.config),
    pushState: vi.fn(), pullState: vi.fn(),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: render => { mocks.sheets.push(render); return {} } })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/api.js', () => ({
  webauthnOK: () => mocks.webauthn, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), BIO: 'your fingerprint', bio: () => 'your fingerprint',
  api: vi.fn(), passkeyAssertion: vi.fn(), passwordLogin: vi.fn(), passwordRegister: vi.fn(), passwordResetRedeem: vi.fn(),
}))
vi.mock('../lib/oidc.js', async orig => ({ ...(await orig()), startWebSignIn: vi.fn() }))
vi.mock('../lib/demo.js', () => ({ DEMO: false, REPO: 'https://example.invalid' }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn(), confirmSheet: vi.fn() }))

const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
const buttons = host => [...host.querySelectorAll('button')].map(b => b.textContent)
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent === text)

beforeEach(() => { mocks.webauthn = true; mocks.config = null; mocks.sheets.length = 0 })
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

import { startWebSignIn, takeOidcReturn } from '../lib/oidc.js'

describe('Login with an identity provider', () => {
  it('no oidc in the config: no provider button', () => {
    const page = mount(<Login />)
    expect(buttons(page).some(b => /Sign in with (?!passkey)/.test(b))).toBe(false)
  })

  it('offers the provider first, passkeys still there, and leaves for it on a tap', () => {
    mocks.config = { oidc: { label: 'Authentik' } }
    const page = mount(<Login />)
    const all = buttons(page)
    expect(all[0]).toBe('Sign in with Authentik')
    expect(all).toContain('Sign in with passkey')
    expect(all).toContain('Create new profile')
    act(() => button(page, 'Sign in with Authentik').click())
    expect(startWebSignIn).toHaveBeenCalled()
    expect(buttons(page)[0]).toBe('Off to Authentik…')
  })

  it('OIDC_ONLY: only the provider, no profile creation, the admin passkey one tap away', () => {
    mocks.config = { oidc: { label: 'VoidAuth', only: true }, allow_guest: false }
    const page = mount(<Login />)
    expect(buttons(page)).toEqual(['Sign in with VoidAuth', 'Admin? Use your passkey'])
    act(() => button(page, 'Admin? Use your passkey').click())
    expect(buttons(page)).toContain('Sign in with passkey')
    expect(page.textContent).not.toContain('Create new profile')
  })

  it('a browser without passkeys still gets the provider, without the "no way in" note', () => {
    mocks.webauthn = false
    mocks.config = { oidc: { label: 'Keycloak' }, allow_guest: false }
    const page = mount(<Login />)
    expect(buttons(page)).toContain('Sign in with Keycloak')
    expect(page.textContent).not.toContain('requires an account')
  })

  it('says why the provider sign-in was refused, but not for a cancel', () => {
    mocks.config = { oidc: { label: 'Pocket ID' } }
    takeOidcReturn({ search: '?oidc-error=group', hash: '#/', pathname: '/' }, { replaceState() {} })
    const page = mount(<Login />)
    expect(page.querySelector('[role=alert]').textContent).toContain('Pocket ID let you in, but this server only takes certain groups')
    takeOidcReturn({ search: '?oidc-error=cancelled', hash: '#/', pathname: '/' }, { replaceState() {} })
    const again = mount(<Login />)
    expect(again.querySelector('[role=alert]')).toBe(null)
  })
})
