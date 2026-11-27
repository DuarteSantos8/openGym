// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// #1393: with spoken cues the iPhone app says the end of a rest even when locked, so its footer
// says so; Android and the web keep the old line.
const mocks = vi.hoisted(() => {
  const state = { S: null, MOBILE: false, platform: null }
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
// Partial: Settings may read more of speech.js than this test cares about (the voice list).
vi.mock('../lib/speech.js', async importOriginal => ({ ...(await importOriginal()), speak: vi.fn(), speechSupported: () => true, voiceOpts: () => ({}) }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
// MOBILE is read at render time through a getter so one module mock serves both builds.
vi.mock('../lib/mobile.js', () => ({
  get MOBILE() { return mocks.MOBILE },
  isAndroid: () => Promise.resolve(mocks.platform === 'android'),
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
  mocks.S = { unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none', gifSize: 'full', workouts: [], routines: [], exWeights: {} }
  mocks.MOBILE = false
  mocks.platform = null
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete globalThis.Capacitor
})

const mount = async () => {
  await act(async () => { root.render(<Settings page="alerts" />) })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
const OLD = 'Only while the app is on screen. Music turns down for a moment, it never stops.'
const LOCKED = 'With the iPhone locked, the end of a rest is still said, unless it is on silent.'

describe('Settings, spoken cues footer', () => {
  it('iPhone app: says a locked phone still speaks the end of a rest', async () => {
    mocks.MOBILE = true
    mocks.platform = 'ios'
    globalThis.Capacitor = { getPlatform: () => 'ios' }
    await mount()
    expect(host.textContent).toContain('Only while the app is on screen. ' + LOCKED + ' Music turns down for a moment, it never stops.')
    expect(host.textContent).not.toContain(OLD)
  })

  it('Android app and the web: unchanged', async () => {
    mocks.MOBILE = true
    mocks.platform = 'android'
    globalThis.Capacitor = { getPlatform: () => 'android' }
    await mount()
    expect(host.textContent).toContain(OLD)
    expect(host.textContent).not.toContain(LOCKED)
    act(() => root.unmount())
    root = createRoot(host)
    mocks.MOBILE = false
    delete globalThis.Capacitor
    await mount()
    expect(host.textContent).toContain(OLD)
    expect(host.textContent).not.toContain(LOCKED)
  })
})
