// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings, { RestSoundSheet, RestKindSoundSheet } from './Settings.jsx'
import { chime, unlock } from '../lib/sound.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, openSheet: null }
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
  const snap = () => ({ toast: vi.fn(), openSheet: mocks.openSheet || vi.fn() })
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
  return { ...real, unlock: vi.fn(), chime: vi.fn() }
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
  chime.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  setAudioSession(undefined)
})

const mount = (page = 'alerts') => act(() => root.render(<Settings page={page} />))
const rowTitled = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const switchIn = row => row.querySelector('[role="switch"]') || row.querySelector('input[type="checkbox"]') || row.querySelector('button')

describe('Settings — play sounds when the phone is on silent', () => {
  it('is offered on a browser with an audio session (iOS), under the sound rows, with the music trade-off spelled out', () => {
    mount()
    const row = rowTitled('Play even on silent')
    expect(row).toBeTruthy()
    expect(row.querySelector('.lrow-s').textContent).toBe('Music playing on this phone stops during a workout and does not resume by itself.iPhone only')
    const rows = [...host.querySelectorAll('.lrow')]
    expect(rows.indexOf(row)).toBe(rows.indexOf(rowTitled('Sound')) + 1)
  })

  it('is not offered where the browser has no audio session API', () => {
    setAudioSession(undefined)
    mount()
    expect(rowTitled('Play even on silent')).toBeUndefined()
  })

  it('is not offered on macOS Safari, which has the API but no ring/silent switch', () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', configurable: true })
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true })
    mount()
    expect(rowTitled('Play even on silent')).toBeUndefined()
  })

  it('is not offered while Sounds is off', () => {
    mocks.S.sound = false
    mount()
    expect(rowTitled('Play even on silent')).toBeUndefined()
  })

  it('writes soundOnSilent to the store', () => {
    mount()
    const sw = switchIn(rowTitled('Play even on silent'))
    expect(sw).toBeTruthy()
    act(() => { sw.click() })
    expect(mocks.S.soundOnSilent).toBe(true)
  })
})

describe('Settings — Play a sound unlocks audio from the tap', () => {
  it('turning Sounds on unlocks; turning it off does not', () => {
    mocks.S.sound = false
    mount()
    act(() => { switchIn(rowTitled('Play a sound')).click() })
    expect(mocks.S.sound).toBe(true)
    expect(unlock).toHaveBeenCalledWith(true)
    unlock.mockClear()
    mount()
    act(() => { switchIn(rowTitled('Play a sound')).click() })
    expect(mocks.S.sound).toBe(false)
    expect(unlock).not.toHaveBeenCalled()
  })
})

describe('Settings — optional timed-set overtime', () => {
  it('offers the opt-in in Fine-tuning and writes the preference', () => {
    mount('advanced')
    const row = rowTitled('Keep timing after target')
    expect(row).toBeTruthy()
    expect(row.querySelector('.lrow-s').textContent).toBe('Timed sets continue up to 15 extra minutes. Tap Done to log the actual duration.')
    const sw = switchIn(row)
    expect(sw.getAttribute('aria-label')).toBe('Keep timing after target')
    act(() => { sw.click() })
    expect(mocks.S.timedSetOvertime).toBe(true)
  })
})

// Discord (asierlama): the buzz on or off on its own, the way the sound is.
describe('Settings — vibrate', () => {
  const setVibrateApi = value => Object.defineProperty(navigator, 'vibrate', { value, configurable: true, writable: true })
  afterEach(() => { delete navigator.vibrate })

  it('is offered where the browser can vibrate, on by default, below the sound rows', () => {
    setVibrateApi(() => true)
    mount()
    const row = rowTitled('Vibrate')
    expect(row).toBeTruthy()
    expect(switchIn(row).getAttribute('aria-checked')).toBe('true')
    const rows = [...host.querySelectorAll('.lrow')]
    expect(rows.indexOf(row)).toBeGreaterThan(rows.indexOf(rowTitled('Play a sound')))
    expect(rows.indexOf(row)).toBeLessThan(rows.indexOf(rowTitled('Flash the screen')))
  })

  it('stays on offer with Sounds off: the buzz does not depend on the sound', () => {
    setVibrateApi(() => true)
    mocks.S.sound = false
    mount()
    expect(rowTitled('Vibrate')).toBeTruthy()
  })

  it('writes vibrate to the store, off and back on', () => {
    setVibrateApi(() => true)
    mount()
    act(() => { switchIn(rowTitled('Vibrate')).click() })
    expect(mocks.S.vibrate).toBe(false)
    mount()
    expect(switchIn(rowTitled('Vibrate')).getAttribute('aria-checked')).toBe('false')
    act(() => { switchIn(rowTitled('Vibrate')).click() })
    expect(mocks.S.vibrate).toBe(true)
  })

  // v1.3.11: an iPhone user looking for Vibrate finds it, greyed out, with the reason.
  it('on an iPhone (no navigator.vibrate) the row stays, disabled, says "Not on iPhone" and explains below', () => {
    setVibrateApi(undefined)
    mount()
    const row = rowTitled('Vibrate')
    expect(row).toBeTruthy()
    expect(row.classList.contains('dis')).toBe(true)
    expect(row.querySelector('.lrow-s').textContent).toBe('Not on iPhone')
    expect(switchIn(row).disabled).toBe(true)
    expect(switchIn(row).getAttribute('aria-checked')).toBe('false')
    expect(host.textContent).toContain('iPhone doesn’t let openGym vibrate. A sound or a flash does the job.')
  })

  it('a desktop browser without vibration shows it disabled as not supported, with no iPhone footer', () => {
    setVibrateApi(undefined)
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/130.0', configurable: true })
    mount()
    expect(rowTitled('Vibrate').querySelector('.lrow-s').textContent).toBe('Not supported in this browser.')
    expect(host.textContent).not.toContain('iPhone doesn’t let openGym vibrate')
  })
})

