// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'
import { unlock } from '../lib/sound.js'

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
  starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(),
}))
// The real module decides "supported" from navigator.audioSession, which each test sets up;
// unlock is spied on so the Sounds switch can be checked for its tap-time side effect.
vi.mock('../lib/sound.js', async importOriginal => {
  const real = await importOriginal()
  return { ...real, unlock: vi.fn() }
})

globalThis.__APP_VERSION__ ??= 'test'

let host, root
const setAudioSession = value => Object.defineProperty(navigator, 'audioSession', { value, configurable: true, writable: true })
beforeEach(() => {
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: true, soundOnSilent: false, effort: 'none',
    gifSize: 'full', workouts: [], routines: [], exWeights: {},
  }
  setAudioSession({ type: 'auto' })
  Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', configurable: true })
  unlock.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  setAudioSession(undefined)
})

const mount = () => act(() => root.render(<Settings />))
const rowTitled = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const switchIn = row => row.querySelector('[role="switch"]') || row.querySelector('input[type="checkbox"]') || row.querySelector('button')

describe('Settings — play sounds when the phone is on silent', () => {
  it('is offered on a browser with an audio session (iOS), under Sounds, with the music trade-off spelled out', () => {
    mount()
    const row = rowTitled('Play sounds when the phone is on silent')
    expect(row).toBeTruthy()
    expect(row.querySelector('.lrow-s').textContent).toBe('Music playing on this phone stops during a workout and does not resume by itself.')
    const rows = [...host.querySelectorAll('.lrow')]
    expect(rows.indexOf(row)).toBe(rows.indexOf(rowTitled('Sounds')) + 1)
  })

  it('is not offered where the browser has no audio session API', () => {
    setAudioSession(undefined)
    mount()
    expect(rowTitled('Play sounds when the phone is on silent')).toBeUndefined()
  })

  it('is not offered on macOS Safari, which has the API but no ring/silent switch', () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', configurable: true })
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true })
    mount()
    expect(rowTitled('Play sounds when the phone is on silent')).toBeUndefined()
  })

  it('is not offered while Sounds is off', () => {
    mocks.S.sound = false
    mount()
    expect(rowTitled('Play sounds when the phone is on silent')).toBeUndefined()
  })

  it('writes soundOnSilent to the store', () => {
    mount()
    const sw = switchIn(rowTitled('Play sounds when the phone is on silent'))
    expect(sw).toBeTruthy()
    act(() => { sw.click() })
    expect(mocks.S.soundOnSilent).toBe(true)
  })
})

describe('Settings — Sounds switch unlocks audio from the tap', () => {
  it('turning Sounds on unlocks; turning it off does not', () => {
    mocks.S.sound = false
    mount()
    act(() => { switchIn(rowTitled('Sounds')).click() })
    expect(mocks.S.sound).toBe(true)
    expect(unlock).toHaveBeenCalledWith(true)
    unlock.mockClear()
    mount()
    act(() => { switchIn(rowTitled('Sounds')).click() })
    expect(mocks.S.sound).toBe(false)
    expect(unlock).not.toHaveBeenCalled()
  })
})
