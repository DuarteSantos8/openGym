// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Login from './Login.jsx'
import { api } from '../lib/api.js'
import { SENTENCE_TOAST_MS } from '../lib/oidc.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* Sign-in through an external OIDC provider, next to passkeys: the login screen offers a button
   only where the instance's config carries an oidc key, and a failure the provider callback
   answered - a short code in the URL fragment - is toasted and cleared. */
const mocks = vi.hoisted(() => {
  const state = { webauthn: true, config: null, sheets: [], toasts: [], mobile: false, hasData: false }
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
  return { useStore, hasData: () => mocks.hasData }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...args) => mocks.toasts.push(args), openSheet: render => { mocks.sheets.push(render); return {} } })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/api.js', () => ({
  webauthnOK: () => mocks.webauthn, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), BIO: 'your fingerprint', bio: () => 'your fingerprint',
  api: vi.fn(), passkeyAssertion: vi.fn(), passwordLogin: vi.fn(), passwordRegister: vi.fn(), passwordResetRedeem: vi.fn(),
}))
vi.mock('../lib/demo.js', () => ({ DEMO: false, REPO: 'https://example.invalid' }))
vi.mock('../lib/mobile.js', () => ({ get MOBILE() { return mocks.mobile } }))
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
const primaries = host => [...host.querySelectorAll('.btn.primary')].map(b => b.textContent)
const settle = () => act(() => new Promise(r => setTimeout(r, 0)))
function type(input, value) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  act(() => { set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}

// Only the confirm-screen tests below ever reach oidcPending()/oidcConfirm(); every other test
// in this file never triggers an api() call, so an unconfigured mock is harmless for them.
const apiCalls = []

beforeEach(() => {
  mocks.webauthn = true
  mocks.config = null
  mocks.sheets.length = 0
  mocks.toasts.length = 0
  mocks.mobile = false
  mocks.hasData = false
  apiCalls.length = 0
  api.mockReset()
  history.replaceState(null, '', '/')
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) })
})

describe('Login with sign-in through an OIDC provider', () => {
  it('offers no button at all without a configured provider', () => {
    const page = mount(<Login />)
    expect(buttons(page)).not.toContain('Sign in with Example ID')
  })

  it('offers a button labelled with the provider name, above the passkey button', () => {
    mocks.config = { invite_only: false, allow_guest: true, oidc: { name: 'Example ID' } }
    const page = mount(<Login />)
    expect(buttons(page).slice(0, 2)).toEqual(['Sign in with Example ID', 'Sign in with passkey'])
  })

  it('clicking it navigates to the start address', () => {
    mocks.config = { invite_only: false, allow_guest: true, oidc: { name: 'Example ID' } }
    const page = mount(<Login />)
    act(() => button(page, 'Sign in with Example ID').click())
    expect(window.location.href).toContain('/api/oidc/start')
  })

  it('a failure fragment is toasted as a sentence, held up long enough to read, and cleared from the address bar', () => {
    history.replaceState(null, '', '/#err=token-invalid')
    const page = mount(<Login />)
    expect(mocks.toasts).toEqual([["The sign-in attempt couldn't be verified - try again.", SENTENCE_TOAST_MS]])
    expect(window.location.hash).toBe('')
  })

  it('an unrecognised failure code still toasts the generic sentence', () => {
    history.replaceState(null, '', '/#err=some-code-this-client-has-never-seen')
    mount(<Login />)
    expect(mocks.toasts).toEqual([['Something went wrong signing in - try again.', SENTENCE_TOAST_MS]])
  })

  it('a fragment that is not an oidc error is left alone', () => {
    history.replaceState(null, '', '/#/settings')
    mount(<Login />)
    expect(mocks.toasts).toEqual([])
    expect(window.location.hash).toBe('#/settings')
  })

  it('is not offered in the mobile app build, even when a provider is configured', () => {
    mocks.mobile = true
    mocks.config = { invite_only: false, allow_guest: true, oidc: { name: 'Example ID' } }
    const page = mount(<Login />)
    expect(buttons(page)).not.toContain('Sign in with Example ID')
  })
})

describe('one loud button per screen state, provider on top', () => {
  it('with a provider and passkey support, the provider button is the only primary one', () => {
    mocks.config = { invite_only: false, allow_guest: true, oidc: { name: 'Example ID' } }
    const page = mount(<Login />)
    expect(primaries(page)).toEqual(['Sign in with Example ID'])
    expect(button(page, 'Sign in with passkey').className).not.toContain('primary')
    // Every other button keeps its own variant, unaffected by the provider.
    expect(button(page, 'Create new profile').className).toContain('plain')
    expect(button(page, 'Use a code from your other device').className).toContain('ghost')
  })

  it('with a provider, no passkey support and password on, the card names both ways in and the password button is not primary', () => {
    mocks.webauthn = false
    mocks.config = { password_login: true, allow_guest: true, oidc: { name: 'Example ID' } }
    const page = mount(<Login />)
    expect(page.textContent).toContain("This browser doesn't support passkeys - sign in with Example ID above, or with your name and password below.")
    expect(primaries(page)).toEqual(['Sign in with Example ID'])
    expect(button(page, 'Sign in with password').className).not.toContain('primary')
  })

  it('with a provider, no passkey support and no password, the card points at the provider button', () => {
    mocks.webauthn = false
    mocks.config = { allow_guest: true, oidc: { name: 'Example ID' } }
    const page = mount(<Login />)
    expect(page.textContent).toContain("This browser doesn't support passkeys - sign in with Example ID above, or try a browser or device with passkey support.")
    expect(primaries(page)).toEqual(['Sign in with Example ID'])
  })

  it('without a provider, passkey stays primary exactly as upstream', () => {
    mocks.config = { allow_guest: true }
    const page = mount(<Login />)
    expect(primaries(page)).toEqual(['Sign in with passkey'])
  })

  it('without a provider and no passkey support, the upstream no-passkeys cards render unchanged', () => {
    mocks.webauthn = false
    mocks.config = { allow_guest: true }
    const withGuest = mount(<Login />)
    expect(withGuest.textContent).toContain("This browser doesn't support passkeys — you can still use openGym locally on this device.")
    mocks.config = { allow_guest: false }
    const withoutGuest = mount(<Login />)
    expect(withoutGuest.textContent).toContain('This browser doesn\'t support passkeys, and this instance requires an account. Try a browser or device with passkey support.')
  })
})

