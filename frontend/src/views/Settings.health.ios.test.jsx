// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// The same card on the iOS app, writing to Apple Health. Health is built in there, so there is
// nothing to install or update, and a withdrawn permission can only be given back in Health
// itself. lib/health-sync.js is mocked; its own tests cover the writing.
const mocks = vi.hoisted(() => {
  const state = { S: null, MOBILE: true, android: false, ios: true, status: { status: 'available', granted: false }, health: { on: false, written: {}, error: null } }
  state.snapshot = () => ({
    S: state.S, user: null, update: vi.fn(),
    replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(),
    signOut: vi.fn(), signOutAll: vi.fn(), resetDemo: vi.fn(), disconnectServer: vi.fn(),
  })
  state.enableHealth = vi.fn(async () => { state.health = { ...state.health, on: true }; return { ok: true, health: state.health } })
  state.disableHealth = vi.fn(async ({ removeWritten }) => { state.health = { ...state.health, on: false, written: removeWritten ? {} : state.health.written }; return state.health })
  state.openHealthConnect = vi.fn(async () => {})
  state.setReadHr = vi.fn(async on => { state.health = { ...state.health, readHr: on }; return state.health })
  state.menuSheet = vi.fn()
  state.toast = vi.fn()
  state.watch = { supported: true, paired: false, appInstalled: false, reachable: false }
  state.watchPref = { useWatch: true, held: {} }
  state.setUseWatch = vi.fn(async on => { state.watchPref = { ...state.watchPref, useWatch: on }; return state.watchPref })
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
  isIOS: () => Promise.resolve(mocks.ios),
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
  setReadHr: (...a) => mocks.setReadHr(...a),
}))
vi.mock('../lib/watch-link.js', () => ({
  watchStatus: () => Promise.resolve(mocks.watch),
  loadWatchPref: () => Promise.resolve(mocks.watchPref),
  setUseWatch: (...a) => mocks.setUseWatch(...a),
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
  mocks.ios = true
  mocks.status = { status: 'available', granted: false }
  mocks.health = { on: false, written: {}, error: null }
  mocks.watch = { supported: true, paired: false, appInstalled: false, reachable: false }
  mocks.watchPref = { useWatch: true, held: {} }
  for (const k of ['enableHealth', 'disableHealth', 'openHealthConnect', 'setReadHr', 'menuSheet', 'toast', 'setUseWatch']) mocks[k].mockClear()
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
const writeSwitch = () => row('Write to Apple Health')?.querySelector('[role="switch"]')

describe('Settings - Apple Health', () => {
  it('is there on iOS only where Health is (not on an iPad), and never says Health Connect', async () => {
    await mount()
    expect(row('Write to Apple Health')).toBeTruthy()
    expect(row('Write to Health Connect')).toBeUndefined()

    // A fresh screen: which shell this is gets settled once, when Settings opens.
    act(() => root.unmount()); root = createRoot(host)
    mocks.ios = false
    await mount()
    expect(row('Write to Apple Health')).toBeUndefined()

    act(() => root.unmount()); root = createRoot(host)
    mocks.ios = true
    mocks.status = { status: 'unsupported', granted: false }
    await mount()
    expect(row('Write to Apple Health')).toBeUndefined()
  })

  it('starts off, and turning it on goes through enableHealth', async () => {
    await mount()
    expect(writeSwitch().getAttribute('aria-checked')).toBe('false')
    expect(row('Open Apple Health')).toBeUndefined()
    await act(async () => { writeSwitch().click() })
    expect(mocks.enableHealth).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith('Writing to Apple Health')
    expect(writeSwitch().getAttribute('aria-checked')).toBe('true')
    expect(row('Open Apple Health')).toBeTruthy()
  })

  it('turning it off asks whether to keep or remove what was written', async () => {
    mocks.health = { on: true, written: { 'opengym-w-w1': { k: 'session', h: 'x' } }, error: null }
    await mount()
    act(() => { writeSwitch().click() })
    expect(mocks.menuSheet.mock.calls[0][0].title).toBe('Stop writing to Apple Health?')
    const items = mocks.menuSheet.mock.calls[0][0].items
    await act(async () => { await items[0].onClick() })
    expect(mocks.disableHealth).toHaveBeenCalledWith({ removeWritten: false })
  })

  it('sends a withdrawn permission to Settings instead of asking again', async () => {
    mocks.health = { on: true, written: {}, error: 'permission' }
    await mount()
    expect(row('Permission withdrawn').textContent).toContain('Allow openGym in Health > Sharing > Apps')
    await act(async () => { row('Permission withdrawn').click() })
    expect(mocks.enableHealth).not.toHaveBeenCalled()
    expect(mocks.openHealthConnect).toHaveBeenCalledWith('health')
  })

  it('opens the Health app from its own row', async () => {
    mocks.health = { on: true, written: {}, error: null }
    await mount()
    await act(async () => { row('Open Apple Health').click() })
    expect(mocks.openHealthConnect).toHaveBeenCalledWith('health')
  })

  it('reads heart rate back only once writing is on, off until turned on', async () => {
    await mount()
    expect(row('Read heart rate from Apple Health')).toBeUndefined()

    act(() => root.unmount()); root = createRoot(host)
    mocks.health = { on: true, written: {}, error: null, readHr: false }
    await mount()
    const hrSwitch = () => row('Read heart rate from Apple Health').querySelector('[role="switch"]')
    expect(hrSwitch().getAttribute('aria-checked')).toBe('false')
    expect(host.textContent).toContain('Workouts and weigh-ins go to Apple Health when you finish or change them.')
    expect(host.textContent).not.toContain('Heart rate is read back for your workouts.')
    await act(async () => { hrSwitch().click() })
    expect(mocks.setReadHr).toHaveBeenCalledWith(true)
    expect(hrSwitch().getAttribute('aria-checked')).toBe('true')
    expect(host.textContent).toContain('Heart rate is read back for your workouts.')
  })

  it('shows the Apple Watch row only with a paired watch', async () => {
    await mount()
    expect(row('Apple Watch')).toBeUndefined()

    act(() => root.unmount()); root = createRoot(host)
    mocks.watch = { ...mocks.watch, paired: true, appInstalled: true }
    await mount()
    expect(row('Apple Watch').textContent).toContain('Starts a workout on your watch when you start one here: heart rate live, rest timer on your wrist.')
  })

  it('turns the watch off and on with its switch', async () => {
    mocks.watch = { ...mocks.watch, paired: true, appInstalled: true }
    await mount()
    const watchSwitch = () => row('Apple Watch').querySelector('[role="switch"]')
    expect(watchSwitch().getAttribute('aria-checked')).toBe('true')
    await act(async () => { watchSwitch().click() })
    expect(mocks.setUseWatch).toHaveBeenCalledWith(false)
    expect(watchSwitch().getAttribute('aria-checked')).toBe('false')
  })

  it('says how to install the watch app when it is missing, with the switch disabled', async () => {
    mocks.watch = { ...mocks.watch, paired: true, appInstalled: false }
    await mount()
    expect(row('Apple Watch').textContent).toContain('Install openGym on your watch from the Watch app on this iPhone.')
    expect(row('Apple Watch').querySelector('[role="switch"]').disabled).toBe(true)
  })
})
