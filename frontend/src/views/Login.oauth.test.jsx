// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Login from './Login.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  setUser: vi.fn(), pullState: vi.fn(() => Promise.resolve()), setGuest: vi.fn(), passkeyLogin: vi.fn(), replace: vi.fn(), webauthn: true
}))
vi.mock('../store/useStore.js', () => {
  const snapshot = { config: { allow_guest: true }, setUser: mocks.setUser, pullState: mocks.pullState, setGuest: mocks.setGuest }
  const useStore = selector => selector ? selector(snapshot) : snapshot
  useStore.getState = () => snapshot
  return { useStore, hasData: () => false }
})
vi.mock('../lib/api.js', () => ({
  webauthnOK: () => mocks.webauthn, passkeyLogin: (...args) => mocks.passkeyLogin(...args), passkeyRegister: vi.fn(),
  BIO: 'your fingerprint, face or PIN'
}))
vi.mock('../lib/demo.js', () => ({ DEMO: false, REPO: 'https://example.test/repo' }))
vi.mock('../lib/i18n.js', () => ({ t: (value, ...args) => value.replaceAll('{0}', args[0] || '') }))
vi.mock('../components/ui.jsx', () => ({ Button: ({ children, ...props }) => <button {...props}>{children}</button> }))
vi.mock('../components/Icon.jsx', () => ({ default: () => <span aria-hidden="true" /> }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn(), openSheet: vi.fn() }) } }))

let host, root
const browserLocation = globalThis.location
beforeEach(() => {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { origin: 'https://gym.example.test', pathname: '/', search: '?oauth_return=' + encodeURIComponent('/oauth/authorize?client_id=client&state=abc'), replace: mocks.replace }
  })
  mocks.setUser.mockClear(); mocks.pullState.mockClear(); mocks.setGuest.mockClear(); mocks.passkeyLogin.mockReset(); mocks.replace.mockClear()
  mocks.webauthn = true
  mocks.passkeyLogin.mockResolvedValue({ id: 'server-user', name: 'Server user' })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); Object.defineProperty(globalThis, 'location', { configurable: true, value: browserLocation })
})

describe('OAuth login handoff', () => {
  it('keeps the OAuth sign-in UI ahead of guest mode and skips local sync', async () => {
    act(() => root.render(<Login />))
    expect(host.querySelector('[role="status"]')?.textContent).toContain('requested openGym connection')
    expect([...host.querySelectorAll('button')].some(button => button.textContent.includes('Continue without account'))).toBe(false)
    expect([...host.querySelectorAll('button')].some(button => button.textContent.includes('Create new profile'))).toBe(false)

    const signIn = [...host.querySelectorAll('button')].find(button => button.textContent.includes('Sign in with passkey'))
    expect(signIn).toBeTruthy()
    await act(async () => { signIn.click(); await Promise.resolve() })
    expect(mocks.setUser).not.toHaveBeenCalled()
    expect(mocks.pullState).not.toHaveBeenCalled()
    expect(mocks.setGuest).not.toHaveBeenCalled()
    expect(mocks.replace).toHaveBeenCalledWith('/oauth/authorize?client_id=client&state=abc')
  })

  it('does not offer guest mode when OAuth needs a passkey this browser lacks', () => {
    mocks.webauthn = false
    act(() => root.render(<Login />))
    expect(host.textContent).toContain("this connection can't be authorized here")
    expect(host.textContent).not.toContain('you can still use openGym locally')
    const cancel = [...host.querySelectorAll('button')].find(button => button.textContent === 'Cancel')
    expect(cancel).toBeTruthy()
    act(() => cancel.click())
    expect(mocks.replace).toHaveBeenCalledWith('/')
    expect(mocks.setUser).not.toHaveBeenCalled()
    expect(mocks.pullState).not.toHaveBeenCalled()
  })
})
