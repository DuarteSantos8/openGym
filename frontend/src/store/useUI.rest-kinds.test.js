// @vitest-environment happy-dom
// A sound for each kind of rest (#165): the kind travels on the timer, the native alarm is told
// that kind's sound, and the end on screen plays it; a kind without one plays the rest's sound.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../lib/mobile.js', async importOriginal => ({ ...(await importOriginal()), MOBILE: true }))
vi.mock('../lib/rest-alert.js', () => ({
  armRestAlert: vi.fn(() => Promise.resolve(true)),
  holdRestAlert: vi.fn(),
  disarmRestAlert: vi.fn(),
  bindNativeRest: vi.fn(),
  toneNative: vi.fn(() => Promise.resolve(true)),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ ok: true })) }))

import { useUI, REST_KEY, restoreRest } from './useUI.js'
import { useStore } from './useStore.js'
import { armRestAlert, toneNative } from '../lib/rest-alert.js'

let original
beforeEach(() => {
  vi.useFakeTimers()
  original = useStore.getState().S
  useStore.setState({ S: { ...original, sound: true, timerFlash: false, restSound: 'chime', restSoundByKind: { exercise: 'bell', superset: 'whistle' } }, user: null })
  useUI.setState({ timer: null })
  armRestAlert.mockClear(); toneNative.mockClear()
})
afterEach(() => {
  useUI.getState().stopRest()
  useStore.setState({ S: original, user: null })
  vi.useRealTimers()
})

describe('rest kinds', () => {
  it('books the kind’s own sound with the phone, and plays it at the end', async () => {
    useUI.getState().startRest(5, 0, { rest: 'exercise' })
    expect(useUI.getState().timer.rk).toBe('exercise')
    expect(armRestAlert.mock.calls.at(-1)[1]).toMatchObject({ tone: 'bell' })
    await vi.advanceTimersByTimeAsync(6000)
    expect(toneNative).toHaveBeenCalledWith('bell', expect.anything())
  })
  it('a kind without a sound of its own plays the rest’s', async () => {
    useUI.getState().startRest(5, 0, { rest: 'work' })
    expect(armRestAlert.mock.calls.at(-1)[1]).toMatchObject({ tone: 'chime' })
    await vi.advanceTimersByTimeAsync(6000)
    expect(toneNative).toHaveBeenCalledWith('chime', expect.anything())
  })
  it('an unknown kind is not kept, and a switch-sides pause has none', () => {
    useUI.getState().startRest(5, 0, { rest: 'nap' })
    expect(useUI.getState().timer.rk).toBeUndefined()
    useUI.getState().startRest(5, 0, { kind: 'switch', rest: 'exercise' })
    expect(useUI.getState().timer.rk).toBeUndefined()
  })
  it('keeps its kind through +15 s from Ready and a reload', async () => {
    useUI.getState().startRest(2, 0, { rest: 'superset' })
    await vi.advanceTimersByTimeAsync(3000)
    expect(useUI.getState().timer.ready).toBe(true)
    useUI.getState().addRest(15)
    expect(useUI.getState().timer.rk).toBe('superset')
    const saved = localStorage.getItem(REST_KEY)
    expect(JSON.parse(saved).rk).toBe('superset')
    useStore.setState({ S: { ...useStore.getState().S, active: { id: 'a', entries: [] } } })
    useUI.setState({ timer: null })
    localStorage.setItem(REST_KEY, saved)
    expect(restoreRest()).toBe(true)
    expect(useUI.getState().timer.rk).toBe('superset')
    expect(armRestAlert.mock.calls.at(-1)[1]).toMatchObject({ tone: 'whistle' })
  })
})
