// @vitest-environment happy-dom
// The locked-phone bug: the WebView countdown never reaches zero, so the only alert that
// can fire is the one armed when the rest starts. Completing (or catching up) must not
// cancel it. Skipping the rest must.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { useUI } from './useUI.js'
import { useStore } from './useStore.js'
import { armRestAlert, disarmRestAlert } from '../lib/rest-alert.js'
import { beep, vibrate } from '../lib/sound.js'

vi.mock('../lib/rest-alert.js', () => ({
  armRestAlert: vi.fn(() => Promise.resolve(true)),
  disarmRestAlert: vi.fn(),
  hushRestTone: vi.fn(),
  bindNativeRest: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

const hide = hidden => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' })
  document.dispatchEvent(new Event('visibilitychange'))
}

let originalSettings
beforeEach(() => {
  vi.useFakeTimers()
  originalSettings = useStore.getState().S
  useStore.setState({ S: { ...originalSettings, sound: true, timerFlash: false }, user: null })
  useUI.setState({ timer: null, timerFlashId: 0 })
  armRestAlert.mockClear()
  disarmRestAlert.mockClear()
  beep.mockClear()
  vibrate.mockClear()
  hide(false)
})
afterEach(() => {
  useUI.getState().stopRest()
  useStore.setState({ S: originalSettings })
  hide(false)
  vi.useRealTimers()
})

describe('native rest alert', () => {
  it('arms when the rest starts and rearms when time is added', () => {
    useUI.getState().startRest(90)
    const first = armRestAlert.mock.calls.at(-1)[0]
    useUI.getState().addRest(15)
    const second = armRestAlert.mock.calls.at(-1)[0]
    expect(second - first).toBe(15_000)
    expect(armRestAlert).toHaveBeenLastCalledWith(second, expect.objectContaining({
      title: 'Rest over', countdownTitle: 'Rest', totalSec: 105, sound: true,
    }))
  })

  it('keeps the alarm when the countdown ends, including while the app is hidden', () => {
    useUI.getState().startRest(90)
    const armed = disarmRestAlert.mock.calls.length
    hide(true)
    vi.setSystemTime(Date.now() + 91_000)
    hide(false) // reopening catches up; the alarm armed at the start must still be pending
    expect(disarmRestAlert.mock.calls.length).toBe(armed)
    expect(useUI.getState().timer).toBe(null)
    expect(beep).not.toHaveBeenCalled()
  })

  it('cancels the alarm when the rest is skipped', () => {
    useUI.getState().startRest(90)
    const armed = disarmRestAlert.mock.calls.length
    useUI.getState().stopRest()
    expect(disarmRestAlert.mock.calls.length).toBe(armed + 1)
  })

  it('still plays the in-app beep when the rest finishes on screen', () => {
    useStore.setState({ S: { ...useStore.getState().S, timerFlash: true } })
    useUI.getState().startRest(1)
    vi.advanceTimersByTime(1000)
    expect(beep).toHaveBeenCalled()
    expect(useUI.getState().timerFlashId).toBe(1)
  })

  it('stays open when time is added as the countdown hits zero', () => {
    useUI.getState().startRest(1)
    vi.advanceTimersByTime(500)
    const tm = useUI.getState().timer
    useUI.setState({ timer: { ...tm, endsAt: Date.now() + 15_000, left: 15, total: tm.total + 15 } })
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().timer).not.toBe(null)
    expect(useUI.getState().timer.left).toBeGreaterThan(10)
  })

  it('reopens the rest after it closed if the notification added time', () => {
    useUI.getState().startRest(1)
    vi.advanceTimersByTime(1500)
    expect(useUI.getState().timer).toBe(null)
    useUI.getState().reviveRest(Date.now() + 15_000, 16, 15, false)
    expect(useUI.getState().timer.left).toBe(15)
    vi.advanceTimersByTime(2000)
    expect(useUI.getState().timer.left).toBeLessThan(15)
  })

  it('does not finish a rest that was paused', () => {
    useUI.getState().startRest(2)
    useUI.setState({ timer: { ...useUI.getState().timer, paused: true } })
    vi.advanceTimersByTime(5000)
    expect(useUI.getState().timer).not.toBe(null)
    expect(useUI.getState().timer.paused).toBe(true)
  })

  it('plays the last-seconds ticks', () => {
    useUI.getState().startRest(5)
    vi.advanceTimersByTime(3000)
    expect(beep).toHaveBeenCalled()
  })

  it('still schedules an alert when sound is off', () => {
    useStore.setState({ S: { ...useStore.getState().S, sound: false } })
    useUI.getState().startRest(90)
    expect(armRestAlert).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({ sound: false }))
  })
})
