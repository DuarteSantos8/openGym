// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// The updater downloads an .apk and hands it to the Android package installer, so its row
// may only ever show on the native Android build: never on the web, never on iOS. Each test
// flips the two gates (MOBILE flag, Capacitor platform) and watches whether Settings even
// asks gitlab.com for the latest release.
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
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none',
    gifSize: 'full', workouts: [], routines: [], exWeights: {},
  }
  mocks.MOBILE = false
  mocks.android = false
  mocks.checkForUpdate.mockClear()
  mocks.confirmSheet.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

// The effect resolves two promises (isAndroid, then checkForUpdate) before the row can render.
const mount = async () => {
  await act(async () => { root.render(<Settings />) })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
const updateRow = () => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Update to openGym v9.9.9'))
const checkRow = () => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Check for updates'))
const webRow = () => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Get the Android app'))

describe('Settings — in-app update check', () => {
  it('web build: never asks for releases; the Updates section points at the APK instead', async () => {
    await mount()
    expect(mocks.checkForUpdate).not.toHaveBeenCalled()
    expect(updateRow()).toBeUndefined()
    expect(checkRow()).toBeUndefined()
    expect(webRow()).toBeTruthy()
  })

  it('mobile build on iOS: no check, no row, no section', async () => {
    mocks.MOBILE = true
    await mount()
    expect(mocks.checkForUpdate).not.toHaveBeenCalled()
    expect(updateRow()).toBeUndefined()
    expect(checkRow()).toBeUndefined()
    expect(webRow()).toBeUndefined()
  })

  it('mobile build on Android: checks once and shows the row, tapping it asks before downloading', async () => {
    mocks.MOBILE = true
    mocks.android = true
    await mount()
    expect(mocks.checkForUpdate).toHaveBeenCalledTimes(1)
    expect(updateRow()).toBeTruthy()
    act(() => { updateRow().click() })
    expect(mocks.confirmSheet).toHaveBeenCalledTimes(1)
    expect(mocks.confirmSheet.mock.calls[0][0].title).toBe('Update to 9.9.9?')
  })

  it('Android without a newer release: a "Check for updates" row stays, and tapping it checks again', async () => {
    mocks.MOBILE = true
    mocks.android = true
    mocks.checkForUpdate.mockResolvedValueOnce({ hasUpdate: false, latestVersion: 'test', apkUrl: null, hashUrl: null })
    await mount()
    expect(mocks.checkForUpdate).toHaveBeenCalledTimes(1)
    expect(updateRow()).toBeUndefined()
    expect(checkRow()).toBeTruthy()
    await act(async () => { checkRow().click(); await Promise.resolve() })
    expect(mocks.checkForUpdate).toHaveBeenCalledTimes(2)
    await act(async () => { await Promise.resolve() })
    expect(updateRow()).toBeTruthy()   // the second (default) answer had 9.9.9 — the row now offers it
  })

  it('Android when gitlab.com is unreachable: stays quiet, keeps the row', async () => {
    mocks.MOBILE = true
    mocks.android = true
    mocks.checkForUpdate.mockRejectedValueOnce(new Error('offline'))
    await mount()
    expect(updateRow()).toBeUndefined()
    expect(checkRow()).toBeTruthy()
  })
})
