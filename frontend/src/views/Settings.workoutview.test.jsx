// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

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
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(),
}))

// The Settings view reads the build-time version constant at render time.
globalThis.__APP_VERSION__ ??= 'test'

let host, root
beforeEach(() => {
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

const mount = () => act(() => root.render(<Settings />))
const segButton = label => [...host.querySelectorAll('.seg button')].find(b => b.textContent === label)

describe('Settings — workout view', () => {
  it('offers Cards / List / Compact and writes workoutView to the store', () => {
    mount()
    expect(segButton('Cards')).toBeTruthy()
    expect(segButton('List')).toBeTruthy()
    expect(segButton('Compact')).toBeTruthy()
    expect(segButton('Cards').getAttribute('aria-pressed')).toBe('true')
    act(() => { segButton('List').click() })
    expect(mocks.S.workoutView).toBe('list')
    mount()
    expect(segButton('List').getAttribute('aria-pressed')).toBe('true')
    act(() => { segButton('Compact').click() })
    expect(mocks.S.workoutView).toBe('compact')
    mount()
    expect(segButton('Compact').getAttribute('aria-pressed')).toBe('true')
    act(() => { segButton('Cards').click() })
    expect(mocks.S.workoutView).toBe('cards')
  })

  it('shows a legacy/absent value as Cards', () => {
    delete mocks.S.workoutView
    mount()
    expect(segButton('Cards').getAttribute('aria-pressed')).toBe('true')
    expect(segButton('List').getAttribute('aria-pressed')).toBe('false')
    expect(segButton('Compact').getAttribute('aria-pressed')).toBe('false')
  })
})
