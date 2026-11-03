// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Settings, { SettingsRoute } from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Settings → Apple Watch opens on the iPhone app. The route used to decide before it knew the
// platform (an async check) and sent every visit to /settings/watch back to the root: the page
// could never be opened ("Apple Watch settings is not working"). Mocks as in Settings.health.test.
const mocks = vi.hoisted(() => {
  const state = { S: null, MOBILE: true, android: true, status: { status: 'available', granted: false }, health: { on: false, written: {}, error: null } }
  state.snapshot = () => ({
    S: state.S, user: null, update: vi.fn(),
    replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(),
    signOut: vi.fn(), signOutAll: vi.fn(), resetDemo: vi.fn(), disconnectServer: vi.fn(),
  })
  state.enableHealth = vi.fn(async () => { state.health = { ...state.health, on: true }; return { ok: true, health: state.health } })
  state.disableHealth = vi.fn(async ({ removeWritten }) => { state.health = { ...state.health, on: false, written: removeWritten ? {} : state.health.written }; return state.health })
  state.openHealthConnect = vi.fn(async () => {})
  state.menuSheet = vi.fn()
  state.toast = vi.fn()
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: mocks.toast, openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('./WatchSettings.jsx', () => ({ default: () => <div id="watch-page">watch page</div> }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false }))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({
  get MOBILE() { return mocks.MOBILE },
  isAndroid: () => Promise.resolve(mocks.android),
  shareExport: vi.fn(), syncReminder: vi.fn(),
}))
vi.mock('../lib/update.js', () => ({ checkForUpdate: () => Promise.resolve({ hasUpdate: false }), downloadAndInstall: vi.fn() }))
vi.mock('../lib/health-sync.js', () => ({
  healthStatus: () => Promise.resolve(mocks.status),
  loadHealth: () => Promise.resolve(mocks.health),
  enableHealth: (...a) => mocks.enableHealth(...a),
  disableHealth: (...a) => mocks.disableHealth(...a),
  openHealthConnect: (...a) => mocks.openHealthConnect(...a),
  onHealthChange: () => () => {},
}))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(), menuSheet: (...a) => mocks.menuSheet(...a),
}))

globalThis.__APP_VERSION__ ??= 'test'

let host, root
beforeEach(() => {
  mocks.S = { unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none', gifSize: 'full', workouts: [], routines: [], exWeights: {} }
  mocks.MOBILE = true
  mocks.android = false
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete globalThis.Capacitor
})

const open = async path => {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[path]}><Routes>
      <Route path="/settings" element={<div id="root-page">root</div>} />
      <Route path="/settings/:page" element={<SettingsRoute />} />
    </Routes></MemoryRouter>)
  })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

describe('Settings → Apple Watch', () => {
  it('opens on the iPhone app, on the first render', async () => {
    globalThis.Capacitor = { getPlatform: () => 'ios' }
    await open('/settings/watch')
    expect(host.querySelector('#watch-page')).toBeTruthy()
    expect(host.querySelector('#root-page')).toBeNull()
  })

  it('opens too when the platform is not known yet inside the app (the page then says what it finds)', async () => {
    await open('/settings/watch')
    expect(host.querySelector('#watch-page')).toBeTruthy()
  })

  it('goes back to the root on Android and on the web', async () => {
    globalThis.Capacitor = { getPlatform: () => 'android' }
    mocks.android = true
    await open('/settings/watch')
    expect(host.querySelector('#root-page')).toBeTruthy()
    delete globalThis.Capacitor
    mocks.MOBILE = false
    await open('/settings/watch')
    expect(host.querySelector('#root-page')).toBeTruthy()
  })

  it('has its row on the root at once on the iPhone app', async () => {
    globalThis.Capacitor = { getPlatform: () => 'ios' }
    await act(async () => { root.render(<MemoryRouter><Settings /></MemoryRouter>) })
    expect([...host.querySelectorAll('.lrow')].some(r => r.textContent.includes('Apple Watch'))).toBe(true)
  })
})
