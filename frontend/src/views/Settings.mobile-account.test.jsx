// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* A paired phone's own Account block: the same identity actions the web has - passkeys, a
   code for another device, the linked identity, the password row - reached from the phone's own
   Settings instead of a cookie-based page, with nothing here ever offering a passkey ceremony the
   app's WebView cannot run against the server. An unpaired phone and the web are untouched; their
   own test files (Settings.identity.test.jsx, Settings.passkeys.test.jsx, Settings.password.test.jsx,
   Settings.server-sync.test.jsx) already cover that ground and stay green unchanged. */
const mocks = vi.hoisted(() => {
  const state = {
    S: null, user: null, sync: null, config: null, webauthn: true, sheets: [], toasts: [], kept: [],
    search: '', navs: [], identityChangedSubs: []
  }
  state.list = { passkeys: [], password: false, lastWayIn: false, identity: null }
  state.status = { set: false, passkeys: 0, name: 'andi', nameTaken: false, identity: null }
  state.api = vi.fn(async (path, init) => {
    const method = init?.method || 'GET'
    const base = path.split('?')[0]
    if (base === '/api/account/password' && method === 'GET') return state.status
    if (base === '/api/account/passkeys' && method === 'GET') return state.list
    if (base === '/api/account/passkeys/rename' && method === 'POST') return state.list
    if (base === '/api/account/device-link' && method === 'POST') return { code: 'K7WQ-2MZP-4HXA', expires: Date.now() + 600000 }
    return {}
  })
  state.snapshot = () => ({
    S: state.S, user: state.user, sync: state.sync, config: state.config, coachLocal: null,
    update: vi.fn(), replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(), resetDemo: vi.fn(),
    syncNow: vi.fn(), unsyncedChanges: () => ({ owed: false, count: 0 }), keptChanges: async () => state.kept,
    disconnectServer: vi.fn(), signOut: vi.fn(), signOutAll: vi.fn(), adoptProfile: vi.fn(),
  })
  state.passkeyAssertion = vi.fn(async () => ({ cid: 'login-cid', credential: { id: 'k1' } }))
  state.startProviderLink = vi.fn(async () => {})
  state.startProviderProof = vi.fn(async () => vi.fn())
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
  api: (...a) => mocks.api(...a), webauthnOK: () => mocks.webauthn, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
  passkeyAssertion: (...a) => mocks.passkeyAssertion(...a), passwordLogin: vi.fn(), passwordRegister: vi.fn(), passwordResetRedeem: vi.fn(), createPasskey: vi.fn(),
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
// The paired phone build: unlike the other Settings.*.test.jsx files, MOBILE is true throughout
// this one on purpose - it exists to exercise the phone's own Account block.
vi.mock('../lib/mobile.js', () => ({ MOBILE: true, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn(), onAppActive: () => {} }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
// The real PasswordAuth.jsx, Identity.jsx and Passkeys.jsx all render for real here (as the other
// Settings.*.test.jsx files already do) - only the app channel itself (AppSignIn.jsx) is a stub.
vi.mock('../components/AppSignIn.jsx', () => ({
  startProviderLink: (...a) => mocks.startProviderLink(...a),
  startProviderProof: (...a) => mocks.startProviderProof(...a),
  onIdentityChanged: cb => { mocks.identityChangedSubs.push(cb); return () => { mocks.identityChangedSubs = mocks.identityChangedSubs.filter(c => c !== cb) } },
  useAttemptUnfinished: () => [false, vi.fn()]
}))
// lean-qr loads on demand; what matters here is what the QR code carries.
vi.mock('../components/QrCanvas.jsx', () => ({ default: ({ value }) => <canvas data-qr={value} /> }))
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
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent === text)
const click = async (host, text) => { act(() => button(host, text).click()); await settle() }
const openedSheet = () => { const close = vi.fn(); return { host: mount(mocks.sheets.at(-1).render(close)), close } }

beforeEach(() => {
  mocks.S = { unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none', gifSize: 'full', workouts: [], routines: [], exWeights: {} }
  mocks.user = { id: 'u1', name: 'andi' }
  mocks.sync = { status: 'ok', offline: false, pending: false, auth: false, lastError: null, lastSynced: Date.now(), server: 'https://gym.example.com' }
  mocks.config = { password_login: false, oidc: { name: 'Google' } }
  mocks.list = { passkeys: [], password: false, lastWayIn: false, identity: null }
  mocks.status = { set: false, passkeys: 0, name: 'andi', nameTaken: false, identity: null }
  mocks.webauthn = true
  mocks.sheets.length = 0
  mocks.toasts.length = 0
  mocks.navs.length = 0
  mocks.search = ''
  mocks.identityChangedSubs = []
  mocks.api.mockClear()
  mocks.passkeyAssertion.mockClear().mockImplementation(async () => ({ cid: 'login-cid', credential: { id: 'k1' } }))
  mocks.startProviderLink.mockClear().mockImplementation(async () => {})
  mocks.startProviderProof.mockClear().mockImplementation(async () => vi.fn())
})
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

describe("Settings: a paired phone's own Account block", () => {
  it('lists Passkeys, Add another device and Link {provider} once nothing is linked yet', async () => {
    const page = mount(<Settings />)
    await settle()
    const acct = section(page, 'Account')
    expect(acct).toBeTruthy()
    expect(titles(acct)).toEqual(['Passkeys', 'Add another device', 'Link Google'])
  })

  it('shows the linked identity row instead, once one is linked', async () => {
    mocks.list = { passkeys: [], password: false, lastWayIn: false, identity: { providerName: 'Google', email: 'alex@example.com', linkedAt: '2026-11-05T10:00:00.000Z', usable: true } }
    const page = mount(<Settings />)
    await settle()
    const acct = section(page, 'Account')
    expect(titles(acct)).toContain('alex@example.com')
    expect(titles(acct)).not.toContain('Link Google')
  })

  it('offers the password row only where the server offers passwords', async () => {
    mocks.config = { password_login: true, oidc: { name: 'Google' } }
    mocks.status = { set: true, passkeys: 0, name: 'andi', nameTaken: false, identity: null }
    const page = mount(<Settings />)
    await settle()
    const acct = section(page, 'Account')
    expect(titles(acct)).toContain('Password')
  })

  it('a server with no provider and no passwords offers only Passkeys and Add another device', async () => {
    mocks.config = { password_login: false }
    const page = mount(<Settings />)
    await settle()
    const acct = section(page, 'Account')
    expect(titles(acct)).toEqual(['Passkeys', 'Add another device'])
  })

  it('an unpaired phone (no user yet) shows no Account section at all', async () => {
    mocks.user = null
    const page = mount(<Settings />)
    await settle()
    expect(section(page, 'Account')).toBeFalsy()
  })

  it('an identity linked through the app channel refreshes the Account rows without leaving Settings', async () => {
    const page = mount(<Settings />)
    await settle()
    expect(titles(section(page, 'Account'))).toContain('Link Google')
    mocks.list = { passkeys: [], password: false, lastWayIn: false, identity: { providerName: 'Google', email: 'alex@example.com', linkedAt: '2026-11-05T10:00:00.000Z', usable: true } }
    await act(async () => { mocks.identityChangedSubs.forEach(cb => cb()); await settle() })
    expect(titles(section(page, 'Account'))).toContain('alex@example.com')
  })
})

describe("Settings: the phone's own passkeys sheet", () => {
  it('lists passkeys, renames and removes them, and offers no "Add a passkey" button', async () => {
    mocks.webauthn = false   // Task 3's own webauthnOK(), mocked here the way the real one answers on MOBILE
    mocks.list = { passkeys: [{ id: 'k1', name: 'Laptop', created: null, lastUsed: null, transports: [] }], password: false, lastWayIn: false, identity: null }
    const page = mount(<Settings />)
    await settle()
    act(() => rowByTitle(section(page, 'Account'), 'Passkeys').click())
    const { host: sheet } = openedSheet()
    await settle()
    expect(sheet.textContent).toContain('Laptop')
    expect(button(sheet, 'Add a passkey')).toBeUndefined()
    expect(sheet.textContent).toContain('Add passkeys from a browser, or with a code for another device.')
  })
})

describe("Settings: a code for another device, on the phone", () => {
  it("builds the link from the paired server's address, never this WebView's own origin", async () => {
    mocks.list = { passkeys: [{ id: 'k1', name: 'Laptop', created: null, lastUsed: null, transports: [] }], password: false, lastWayIn: false, identity: null }
    const page = mount(<Settings />)
    await settle()
    act(() => rowByTitle(section(page, 'Account'), 'Add another device').click())
    const { host: sheet } = openedSheet()
    await settle()
    await click(sheet, 'Confirm with a passkey')
    expect(sheet.querySelector('canvas').dataset.qr).toBe('https://gym.example.com/?link=K7WQ-2MZP-4HXA')
    expect(sheet.querySelector('canvas').dataset.qr).not.toContain(window.location.origin)
  })
})
