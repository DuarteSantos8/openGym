// @vitest-environment happy-dom
// Settings → "Show connection status" (#369, #330): in Appearance, where a phone kept local with
// no account sees it too — Server & sync only renders for a signed-in profile.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'
import { bindUI } from '../components/ui.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, MOBILE: false, user: null }
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
vi.mock('../sheets.jsx', () => ({
  loadStarterPlan: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(),
}))

// The Settings view reads the build-time version constant at render time.
globalThis.__APP_VERSION__ ??= 'test'

// SelectRow opens its choices through the bound UI store; capture the sheet to render it here.
let sheet = null
bindUI({ getState: () => ({ openSheet: render => { sheet = render; return { close: () => {} } } }) })

let host, root
beforeEach(() => {
  sheet = null
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none',
    gifSize: 'full', workouts: [], routines: [], exWeights: {},
  }
  mocks.MOBILE = false
  mocks.user = null
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = () => act(() => root.render(<Settings page="look" />))
const row = () => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Show connection status'))

describe('Show connection status', () => {
  it('is there with no account, on a phone kept local, and on by default', () => {
    mocks.MOBILE = true
    mount()
    expect(row()).toBeTruthy()
    expect(row().textContent).toContain('A dot on Home still warns when syncing is stuck.')
    expect(row().querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('true')
  })

  it('switches the profile setting off and on', () => {
    mount()
    act(() => { row().querySelector('[role="switch"]').click() })
    expect(mocks.S.connStatus).toBe(false)
    mount()
    expect(row().querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('false')
    act(() => { row().querySelector('[role="switch"]').click() })
    expect(mocks.S.connStatus).toBe(true)
  })
})

describe('guest footers', () => {
  const footers = () => [...host.querySelectorAll('.sect-f')].map(f => f.textContent)

  it('Look & Home does not promise a guest that anything syncs with a profile', () => {
    mount()
    expect(host.textContent).not.toContain('synced with your profile')
    mocks.user = { id: 'u1' }
    act(() => root.render(<Settings key="in" page="look" />))
    expect(host.textContent).toContain('synced with your profile')
  })

  it('Account says guest mode once: the banner says it, the footer only when the banner is off', () => {
    act(() => root.render(<Settings page="account" />))
    expect(footers().filter(f => f.includes('Guest mode'))).toEqual([])
    mocks.S = { ...mocks.S, connStatus: false }
    act(() => root.render(<Settings key="off" page="account" />))
    expect(footers().filter(f => f.includes('Guest mode'))).toHaveLength(1)
  })
})
