// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'
import { beep, setVolume, unlock, VOLUMES } from '../lib/sound.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// A timer already counting picks up a sound change straight away (store/useUI.js).
const ui = vi.hoisted(() => ({ restartCountdown: vi.fn() }))
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
  const snap = () => ({ toast: vi.fn(), openSheet: vi.fn(), restartCountdown: ui.restartCountdown })
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
// The real module decides "supported" from navigator.audioSession, which each test sets up.
// The three things the rows do from the tap — unlock the audio context, set the level, play a
// tone at it — are spied on instead of being made audible.
vi.mock('../lib/sound.js', async importOriginal => {
  const real = await importOriginal()
  return { ...real, unlock: vi.fn(), beep: vi.fn(), setVolume: vi.fn() }
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
  unlock.mockClear(); beep.mockClear(); setVolume.mockClear(); ui.restartCountdown.mockClear()
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

// "Very low" was the one hard-coded level (lib/sound.js VOLUMES.low). The control exists because
// how loud a gym is is not something the app can know.
describe('Settings — sound volume', () => {
  const levelsIn = row => [...row.querySelectorAll('.seg button')]
  const on = row => levelsIn(row).find(b => b.getAttribute('aria-pressed') === 'true')

  it('offers three levels and starts on the loudest, for settings saved before it existed', () => {
    mount()
    const row = rowTitled('Sound volume')
    expect(levelsIn(row).map(b => b.textContent)).toEqual(['Low', 'Medium', 'Loud'])
    expect(on(row).textContent).toBe('Loud')
  })

  it('writes the level, sets it, and plays a tone so you hear what you picked', () => {
    mount()
    act(() => { levelsIn(rowTitled('Sound volume'))[0].click() })
    expect(mocks.S.soundVol).toBe('low')
    expect(setVolume).toHaveBeenCalledWith('low')
    expect(beep).toHaveBeenCalled()
    expect(unlock).toHaveBeenCalledWith(true)
  })

  it('a timer already counting picks the new level up straight away', () => {
    mount()
    act(() => { levelsIn(rowTitled('Sound volume'))[1].click() })
    expect(ui.restartCountdown).toHaveBeenCalled()
  })

  it('shows the saved level, and reads one this build does not know as loud', () => {
    mocks.S.soundVol = 'medium'
    mount()
    expect(on(rowTitled('Sound volume')).textContent).toBe('Medium')
    act(() => root.unmount())
    root = createRoot(host)
    mocks.S.soundVol = 'deafening'
    mount()
    expect(on(rowTitled('Sound volume')).textContent).toBe('Loud')
    expect(VOLUMES.deafening).toBeUndefined()
  })

  it('is not offered while Sounds is off', () => {
    mocks.S.sound = false
    mount()
    expect(rowTitled('Sound volume')).toBeUndefined()
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
