// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* Settings → Account ID (#219): the signed-in account's id, small, one tap to copy. It is what
   an admin puts in ADMIN_UIDS and what names an account beyond doubt in a support request. A
   browser shows it under Account, a paired phone in its Server & sync block, a guest nowhere. */
const mocks = vi.hoisted(() => {
  const state = { S: null, user: null, MOBILE: false }
  state.toast = vi.fn()
  state.snapshot = () => ({
    S: state.S, user: state.user, coachLocal: null,
    sync: { status: 'ok', offline: false, pending: false, auth: false, lastError: null, lastSynced: Date.now(), server: 'https://gym.example.com' },
    update: vi.fn(), replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(), resetDemo: vi.fn(),
    syncNow: vi.fn(), unsyncedChanges: () => ({ owed: false, count: 0 }), keptChanges: async () => [],
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
  const snap = () => ({ toast: (...a) => mocks.toast(...a), openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.resolve({})), webauthnOK: () => true, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({
  get MOBILE() { return mocks.MOBILE },
  isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn(),
}))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(), menuSheet: vi.fn(), askAddDeviceData: vi.fn(),
}))

globalThis.__APP_VERSION__ ??= 'test'

const ID = 'k3v9q0x2mz7a'
const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
// The copy only calls the clipboard and a toast, no React state, so a plain tick lets the
// clipboard promise settle; nothing here needs act() to flush.
const tick = () => new Promise(r => setTimeout(r, 0))
const section = (page, title) => [...page.querySelectorAll('.sect')].find(s => s.querySelector('.sect-t')?.textContent === title)
const idRow = el => [...el.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === 'Account ID')

let writeText
beforeEach(() => {
  mocks.S = { unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none', gifSize: 'full', workouts: [], routines: [], exWeights: {} }
  mocks.user = { id: ID, name: 'andi' }
  mocks.MOBILE = false
  mocks.toast.mockClear()
  writeText = vi.fn(() => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

describe('Settings → Account ID', () => {
  it('a signed-in browser shows the id under Account, and a tap copies it', async () => {
    const page = mount(<Settings page="account" />)
    const row = idRow(section(page, 'Account'))
    expect(row).toBeTruthy()
    expect(row.querySelector('.acct-id').textContent).toBe(ID)
    act(() => row.click())
    await tick()
    expect(writeText).toHaveBeenCalledWith(ID)
    expect(mocks.toast).toHaveBeenCalledWith('Account ID copied')
  })

  it('a paired phone shows it in the Server & sync block', () => {
    mocks.MOBILE = true
    const page = mount(<Settings page="account" />)
    expect(idRow(section(page, 'Server & sync')).querySelector('.acct-id').textContent).toBe(ID)
  })

  it('a clipboard that refuses says nothing, and the id stays on screen', async () => {
    writeText.mockImplementation(() => Promise.reject(new Error('denied')))
    const page = mount(<Settings page="account" />)
    act(() => idRow(page).click())
    await tick()
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(idRow(page).textContent).toContain(ID)
  })

  it('plain http without the Clipboard API still copies it, the way a selection copy does', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
    try {
      const page = mount(<Settings page="account" />)
      act(() => idRow(page).click())
      await tick()
      expect(execCommand).toHaveBeenCalledWith('copy')
      expect(mocks.toast).toHaveBeenCalledWith('Account ID copied')
    } finally { delete document.execCommand }
  })

  it('a guest has no account and no id', () => {
    mocks.user = null
    const page = mount(<Settings page="account" />)
    expect(idRow(page)).toBeUndefined()
  })
})
