// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Login from './Login.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* The sign-in screen in the Cloud edition (ADR 0008, 0013). Found by the owner on the real
   project: after signing in to their account they landed here, were offered "Create new profile",
   and it failed, because that button talks to a server of the app's own and none answered. Where
   no such server answers, a profile on one cannot be made or opened, so the screen offers what
   works: the account, and this device. */
const mocks = vi.hoisted(() => {
  const state = { cloud: true, config: null, setGuest: null }
  state.snapshot = () => ({
    config: state.config, S: {},
    setUser: () => {}, adoptProfile: () => {}, setGuest: state.setGuest, loadConfig: async () => state.config,
    pushState: () => {}, pullState: () => {},
  })
  return state
})
vi.mock('../lib/edition.js', () => ({ isCloud: () => mocks.cloud }))
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: () => ({}) })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/api.js', () => ({
  webauthnOK: () => true, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), BIO: 'your fingerprint', bio: () => 'your fingerprint',
  api: vi.fn(), passkeyAssertion: vi.fn(), passwordLogin: vi.fn(), passwordRegister: vi.fn(), passwordResetRedeem: vi.fn(),
}))
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
const SERVER_ONLY = ['Sign in with passkey', 'Sign in with password', 'Create new profile', 'Use a code from your other device', 'Lost access?']

beforeEach(() => { mocks.cloud = true; mocks.config = null; mocks.setGuest = vi.fn(); window.location.hash = '' })
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

describe('Login in the Cloud edition', () => {
  it('with no server of its own answering, offers the account and this device, and nothing that needs that server', () => {
    const page = mount(<Login />)
    expect(buttons(page)).toEqual(['Sign in or create account', 'Continue without account'])
    for (const b of SERVER_ONLY) expect(buttons(page)).not.toContain(b)
    expect(button(page, 'Sign in or create account').classList.contains('primary')).toBe(true)
    expect(page.textContent).toContain('Your training stays on this device. An account is for your plan and purchases.')
  })

  it('the account button goes to the account screen; the other opens this device', () => {
    const page = mount(<Login />)
    act(() => { button(page, 'Sign in or create account').click() })
    expect(window.location.hash).toBe('#/account')
    act(() => { button(page, 'Continue without account').click() })
    expect(mocks.setGuest).toHaveBeenCalledWith(true)
  })

  it('where a server does answer, its own ways in are all still there', () => {
    mocks.config = { allow_guest: true }
    const page = mount(<Login />)
    expect(buttons(page)).toContain('Sign in with passkey')
    expect(buttons(page)).toContain('Create new profile')
    expect(buttons(page)).not.toContain('Sign in or create account')
  })

  it('the default edition is untouched: no server answering still shows its ways in', () => {
    mocks.cloud = false
    const page = mount(<Login />)
    expect(buttons(page)).toContain('Sign in with passkey')
    expect(buttons(page)).toContain('Create new profile')
    expect(buttons(page)).not.toContain('Sign in or create account')
  })
})
