// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// #375: "Vibrate when the phone is on silent" is an Android-app setting — only there can the
// native side buzz as an alarm — and it belongs to Vibrate, so it shows only with Vibrate on.
const mocks = vi.hoisted(() => {
  const state = { S: null, MOBILE: false, android: false }
  state.snapshot = () => ({
    S: state.S,
    user: null,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
    replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(),
    signOut: vi.fn(), signOutAll: vi.fn(), resetDemo: vi.fn(), disconnectServer: vi.fn(),
  })
  state.checkForUpdate = vi.fn(() => Promise.resolve({ hasUpdate: true, latestVersion: '9.9.9', apkUrl: 'https://x/opengym.apk', hashUrl: null }))
  state.confirmSheet = vi.fn()
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
// MOBILE is read at render time through a getter so one module mock serves both builds.
vi.mock('../lib/mobile.js', () => ({
  get MOBILE() { return mocks.MOBILE },
  isAndroid: () => Promise.resolve(mocks.android),
  shareExport: vi.fn(), syncReminder: vi.fn(),
}))
vi.mock('../lib/update.js', () => ({
  checkForUpdate: (...a) => mocks.checkForUpdate(...a),
  downloadAndInstall: vi.fn(),
}))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: (...a) => mocks.confirmSheet(...a), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(), menuSheet: vi.fn(),
}))

globalThis.__APP_VERSION__ ??= 'test'

let host, root
beforeEach(() => {
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none', vibrateOnSilent: false,
    gifSize: 'full', workouts: [], routines: [], exWeights: {},
  }
  mocks.MOBILE = false
  mocks.android = false
  mocks.checkForUpdate.mockClear()
  mocks.confirmSheet.mockClear()
  Object.defineProperty(navigator, 'vibrate', { value: () => true, configurable: true, writable: true })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete navigator.vibrate
})

// The effect resolves two promises (isAndroid, then checkForUpdate) before the row can render.
const mount = async () => {
  await act(async () => { root.render(<Settings page="alerts" />) })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
const TITLE = 'Vibrate on silent too'
const rowTitled = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const switchIn = row => row.querySelector('[role="switch"]') || row.querySelector('input[type="checkbox"]') || row.querySelector('button')

describe('Settings — vibrate when the phone is on silent', () => {
  it('Android app: offered right under Vibrate, off by default, and writes the setting', async () => {
    mocks.MOBILE = true
    mocks.android = true
    await mount()
    const row = rowTitled(TITLE)
    expect(row).toBeTruthy()
    expect(row.querySelector('.lrow-s').textContent).toBe('The end of a rest or a hold buzzes like an alarm, even in silent mode.')
    const rows = [...host.querySelectorAll('.lrow')]
    expect(rows.indexOf(row)).toBe(rows.indexOf(rowTitled('Vibrate')) + 1)
    expect(switchIn(row).getAttribute('aria-checked')).toBe('false')
    act(() => { switchIn(row).click() })
    expect(mocks.S.vibrateOnSilent).toBe(true)
  })

  it('not offered while Vibrate is off', async () => {
    mocks.MOBILE = true
    mocks.android = true
    mocks.S.vibrate = false
    await mount()
    expect(rowTitled('Vibrate')).toBeTruthy()
    expect(rowTitled(TITLE)).toBeUndefined()
  })

  it('not offered on the web or in the iOS app', async () => {
    await mount()
    expect(rowTitled('Vibrate')).toBeTruthy()
    expect(rowTitled(TITLE)).toBeUndefined()
    act(() => root.unmount())
    root = createRoot(host)
    mocks.MOBILE = true
    await mount()
    expect(rowTitled(TITLE)).toBeUndefined()
  })
})
