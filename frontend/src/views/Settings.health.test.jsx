// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// #200: the Health Connect card. Only in the phone app, only where Health Connect is there or
// can be installed, off until switched on, and turning it off asks what happens to what was
// already written. In the iOS app the same card writes to Apple Health, where HealthKit was granted. lib/health-sync.js is mocked; its own tests cover the writing.
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
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
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
  mocks.android = true
  mocks.status = { status: 'available', granted: false }
  mocks.health = { on: false, written: {}, error: null }
  for (const k of ['enableHealth', 'disableHealth', 'openHealthConnect', 'menuSheet', 'toast']) mocks[k].mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = async () => {
  await act(async () => { root.render(<Settings page="data" />) })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
const row = text => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes(text))
const writeSwitch = () => row('Write to Health Connect')?.querySelector('[role="switch"]')

describe('Settings — Health Connect', () => {
  it('is not there on the web build, or on a phone without Health Connect', async () => {
    mocks.MOBILE = false
    await mount()
    expect(row('Health Connect')).toBeUndefined()

    mocks.MOBILE = true
    mocks.status = { status: 'unsupported', granted: false, store: null }
    await mount()
    expect(row('Health Connect')).toBeUndefined()
  })

  it('starts off, and turning it on goes through enableHealth', async () => {
    await mount()
    expect(writeSwitch().getAttribute('aria-checked')).toBe('false')
    expect(row('Open Health Connect')).toBeUndefined()
    await act(async () => { writeSwitch().click() })
    expect(mocks.enableHealth).toHaveBeenCalledTimes(1)
    expect(writeSwitch().getAttribute('aria-checked')).toBe('true')
    expect(row('Open Health Connect')).toBeTruthy()
  })

  it('turning it off asks whether to keep or remove what was written', async () => {
    mocks.health = { on: true, written: { 'opengym-w-w1': { k: 'session', h: 'x' } }, error: null }
    await mount()
    act(() => { writeSwitch().click() })
    expect(mocks.disableHealth).not.toHaveBeenCalled()
    const items = mocks.menuSheet.mock.calls[0][0].items
    await act(async () => { await items[1].onClick() })
    expect(mocks.disableHealth).toHaveBeenCalledWith({ removeWritten: true })
    expect(writeSwitch().getAttribute('aria-checked')).toBe('false')
  })

  it('offers to grant the permission again when Health Connect refused it', async () => {
    mocks.health = { on: true, written: {}, error: 'permission' }
    await mount()
    await act(async () => { row('Permission withdrawn').click() })
    expect(mocks.enableHealth).toHaveBeenCalledTimes(1)
  })

  it('points to installing Health Connect where it is an app of its own', async () => {
    mocks.status = { status: 'missing', granted: false }
    await mount()
    expect(writeSwitch()).toBeUndefined()
    await act(async () => { row('Install Health Connect').click() })
    expect(mocks.openHealthConnect).toHaveBeenCalledTimes(1)
  })
})

describe('Settings — Apple Health (iOS app)', () => {
  beforeEach(() => {
    mocks.android = false
    mocks.status = { status: 'available', granted: false, store: 'apple-health' }
  })
  const appleSwitch = () => row('Write to Apple Health')?.querySelector('[role="switch"]')

  it('is not there in an app signed without HealthKit', async () => {
    mocks.status = { status: 'unsupported', granted: false, store: 'apple-health' }
    await mount()
    expect(row('Write to Apple Health')).toBeUndefined()
  })

  it('names Apple Health, and turning it on goes through enableHealth', async () => {
    await mount()
    expect(row('Health Connect')).toBeUndefined()
    expect(appleSwitch().getAttribute('aria-checked')).toBe('false')
    await act(async () => { appleSwitch().click() })
    expect(mocks.enableHealth).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith('Writing to Apple Health')
    expect(row('Open Apple Health')).toBeTruthy()
  })

  it('asks what to do with what it wrote when turned off', async () => {
    mocks.health = { on: true, written: {}, error: null }
    await mount()
    act(() => { appleSwitch().click() })
    expect(mocks.menuSheet.mock.calls[0][0].title).toBe('Stop writing to Apple Health?')
  })
})
