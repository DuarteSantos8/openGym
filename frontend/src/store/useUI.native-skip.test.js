// @vitest-environment happy-dom
// The Android rest notification's own Skip. It ends the rest there and here, and hands over the
// way a rest that ran out in a pocket does: the screen moves on for when the app is opened, and
// no hold starts that nobody watched (the hand-over is told `seen: false`). The in-app Skip is
// seen, since you tapped it.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

const h = vi.hoisted(() => ({ native: null }))
vi.mock('../lib/mobile.js', async importOriginal => ({ ...(await importOriginal()), MOBILE: true }))
vi.mock('../lib/rest-alert.js', () => ({
  armRestAlert: vi.fn(() => Promise.resolve(true)),
  holdRestAlert: vi.fn(),
  disarmRestAlert: vi.fn(),
  bindNativeRest: vi.fn(cb => { h.native = cb }),
}))
vi.mock('../lib/sound.js', () => ({
  beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), restOver: vi.fn(),
  countdown: vi.fn(), hush: vi.fn(), holdSession: vi.fn(),
}))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ ok: true })) }))

import { useUI } from './useUI.js'
import { useStore } from './useStore.js'
import { disarmRestAlert } from '../lib/rest-alert.js'

let originalSettings
beforeEach(() => {
  vi.useFakeTimers()
  originalSettings = useStore.getState().S
  useStore.setState({ S: { ...originalSettings, sound: true, timerFlash: false }, user: null })
})
afterEach(() => {
  useUI.getState().stopRest()
  useStore.setState({ S: originalSettings })
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("the rest notification's Skip", () => {
  it('ends the rest and hands over unseen: the screen moves, no hold starts', () => {
    const done = vi.fn()
    useUI.getState().startRest(90, 2, 'block', null, done)
    h.native({ type: 'skip' })
    expect(useUI.getState().timer).toBe(null)
    expect(disarmRestAlert).toHaveBeenCalled()
    expect(done).toHaveBeenCalledTimes(1)
    expect(done).toHaveBeenCalledWith(2, false)
  })

  it('the Skip in the app is seen', () => {
    const done = vi.fn()
    useUI.getState().startRest(90, 1, 'set', null, done)
    useUI.getState().skipRest()
    expect(done).toHaveBeenCalledWith(1, true)
  })

  it('a rest with nothing to hand over just ends', () => {
    useUI.getState().startRest(60, 0, 'set')
    expect(() => h.native({ type: 'skip' })).not.toThrow()
    expect(useUI.getState().timer).toBe(null)
  })
})