describe('Settings — which sound', () => {
  it('shows the chime by default and Classic beeps for classicChime, only while sound is on', () => {
    mount()
    expect(rowTitled('Sound').querySelector('.lrow-v').textContent).toBe('Chime (louder)')
    mocks.S.classicChime = true
    mount()
    expect(rowTitled('Sound').querySelector('.lrow-v').textContent).toBe('Classic beeps')
    mocks.S.sound = false
    mount()
    expect(rowTitled('Sound')).toBeUndefined()
  })

  // #306: a few sounds to pick from, each heard as it is picked.
  it('names the picked sound on the row; an older app\'s classic switch still reads as Classic', () => {
    mocks.S.restSound = 'whistle'
    mount()
    expect(rowTitled('Sound').querySelector('.lrow-v').textContent).toBe('Whistle')
    mocks.S.classicChime = true
    mount()
    expect(rowTitled('Sound').querySelector('.lrow-v').textContent).toBe('Classic beeps')
  })

  it('the sheet lists every sound, ticks the current one, and plays and stores each one tapped', () => {
    const close = vi.fn()
    // the mocked store does not re-render on its own: render again to read the new tick
    const render = () => act(() => root.render(<RestSoundSheet close={close} />))
    render()
    expect([...host.querySelector('.sect').querySelectorAll('.lrow-t')].map(e => e.textContent)).toEqual(['Chime (louder)', 'Classic beeps', 'Bell', 'Beep-beep', 'Whistle', 'Soft'])
    expect(rowTitled('Chime (louder)').querySelector('.lrow-k')).toBeTruthy()

    act(() => { rowTitled('Bell').click() })
    expect(mocks.S).toMatchObject({ restSound: 'bell', classicChime: false })
    expect(chime).toHaveBeenLastCalledWith(true, 'bell')
    expect(unlock).toHaveBeenCalled()
    render()
    expect(rowTitled('Bell').querySelector('.lrow-k')).toBeTruthy()
    expect(rowTitled('Chime (louder)').querySelector('.lrow-k')).toBeNull()
    expect(close).not.toHaveBeenCalled()

    // Classic keeps the old switch in step, so an app from before #306 plays it too
    act(() => { rowTitled('Classic beeps').click() })
    expect(mocks.S).toMatchObject({ restSound: 'classic', classicChime: true })
    expect(chime).toHaveBeenLastCalledWith(true, 'classic')
    act(() => { rowTitled('Soft').click() })
    expect(mocks.S).toMatchObject({ restSound: 'soft', classicChime: false })

    act(() => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Done').click() })
    expect(close).toHaveBeenCalled()
  })

  // A kind of rest can end with a sound of its own (S.restSoundByKind), picked in a sheet of its
  // own from the same six and heard as it is picked; "Same as …" takes the kind out again.
  it('lists the three kinds of rest under the sounds, each on Same as above until given one', () => {
    mocks.S.restSound = 'bell'
    mocks.S.restSoundByKind = { round: 'whistle' }
    mocks.openSheet = vi.fn()
    act(() => root.render(<RestSoundSheet close={vi.fn()} />))
    expect(host.textContent).toContain('A sound for each kind of rest')
    expect(rowTitled('Next set').querySelector('.lrow-v').textContent).toBe('Same as above')
    expect(rowTitled('Next round').querySelector('.lrow-v').textContent).toBe('Whistle')
    expect(rowTitled('Next exercise').querySelector('.lrow-v').textContent).toBe('Same as above')
    act(() => { rowTitled('Next exercise').click() })
    expect(mocks.openSheet).toHaveBeenCalledTimes(1)
    mocks.openSheet = null
  })

  it('a kind\'s sheet plays and stores each pick, and Same as … takes only that kind out', () => {
    mocks.S.restSound = 'bell'
    mocks.S.restSoundByKind = { set: 'beep' }
    const close = vi.fn()
    const render = () => act(() => root.render(<RestKindSoundSheet kind="block" close={close} />))
    render()
    expect(host.querySelector('h3').textContent).toBe('Next exercise')
    expect([...host.querySelectorAll('.lrow-t')].map(e => e.textContent)).toEqual(['Same as Bell', 'Chime (louder)', 'Classic beeps', 'Bell', 'Beep-beep', 'Whistle', 'Soft'])
    expect(rowTitled('Same as Bell').querySelector('.lrow-k')).toBeTruthy()

    act(() => { rowTitled('Whistle').click() })
    expect(mocks.S.restSoundByKind).toEqual({ set: 'beep', block: 'whistle' })
    expect(mocks.S.restSound).toBe('bell')
    expect(chime).toHaveBeenLastCalledWith(true, 'whistle')
    expect(unlock).toHaveBeenCalled()
    render()
    expect(rowTitled('Whistle').querySelector('.lrow-k')).toBeTruthy()
    expect(rowTitled('Same as Bell').querySelector('.lrow-k')).toBeNull()

    act(() => { rowTitled('Same as Bell').click() })
    expect(mocks.S.restSoundByKind).toEqual({ set: 'beep' })
    expect(chime).toHaveBeenLastCalledWith(true, 'bell')
    expect(close).not.toHaveBeenCalled()
    act(() => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Done').click() })
    expect(close).toHaveBeenCalled()
  })

  it('the last kind taken out leaves no empty map behind', () => {
    mocks.S.restSoundByKind = { round: 'soft' }
    act(() => root.render(<RestKindSoundSheet kind="round" close={vi.fn()} />))
    act(() => { rowTitled('Same as Chime (louder)').click() })
    expect('restSoundByKind' in mocks.S).toBe(false)
  })
})

