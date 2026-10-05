// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* The linked identity's place in Settings -> Account, and the way back from a link round trip: the
   route query carries the outcome once, Settings acts on it and replaces the route so a reload or
   a back gesture never announces it a second time. */
const mocks = vi.hoisted(() => {
  const state = { S: null, user: null, sync: null, config: null, webauthn: true, sheets: [], kept: [], search: '', navs: [] }
  state.passkeyLogin = vi.fn(async () => ({ id: 'u1', name: 'andi' }))
  state.list = {
    passkeys: [{ id: 'k1', name: 'Laptop', created: null, lastUsed: null, transports: [] }],
    password: true, lastWayIn: false, identity: null,
  }
  state.api = vi.fn(async path => path === '/api/account/password' ? { set: true, setAt: null, passkeys: 1, name: 'andi', nameTaken: false }
    : path === '/api/account/passkeys' || path === '/api/account/passkeys/rename' ? state.list : {})
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
  const snap = () => ({ toast: (...a) => mocks.toasts.push(a), openSheet: (render, opts) => { mocks.sheets.push({ render, opts }); return {} } })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({
  useNavigate: () => (...a) => mocks.navs.push(a),
  useLocation: () => ({ pathname: '/settings', search: mocks.search }),
}))
vi.mock('../lib/api.js', () => ({
  api: (...a) => mocks.api(...a), webauthnOK: () => mocks.webauthn, passkeyLogin: (...a) => mocks.passkeyLogin(...a), passkeyRegister: vi.fn(), IS_ANDROID: false,
  passkeyAssertion: vi.fn(), passwordLogin: vi.fn(), passwordRegister: vi.fn(), passwordResetRedeem: vi.fn(), createPasskey: vi.fn(),
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
mocks.toasts = []

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

beforeEach(() => {
  mocks.S = { unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none', gifSize: 'full', workouts: [], routines: [], exWeights: {} }
  mocks.user = { id: 'u1', name: 'andi' }
  mocks.sync = { status: 'ok', offline: false, pending: false, auth: false, lastError: null, lastSynced: Date.now(), server: null }
  mocks.config = { password_login: true, oidc: { name: 'Example ID' } }
  mocks.webauthn = true
  mocks.sheets.length = 0
  mocks.toasts.length = 0
  mocks.navs.length = 0
  mocks.search = ''
  mocks.passkeyLogin.mockClear()
  mocks.api.mockClear()
})
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

const asked = path => mocks.api.mock.calls.filter(([p]) => p === path).length

describe('Settings: the linked identity in Account', () => {
  it('without config.oidc there is no identity row', async () => {
    mocks.config = { password_login: true }
    const page = mount(<Settings />)
    await settle()
    expect(titles(section(page, 'Account'))).not.toContain('Link Example ID')
  })

  it('without config.oidc, an identity linked while it was on is still listed as no longer signing in, and removable', async () => {
    mocks.config = { password_login: true }
    const saved = mocks.list
    mocks.list = { ...mocks.list, identity: { providerName: null, email: 'ana@example.com', linkedAt: '2026-11-05T10:00:00.000Z', usable: false } }
    onTestFinished(() => { mocks.list = saved })
    const page = mount(<Settings />)
    await settle()
    const account = section(page, 'Account')
    expect(titles(account)).toContain('ana@example.com')
    expect(account.textContent).toContain('This identity can no longer sign in - its provider is not set up on this instance any more.')
    const trash = account.querySelector('button[aria-label="Remove linked identity"]')
    expect(trash.disabled).toBe(false)
    act(() => trash.click())
    expect(mocks.sheets.length).toBe(1)
  })

  it('with config.oidc, nothing linked, the row sits between "Add another device" and "Pair the mobile app"', async () => {
    const page = mount(<Settings />)
    await settle()
    const order = titles(section(page, 'Account'))
    expect(order).toContain('Link Example ID')
    expect(order.indexOf('Add another device')).toBeLessThan(order.indexOf('Link Example ID'))
    expect(order.indexOf('Link Example ID')).toBeLessThan(order.indexOf('Pair the mobile app'))
  })

  it('once linked, the row shows the linked state in the same place', async () => {
    mocks.list = { ...mocks.list, identity: { providerName: 'Example ID', email: null, linkedAt: '2026-11-05T10:00:00.000Z', usable: true } }
    const page = mount(<Settings />)
    await settle()
    expect(titles(section(page, 'Account'))).toContain('Example ID')
  })

  it('"link=ok" toasts, reloads the account state, and replaces the route', async () => {
    mocks.search = '?link=ok'
    mount(<Settings />)
    await settle()
    expect(mocks.toasts).toContainEqual(['Identity linked'])
    expect(asked('/api/account/passkeys')).toBe(2)   // the initial read, and the one this triggers
    expect(mocks.navs).toEqual([['/settings', { replace: true }]])
  })

  it('"link-err=identity-collision" toasts the collision sentence and replaces the route', async () => {
    mocks.search = '?link-err=identity-collision'
    mount(<Settings />)
    await settle()
    expect(mocks.toasts.at(-1)[0]).toBe('This identity is already linked to another profile on this instance. Sign out and sign in with it directly to reach that profile.')
    expect(asked('/api/account/passkeys')).toBe(1)   // no reload for a failure
    expect(mocks.navs).toEqual([['/settings', { replace: true }]])
  })

  it('"link-err=__proto__" never resolves to anything but the generic sentence', async () => {
    mocks.search = '?link-err=__proto__'
    mount(<Settings />)
    await settle()
    expect(mocks.toasts.at(-1)[0]).toBe('Something went wrong linking that identity - try again.')
  })

  it('no route query: nothing is toasted, nothing is replaced', async () => {
    mount(<Settings />)
    await settle()
    expect(mocks.toasts).toEqual([])
    expect(mocks.navs).toEqual([])
  })
})
