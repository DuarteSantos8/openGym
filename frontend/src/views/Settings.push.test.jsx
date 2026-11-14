// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'
import { syncPushSubscription } from '../lib/push.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, toast: null }
  state.snapshot = () => ({
    S: state.S,
    user: { id: 'u1', name: 'Test' },          // the Notifications card is signed-in (or mobile) only
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
  const snap = () => ({ toast: mocks.toast, openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => new Promise(() => {})), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
// The switch is what this file is about, so push.js is a supported browser whose sync with the
// server each test decides.
vi.mock('../lib/push.js', () => ({
  pushSupported: () => true,
  enablePush: vi.fn(async () => {}),
  disablePush: vi.fn(async () => {}),
  sendTestPush: vi.fn(),
  syncPushSubscription: vi.fn(async () => true),
}))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(),
}))

globalThis.__APP_VERSION__ ??= 'test'

let host, root
beforeEach(() => {
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: true, effort: 'none',
    gifSize: 'full', workouts: [], routines: [], exWeights: {},
  }
  mocks.toast = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = async () => { await act(async () => { root.render(<Settings page="reminders" />) }) }
const rowTitled = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const switchIn = row => row.querySelector('[role="switch"]') || row.querySelector('input[type="checkbox"]') || row.querySelector('button')

// What the switch reads when Settings opens. "On" is the server holding this browser's
// subscription; when the server cannot be asked, the browser's own side stands in. A server that
// refused the subscription, a fresh one included (lib/push.js register), has answered, and the
// browser's side must not turn that into "on".
describe('Settings — what the Notifications switch shows when it opens', () => {
  const switchState = () => switchIn(rowTitled('Push notifications')).getAttribute('aria-checked')
  const originalWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')
  const browserHolds = subscription => Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true, value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => subscription } }) },
  })
  afterEach(() => {
    if (originalWorker) Object.defineProperty(navigator, 'serviceWorker', originalWorker); else delete navigator.serviceWorker
    vi.mocked(syncPushSubscription).mockReset().mockImplementation(async () => true)
  })

  it('on, when the server holds this browser\'s subscription', async () => {
    await mount()
    expect(switchState()).toBe('true')
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('the browser\'s side, when the server cannot be asked', async () => {
    browserHolds({ endpoint: 'https://push.example/e1' })
    vi.mocked(syncPushSubscription).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await mount()
    expect(switchState()).toBe('true')
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('off, with the server\'s reason, when the server refused this browser\'s subscription', async () => {
    // By this point the real register() has dropped both subscriptions, so the browser holds
    // none. One is left here anyway, so the switch reads off because the server refused, and not
    // only because the fallback found nothing.
    browserHolds({ endpoint: 'https://push.example/e1' })
    vi.mocked(syncPushSubscription).mockRejectedValueOnce(
      Object.assign(new Error('this subscription belongs to another account'), { status: 409, refused: true }))
    await mount()
    expect(switchState()).toBe('false')
    expect(mocks.toast).toHaveBeenCalledWith('this subscription belongs to another account')
  })
})