describe('confirming a new profile from an identity the instance has never seen', () => {
  it('peeks the waiting identity once and seeds the name field with it', async () => {
    api.mockImplementation(async path => {
      apiCalls.push(path)
      if (path === '/api/oidc/pending') return { name: 'Sam' }
    })
    history.replaceState(null, '', '/#oidc=confirm')
    const page = mount(<Login />)
    await settle()
    expect(apiCalls).toEqual(['/api/oidc/pending'])
    expect(page.textContent).toContain('Confirm your name')
    expect(page.querySelector('input').value).toBe('Sam')
  })

  it('on an invite-only instance the invite field renders, and an empty code is caught before any request', async () => {
    mocks.config = { invite_only: true }
    api.mockImplementation(async path => {
      if (path === '/api/oidc/pending') return { name: 'Sam' }
    })
    history.replaceState(null, '', '/#oidc=confirm')
    const page = mount(<Login />)
    await settle()
    expect(page.querySelector('input[placeholder="Invite code"]')).toBeTruthy()
    act(() => button(page, 'Create profile').click())
    expect(mocks.toasts.at(-1)).toEqual(['An invite code is required'])
    expect(apiCalls.some(c => c === '/api/oidc/confirm')).toBe(false)
  })

  it('creating posts the trimmed name and code, then pushes local data up when this device holds any', async () => {
    api.mockImplementation(async (path, opts) => {
      apiCalls.push([path, opts?.method || 'GET', opts?.body ? JSON.parse(opts.body) : null])
      if (path === '/api/oidc/pending') return { name: 'Sam' }
      if (path === '/api/oidc/confirm') return { user: { id: 'u1', name: 'Sam' } }
    })
    mocks.hasData = true
    history.replaceState(null, '', '/#oidc=confirm')
    const page = mount(<Login />)
    await settle()
    type(page.querySelector('input'), '  Sam  ')
    act(() => button(page, 'Create profile').click())
    await settle()
    expect(apiCalls).toContainEqual(['/api/oidc/confirm', 'POST', { name: 'Sam', code: '' }])
    expect(mocks.toasts.at(-1)).toEqual(['Profile created — data from this device moved into it'])
  })

  it('creating pulls the server profile down and welcomes the visitor when this device holds nothing local', async () => {
    api.mockImplementation(async (path, opts) => {
      apiCalls.push([path, opts?.method || 'GET', opts?.body ? JSON.parse(opts.body) : null])
      if (path === '/api/oidc/pending') return { name: 'Sam' }
      if (path === '/api/oidc/confirm') return { user: { id: 'u1', name: 'Sam' } }
    })
    mocks.hasData = false
    history.replaceState(null, '', '/#oidc=confirm')
    const page = mount(<Login />)
    await settle()
    act(() => button(page, 'Create profile').click())
    await settle()
    expect(apiCalls).toContainEqual(['/api/oidc/confirm', 'POST', { name: 'Sam', code: '' }])
    expect(mocks.toasts.at(-1)).toEqual(['Welcome, Sam'])
  })

  it('a refusal from confirm is toasted through the shared error table, held up long enough to read', async () => {
    api.mockImplementation(async (path, opts) => {
      if (path === '/api/oidc/pending') return { name: 'Sam' }
      if (path === '/api/oidc/confirm') { const e = new Error('bad'); e.status = 403; e.data = { code: 'invite-invalid' }; throw e }
    })
    history.replaceState(null, '', '/#oidc=confirm')
    const page = mount(<Login />)
    await settle()
    act(() => button(page, 'Create profile').click())
    await settle()
    expect(mocks.toasts.at(-1)).toEqual(["That invite code isn't valid anymore - try again with a current one.", SENTENCE_TOAST_MS])
  })

  it('a refusal from the initial peek is toasted the same way and clears the fragment, back to the sign-in buttons', async () => {
    api.mockImplementation(async () => { const e = new Error('bad'); e.status = 401; e.data = { code: 'state-expired' }; throw e })
    history.replaceState(null, '', '/#oidc=confirm')
    const page = mount(<Login />)
    await settle()
    expect(mocks.toasts).toEqual([['The sign-in attempt expired - try again.', SENTENCE_TOAST_MS]])
    expect(window.location.hash).toBe('')
    expect(page.textContent).not.toContain('Confirm your name')
    expect(buttons(page)).toContain('Sign in with passkey')
  })

  it('"This isn\'t me - go back" clears the fragment and returns to the sign-in buttons without calling the server', async () => {
    api.mockImplementation(async path => { if (path === '/api/oidc/pending') return { name: 'Sam' } })
    history.replaceState(null, '', '/#oidc=confirm')
    const page = mount(<Login />)
    await settle()
    apiCalls.length = 0
    act(() => button(page, "This isn't me - go back").click())
    expect(window.location.hash).toBe('')
    expect(page.textContent).not.toContain('Confirm your name')
    expect(buttons(page)).toContain('Sign in with passkey')
    expect(apiCalls).toEqual([])
  })
})
