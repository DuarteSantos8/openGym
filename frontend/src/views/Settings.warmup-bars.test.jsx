// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'
import { bindUI } from '../components/ui.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null }
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
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  loadStarterPlan: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(), barDefaultsSheet: vi.fn(),
  menuSheet: opts => { mocks.menu = opts },
}))
vi.mock('../components/DurationWheel.jsx', () => ({ durationSheet: opts => { mocks.wheel = opts } }))

// The Settings view reads the build-time version constant at render time.
globalThis.__APP_VERSION__ ??= 'test'

let host, root
beforeEach(() => {
  mocks.menu = null
  mocks.wheel = null
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none',
    gifSize: 'full', workouts: [], routines: [], exWeights: {},
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = page => act(() => root.render(<Settings page={page} />))
const row = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const pick = label => act(() => mocks.menu.items.find(i => i.label === label).onClick())

// Discord (seals187): one warm-up rest for every exercise without its own.
describe('Settings: rest between warm-ups', () => {
  it('an older profile reads like the work sets and stores nothing', () => {
    mount('workout')
    expect(row('Rest between warm-ups').querySelector('.lrow-v').textContent).toBe('Like the work sets')
    expect('warmupRestSec' in mocks.S).toBe(false)
  })

  it('no timer is a 0, a picked time its seconds, and like the work sets takes the key away', () => {
    mount('workout')
    act(() => row('Rest between warm-ups').click())
    pick('No timer')
    expect(mocks.S.warmupRestSec).toBe(0)
    mount('workout')
    expect(row('Rest between warm-ups').querySelector('.lrow-v').textContent).toBe('No timer')
    act(() => row('Rest between warm-ups').click())
    pick('Pick a time')
    act(() => mocks.wheel.onDone(30))
    expect(mocks.S.warmupRestSec).toBe(30)
    mount('workout')
    expect(row('Rest between warm-ups').querySelector('.lrow-v').textContent).toBe('30s')
    act(() => row('Rest between warm-ups').click())
    pick('Like the work sets')
    expect('warmupRestSec' in mocks.S).toBe(false)
  })
})

// Discord (adam934912): Your bars sits next to the plates and says which bars are yours.
describe('Settings: your bars', () => {
  it('reads the standard bars, then the ones you set for this unit', () => {
    mount('equipment')
    expect(row('Your bars').textContent).toContain('Standard bars. Tap if yours are lighter.')
    mocks.S = { ...mocks.S, barDefaults: { kg: { 'olympic barbell': 15 }, lb: { barbell: 35 } } }
    mount('equipment')
    expect(row('Your bars').textContent).toContain('Olympic barbell 15 kg')
    expect(row('Your bars').textContent).not.toContain('35')
  })
})
