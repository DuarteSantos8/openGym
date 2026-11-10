// @vitest-environment happy-dom
// Settings → Look & Home → App icon: the row in the phone app on iOS and Android (nothing to change
// on the web), and while Halloween shows, a shortcut to it from Seasonal themes on both phones.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'
import { bindUI } from '../components/ui.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, MOBILE: false, user: null, nav: null }
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
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
// The row itself has its own test (components/AppIconRow.test.jsx); here only where it shows.
vi.mock('../components/AppIconRow.jsx', () => ({ default: () => <div className="app-icon-stub" /> }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({ get MOBILE() { return mocks.MOBILE }, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
// The NFC row asks the native side at mount; importing @capacitor/core for it would replace the
// globalThis.Capacitor these tests set up for the next test.
vi.mock('../lib/nfc.js', () => ({ nfcSupport: () => Promise.resolve({ supported: false }), writeTag: vi.fn(), cancelWrite: vi.fn(), onTagLink: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  loadStarterPlan: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(),
}))

// The Settings view reads the build-time version constant at render time.
globalThis.__APP_VERSION__ ??= 'test'

bindUI({ getState: () => ({ openSheet: () => ({ close: () => {} }) }) })

let host, root
beforeEach(() => {
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none',
    gifSize: 'full', workouts: [], routines: [], exWeights: {}, seasonal: { halloween: 'on' },
  }
  mocks.MOBILE = true
  mocks.user = null
  mocks.nav = vi.fn()
  globalThis.Capacitor = { getPlatform: () => 'ios' }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete globalThis.Capacitor
})

const mount = page => act(() => root.render(<Settings page={page} />))
const rowOf = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const picker = () => !!host.querySelector('.app-icon-stub')
const shortcut = () => rowOf('Try the Halloween app icon')

describe('App icon row in Look & Home', () => {
  it.each(['ios', 'android'])('is there in the phone app (%s)', async platform => {
    globalThis.Capacitor = { getPlatform: () => platform }
    await mount('look')
    expect(picker()).toBe(true)
  })

  it('is not there on the web', async () => {
    mocks.MOBILE = false
    delete globalThis.Capacitor
    await mount('look')
    expect(picker()).toBe(false)
  })
})

describe('Seasonal themes: the Halloween icon shortcut', () => {
  it.each(['ios', 'android'])('shows on the phone while Halloween is on and opens the picker (%s)', async platform => {
    globalThis.Capacitor = { getPlatform: () => platform }
    await mount('themes')
    expect(shortcut()).toBeTruthy()
    await act(async () => { shortcut().click() })
    expect(mocks.nav).toHaveBeenCalledWith('/settings/look', { state: { find: 'App icon' } })
  })

  it('stays away when Halloween is off', async () => {
    mocks.S.seasonal = { halloween: 'off' }
    await mount('themes')
    expect(shortcut()).toBeFalsy()
  })

  it('stays away on the web', async () => {
    mocks.MOBILE = false
    delete globalThis.Capacitor
    await mount('themes')
    expect(shortcut()).toBeFalsy()
  })
})
