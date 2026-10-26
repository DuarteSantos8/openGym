// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* "Lost access?" on the sign-in screen (#584): what to try when no device signs you in, in order,
   and "I have a code", which redeems a recovery code like a device link. The phone app cannot
   make a passkey for the server, so there it says to use a browser and pair again. */
const mocks = vi.hoisted(() => {
  const state = { webauthn: true, config: null, sheets: [], MOBILE: false, redeem: null }
  state.snapshot = () => ({
    config: state.config, S: {}, user: null, linkCode: null,
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
  createPasskey: vi.fn(),
}))
vi.mock('../lib/mobile.js', () => ({ get MOBILE() { return mocks.MOBILE }, nativePlatform: async () => null, isAndroid: async () => false }))
vi.mock('../components/Passkeys.jsx', () => ({ openDeviceLinkRedeem: vi.fn(() => { mocks.redeem = true }) }))
vi.mock('../lib/demo.js', () => ({ DEMO: false, REPO: 'https://example.invalid' }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn(), confirmSheet: vi.fn() }))

const { default: Login } = await import('./Login.jsx')
const { LostAccessSheet } = await import('../components/LostAccess.jsx')

const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)

beforeEach(() => { mocks.webauthn = true; mocks.config = null; mocks.sheets.length = 0; mocks.MOBILE = false; mocks.redeem = null })
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

describe('Login: Lost access?', () => {
  it('sits under the code button where passkeys work, and opens the steps', () => {
    const page = mount(<Login />)
    const all = [...page.querySelectorAll('button')].map(b => b.textContent.trim())
    expect(all.indexOf('Lost access?')).toBe(all.indexOf('Use a code from your other device') + 1)
    act(() => button(page, 'Lost access?').click())
    expect(mocks.sheets).toHaveLength(1)
  })
  it('is there on a password-only browser too', () => {
    mocks.webauthn = false
    mocks.config = { password_login: true }
    const page = mount(<Login />)
    expect(button(page, 'Lost access?')).toBeTruthy()
  })
})

describe('LostAccessSheet', () => {
  it('lists the ways back in, in order, with the server command, and no em dash', () => {
    const close = vi.fn()
    const host = mount(<LostAccessSheet close={close} />)
    const text = host.textContent
    const order = ['Your passkey may be synced', 'Another device still signed in?', 'Ask your admin', 'Running the server yourself?'].map(s => text.indexOf(s))
    expect(order.every(i => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(text).toContain('docker compose exec api node recover.js')
    expect(text).not.toMatch(/—/)
  })
  it('"I have a code" opens the redemption a device link has', () => {
    const close = vi.fn()
    const host = mount(<LostAccessSheet close={close} />)
    act(() => button(host, 'I have a code').click())
    expect(close).toHaveBeenCalled()
    expect(mocks.redeem).toBe(true)
  })
  it('in the phone app: a browser first, then pair again; no code field here', () => {
    mocks.MOBILE = true
    const host = mount(<LostAccessSheet close={vi.fn()} />)
    expect(host.textContent).toContain('pair the app again')
    expect(button(host, 'I have a code')).toBeUndefined()
  })
})
