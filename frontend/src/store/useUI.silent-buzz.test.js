// @vitest-environment happy-dom
// #375: on silent, the end of a rest buzzed nowhere — the page's buzz and the notification
// channel's are both muted. With "Vibrate when the phone is on silent" on, the native alarm is
// told to buzz as an alarm, and the page's own end-of-rest buzz goes through alertBuzz (which
// App.jsx points at the native alarm buzz). A set tick stays an ordinary buzz.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/mobile.js', async importOriginal => ({ ...(await importOriginal()), MOBILE: true }))
vi.mock('../lib/rest-alert.js', () => ({
  armRestAlert: vi.fn(() => Promise.resolve(true)),
  holdRestAlert: vi.fn(),
  disarmRestAlert: vi.fn(),
  bindNativeRest: vi.fn(),
  toneNative: vi.fn(() => Promise.resolve(true)),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), countdown: vi.fn(), hush: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ ok: true })) }))

import { useUI, bindAuto } from './useUI.js'
import { useStore } from './useStore.js'
import { armRestAlert } from '../lib/rest-alert.js'
import { alertBuzz, chime, vibrate } from '../lib/sound.js'
import { toneNative } from '../lib/rest-alert.js'

let original
beforeEach(() => {
  vi.useFakeTimers()
  original = useStore.getState().S
  useUI.setState({ timer: null, timerFlashId: 0 })
  for (const f of [armRestAlert, alertBuzz, chime, vibrate]) f.mockClear()
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
})
afterEach(() => {
  useUI.getState().stopRest()
  useStore.setState({ S: original })
  vi.useRealTimers()
})

const withSettings = over => useStore.setState({ S: { ...original, sound: false, ...over }, user: null })

describe('vibrate on silent', () => {
  it('asks the native alarm for an alarm buzz only with the setting and Vibrate both on', () => {
    withSettings({ vibrate: true, vibrateOnSilent: true })
    useUI.getState().startRest(60)
    expect(armRestAlert).toHaveBeenLastCalledWith(expect.any(Number), expect.objectContaining({ vibrate: true, alarmBuzz: true }))

    withSettings({ vibrate: false, vibrateOnSilent: true })
    useUI.getState().startRest(60)
    expect(armRestAlert).toHaveBeenLastCalledWith(expect.any(Number), expect.objectContaining({ vibrate: false, alarmBuzz: false }))

    withSettings({ vibrate: true })
    useUI.getState().startRest(60)
    expect(armRestAlert).toHaveBeenLastCalledWith(expect.any(Number), expect.objectContaining({ alarmBuzz: false }))
  })

  // Discord "Rest Timer Sound Notification too Quiet": the locked phone's tone follows Settings → Sound.
  it('tells the native alarm which end tone to play', () => {
    withSettings({ sound: true })
    useUI.getState().startRest(60)
    expect(armRestAlert).toHaveBeenLastCalledWith(expect.any(Number), expect.objectContaining({ sound: true, classic: false }))
    withSettings({ sound: true, classicChime: true })
    useUI.getState().startRest(60)
    expect(armRestAlert).toHaveBeenLastCalledWith(expect.any(Number), expect.objectContaining({ sound: true, classic: true, tone: 'classic' }))
    withSettings({ sound: true, restSound: 'bell' })
    useUI.getState().startRest(60)
    expect(armRestAlert).toHaveBeenLastCalledWith(expect.any(Number), expect.objectContaining({ sound: true, classic: false, tone: 'bell' }))
  })

  // A kind of rest with a sound of its own (Settings → Sound) rings that one on a locked phone
  // too. The switch-sides pause is no kind of rest and keeps the profile's.
  it('tells the native alarm the sound of this kind of rest', () => {
    withSettings({ sound: true, restSound: 'bell', restSoundByKind: { round: 'whistle', block: 'classic' } })
    useUI.getState().startRest(60, 0, { kind: 'round' })
    expect(armRestAlert).toHaveBeenLastCalledWith(expect.any(Number), expect.objectContaining({ tone: 'whistle', classic: false }))
    useUI.getState().startRest(60, 0, { kind: 'block' })
    expect(armRestAlert).toHaveBeenLastCalledWith(expect.any(Number), expect.objectContaining({ tone: 'classic', classic: true }))
    useUI.getState().startRest(60, 0, { kind: 'set' })
    expect(armRestAlert).toHaveBeenLastCalledWith(expect.any(Number), expect.objectContaining({ tone: 'bell', classic: false }))
    useUI.getState().startRest(10, 0, { kind: 'switch' })
    expect(armRestAlert).toHaveBeenLastCalledWith(expect.any(Number), expect.objectContaining({ tone: 'bell' }))
  })

  // A rest before a hold that starts by itself (lib/auto-holds.js) books the chain with it: the
  // hold's Go and its end ring with the same tone, and on screen that rest ends in the count-in,
  // not a sound of its own. So it keeps the profile's sound, as a hold does.
  it('books the chain after a rest with the profile\'s sound, whatever the kind\'s', () => {
    withSettings({ sound: true, restSound: 'bell', restSoundByKind: { set: 'whistle' } })
    const unbind = bindAuto({ peek: () => ({ idx: 0, i: 1, id: 'plank', plan: 30, label: 'Plank' }), focus: () => {}, startHold: () => {}, forecast: () => [] })
    try {
      useUI.getState().startRest(60, 0, { kind: 'set' })
      expect(armRestAlert).toHaveBeenLastCalledWith(expect.any(Number), expect.objectContaining({ tone: 'bell', classic: false, cues: expect.any(Array) }))
    } finally { unbind() }
    useUI.getState().startRest(60, 0, { kind: 'set' })
    expect(armRestAlert).toHaveBeenLastCalledWith(expect.any(Number), expect.objectContaining({ tone: 'whistle' }))
  })

  // #306: the page plays the picked sound too, on screen, at the end of a rest.
  it('chimes the sound Settings → Sound picked', async () => {
    withSettings({ sound: true, restSound: 'soft' })
    useUI.getState().startRest(2)
    await vi.advanceTimersByTimeAsync(3000)
    expect(toneNative).toHaveBeenCalledWith('soft', { onSilent: false })
  })

  // Discord (baodor): "Play even on silent" goes to the native tone, which rings through the
  // switch and only turns the music down, instead of the page's exclusive 'playback' session.
  it('tells the native tone when it should ring through silent', async () => {
    withSettings({ sound: true, restSound: 'bell', soundOnSilent: true })
    useUI.getState().startRest(2)
    await vi.advanceTimersByTimeAsync(3000)
    expect(toneNative).toHaveBeenCalledWith('bell', { onSilent: true })
  })

  it('the end of a rest seen on screen buzzes through alertBuzz', async () => {
    withSettings({ vibrate: true, vibrateOnSilent: true })
    useUI.getState().startRest(2)
    await vi.advanceTimersByTimeAsync(3000)
    expect(alertBuzz).toHaveBeenCalledWith([200, 100, 200])
    expect(vibrate).not.toHaveBeenCalledWith([200, 100, 200])
  })

  it('a hold that ends early only ticks, the ordinary way', () => {
    withSettings({ vibrate: true, vibrateOnSilent: true })
    useUI.getState().startWork(30, 'Plank', () => {})
    useUI.getState().finishWorkEarly()
    expect(vibrate).toHaveBeenCalledWith(30)
    expect(alertBuzz).not.toHaveBeenCalled()
  })

  it('is off for a profile that never chose', async () => {
    const { DEF } = await import('./useStore.js')
    expect(DEF.vibrateOnSilent).toBe(false)
  })
})
