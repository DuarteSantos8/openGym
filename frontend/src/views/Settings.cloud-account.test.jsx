// @vitest-environment happy-dom
// Settings, cloud edition: the account card at the top says who is signed in to the hosted
// account, not "Guest". In a default build it is untouched (lib/account-badge.js).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'
import { setCloudAccount } from '../lib/account-badge.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, MOBILE: false, user: null, cloud: true }
  state.snapshot = () => ({
    S: state.S,
    user: state.user,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
    replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(),
    signOut: vi.fn(), signOutAll: vi.fn(), resetDemo: vi.fn(), disconnectServer: vi.fn(),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({ get MOBILE() { return mocks.MOBILE }, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../lib/edition.js', async orig => ({ ...(await orig()), isCloud: () => mocks.cloud }))
vi.mock('../sheets.jsx', () => ({
  loadStarterPlan: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(),
}))

globalThis.__APP_VERSION__ ??= 'test'

let host, root
beforeEach(() => {
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none',
    gifSize: 'full', workouts: [], routines: [], exWeights: {},
  }
  mocks.MOBILE = false
  mocks.user = null
  mocks.cloud = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  setCloudAccount(null)
})

const card = () => host.querySelector('.sp-acct')
const title = () => card().querySelector('.lrow-t').textContent
const sub = () => card().querySelector('.lrow-s').textContent

describe('Settings account card, cloud edition', () => {
  it('names the person signed in to the hosted account, and where their training is', () => {
    setCloudAccount({ email: 'sam@example.com', name: 'Sam' })
    act(() => root.render(<Settings />))
    expect(title()).toBe('Sam')
    expect(sub()).toBe('Signed in as sam@example.com. Your training is stored on this device.')
    expect(card().textContent).not.toContain('Guest')
  })

  it('falls back to the address when no name was saved', () => {
    setCloudAccount({ email: 'sam@example.com', name: '' })
    act(() => root.render(<Settings />))
    expect(title()).toBe('sam@example.com')
  })

  it('follows a sign-out while the page is open', () => {
    setCloudAccount({ email: 'sam@example.com', name: 'Sam' })
    act(() => root.render(<Settings />))
    act(() => setCloudAccount(null))
    expect(title()).toBe('Guest')
  })

  it('is left alone in a default build, whatever the badge holds', () => {
    mocks.cloud = false
    setCloudAccount({ email: 'sam@example.com', name: 'Sam' })
    act(() => root.render(<Settings />))
    expect(title()).toBe('Guest')
  })
})
