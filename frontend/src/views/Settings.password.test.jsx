// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* Settings with password sign-in (#118): the Password row in a signed-in browser's account
   section, the ways in for a guest — including one in a browser that cannot make a passkey —
   and "Sign in" after the server ended a session, which now asks which way before prompting
   for a passkey the account may not have. None of it appears unless the instance says
   `password_login`. */
const mocks = vi.hoisted(() => {
  // `kept` is one array for good: KeptChangesRows re-asks whenever the function changes, and a
  // fresh [] per answer would re-render it forever.
  const state = { S: null, user: null, sync: null, config: null, webauthn: true, sheets: [], kept: [] }
  state.passkeyLogin = vi.fn(async () => ({ id: 'u1', name: 'andi' }))
  state.api = vi.fn(async path => (path === '/api/account/password' ? { set: false, setAt: null, passkeys: 1, name: 'andi', nameTaken: false } : {}))
  state.snapshot = () => ({
    S: state.S, user: state.user, sync: state.sync, config: state.config, coachLocal: null,
    update: vi.fn(), replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(), resetDemo: vi.fn(),
    syncNow: vi.fn(), unsyncedChanges: () => ({ owed: false, count: 0 }), keptChanges: async () => state.kept,
    disconnectServer: vi.fn(), signOut: vi.fn(), signOutAll: vi.fn(), adoptProfile: vi.fn(),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: (render, opts) => { mocks.sheets.push({ render, opts }); return {} } })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/api.js', () => ({
  api: (...a) => mocks.api(...a), webauthnOK: () => mocks.webauthn, passkeyLogin: (...a) => mocks.passkeyLogin(...a), passkeyRegister: vi.fn(), IS_ANDROID: false,
  passkeyAssertion: vi.fn(), passwordLogin: vi.fn(), passwordRegister: vi.fn(), passwordResetRedeem: vi.fn(),
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(), menuSheet: vi.fn(), askAddDeviceData: vi.fn(),
}))

globalThis.__APP_VERSION__ ??= 'test'

const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
const settle = () => act(() => new Promise(r => setTimeout(r, 0)))
const section = (page, title) => [...page.querySelectorAll('.sect')].find(s => s.querySelector('.sect-t')?.textContent === title)
const titles = el => [...el.querySelectorAll('.lrow-t')].map(t => t.textContent)
const rowByTitle = (el, title) => [...el.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)

beforeEach(() => {
  mocks.S = { unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none', gifSize: 'full', workouts: [], routines: [], exWeights: {} }
  mocks.user = { id: 'u1', name: 'andi' }
  mocks.sync = { status: 'ok', offline: false, pending: false, auth: false, lastError: null, lastSynced: Date.now(), server: null }
  mocks.config = { password_login: true }
  mocks.webauthn = true
  mocks.sheets.length = 0
  mocks.passkeyLogin.mockClear()
})
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

describe('Settings with password sign-in', () => {
  it('a signed-in browser gets a Password row in Account — and none on an instance without it', async () => {
    const page = mount(<Settings />)
    await settle()
    const account = section(page, 'Account')
    expect(titles(account)).toContain('Password')
    expect(rowByTitle(account, 'Password').textContent).toContain('Not set — lets you sign in where passkeys do not work.')

    mocks.config = null
    const off = mount(<Settings />)
    await settle()
    expect(titles(section(off, 'Account'))).not.toContain('Password')
  })

  it('a guest in a browser without passkeys can create a profile and sign in with a password', () => {
    mocks.user = null
    mocks.sync = null
    mocks.webauthn = false
    const page = mount(<Settings />)
    const account = section(page, 'Account')
    expect(titles(account)).toEqual(['Create new profile', 'Sign in with password'])
    act(() => rowByTitle(account, 'Sign in with password').click())
    const sheet = mount(mocks.sheets.at(-1).render(() => {}))
    expect(sheet.querySelector('h3').textContent).toBe('Sign in with password')

    mocks.config = null
    const off = mount(<Settings />)
    expect(titles(section(off, 'Account'))).toEqual(['Passkeys not supported in this browser.'])
  })

  it('"Sign in" after the server ended the session asks which way; the passkey is one tap on it', async () => {
    mocks.sync = { status: 'auth', offline: false, pending: true, auth: true, lastError: { status: 401 }, lastSynced: 0, server: null }
    const page = mount(<Settings />)
    const row = rowByTitle(section(page, 'Server & sync'), 'Sign in')
    expect(row).toBeTruthy()
    act(() => row.click())
    expect(mocks.passkeyLogin).not.toHaveBeenCalled()
    const sheet = mount(mocks.sheets.at(-1).render(() => {}))
    const passkey = [...sheet.querySelectorAll('button')].find(b => b.textContent === 'Sign in with passkey')
    await act(async () => { passkey.click() })
    expect(mocks.passkeyLogin).toHaveBeenCalledTimes(1)
  })
})
