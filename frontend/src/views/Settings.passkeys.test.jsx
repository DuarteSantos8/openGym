// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* Settings → Account with more than one passkey (#95): the Passkeys row and the code for another
   device in a signed-in browser, nothing of it for a guest or against a server that has no such
   list, and the password row asking again once the passkeys changed — whether a password may be
   removed depends on them. */
const mocks = vi.hoisted(() => {
  // `kept` is one array for good: KeptChangesRows re-asks whenever the function changes, and a
  // fresh [] per answer would re-render it forever.
  const state = { S: null, user: null, sync: null, config: null, webauthn: true, sheets: [], kept: [] }
  state.passkeyLogin = vi.fn(async () => ({ id: 'u1', name: 'andi' }))
  state.list = { passkeys: [{ id: 'k1', name: 'Laptop', created: null, lastUsed: null, transports: [] }, { id: 'k2', name: null, created: null, lastUsed: null, transports: [] }], password: true, lastWayIn: false }
  state.api = vi.fn(async path => path === '/api/account/password' ? { set: true, setAt: null, passkeys: 2, name: 'andi', nameTaken: false }
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
  const snap = () => ({ toast: vi.fn(), openSheet: (render, opts) => { mocks.sheets.push({ render, opts }); return {} } })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
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
  mocks.api.mockClear()
})
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

const asked = path => mocks.api.mock.calls.filter(([p]) => p === path).length

describe('Settings: passkeys and another device', () => {
  it('a signed-in browser lists its passkeys and offers a code for another device, in Account', async () => {
    const page = mount(<Settings />)
    await settle()
    const account = section(page, 'Account')
    expect(titles(account)).toEqual(expect.arrayContaining(['Passkeys', 'Add another device']))
    expect(rowByTitle(account, 'Passkeys').textContent).toContain('2 passkeys')
    // Above pairing and the password, which are about other ways in.
    const order = titles(account)
    expect(order.indexOf('Passkeys')).toBeLessThan(order.indexOf('Pair the mobile app'))
    expect(order.indexOf('Add another device')).toBeLessThan(order.indexOf('Password'))
  })

  it('a guest gets neither, and nothing is asked', async () => {
    mocks.user = null
    const page = mount(<Settings />)
    await settle()
    expect(titles(page)).not.toContain('Passkeys')
    expect(titles(page)).not.toContain('Add another device')
    expect(asked('/api/account/passkeys')).toBe(0)
  })

  it('a server without the list shows neither row', async () => {
    const list = mocks.list
    mocks.list = {}
    try {
      const page = mount(<Settings />)
      await settle()
      expect(titles(page)).not.toContain('Passkeys')
      expect(titles(page)).not.toContain('Add another device')
      expect(titles(section(page, 'Account'))).toContain('Password')
    } finally { mocks.list = list }
  })

  // Settings opened while the server was down: both reads failed, and the rows stayed missing
  // until Settings was opened again, even with the block above saying "All synced".
  it('rows that found the server down come back once the store hears from it, and rows that loaded are not asked again', async () => {
    const answer = mocks.api.getMockImplementation()
    mocks.api.mockImplementation(async path => {
      if (path === '/api/account/passkeys' || path === '/api/account/password') throw Object.assign(new Error('HTTP 502'), { status: 502, data: {} })
      return answer(path)
    })
    const page = mount(<Settings />)
    await settle()
    expect(titles(section(page, 'Account'))).not.toEqual(expect.arrayContaining(['Passkeys']))
    expect(titles(section(page, 'Account'))).not.toContain('Password')

    mocks.api.mockImplementation(answer)
    mocks.sync = { ...mocks.sync, lastSynced: mocks.sync.lastSynced + 30000 }   // a check that found both sides in step
    act(() => mounted.at(-1).root.render(<Settings />))
    await settle()
    expect(titles(section(page, 'Account'))).toEqual(expect.arrayContaining(['Passkeys', 'Add another device', 'Password']))
    expect(asked('/api/account/passkeys')).toBe(2)
    expect(asked('/api/account/password')).toBe(2)

    mocks.sync = { ...mocks.sync, lastSynced: mocks.sync.lastSynced + 30000 }
    act(() => mounted.at(-1).root.render(<Settings />))
    await settle()
    expect(asked('/api/account/passkeys')).toBe(2)
    expect(asked('/api/account/password')).toBe(2)
  })

  it('a refusal is an answer: a row the server turned down is not asked for on every sync', async () => {
    const answer = mocks.api.getMockImplementation()
    mocks.api.mockImplementation(async path => {
      if (path === '/api/account/passkeys') throw Object.assign(new Error('HTTP 404'), { status: 404, data: {} })
      return answer(path)
    })
    try {
      const page = mount(<Settings />)
      await settle()
      mocks.sync = { ...mocks.sync, lastSynced: mocks.sync.lastSynced + 30000 }
      act(() => mounted.at(-1).root.render(<Settings />))
      await settle()
      expect(titles(page)).not.toContain('Passkeys')
      expect(asked('/api/account/passkeys')).toBe(1)
    } finally { mocks.api.mockImplementation(answer) }
  })

  it('a change to the passkeys reads the list and the password row again', async () => {
    const page = mount(<Settings />)
    await settle()
    expect(asked('/api/account/passkeys')).toBe(1)
    expect(asked('/api/account/password')).toBe(1)
    act(() => rowByTitle(section(page, 'Account'), 'Passkeys').click())
    const list = mount(mocks.sheets.at(-1).render(() => {}))
    await settle()
    act(() => rowByTitle(list, 'Laptop').click())
    const edit = mount(mocks.sheets.at(-1).render(() => {}))
    await act(async () => { edit.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await settle()
    expect(asked('/api/account/passkeys/rename')).toBe(1)
    expect(asked('/api/account/passkeys')).toBe(3)   // Settings, the sheet, and Settings again
    expect(asked('/api/account/password')).toBe(2)
  })
})
