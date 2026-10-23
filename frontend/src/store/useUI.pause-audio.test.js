// @vitest-environment happy-dom
// Where the hold pause meets timed-set overtime. A paused hold finished with Done logs what
// it held, not the pause; with overtime on, a pause past the target keeps the seconds over it, and
// Resume counts on up from there.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../lib/sound.js', () => ({
  beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(),
  countdown: vi.fn(), hush: vi.fn(), holdSession: vi.fn(),
}))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ ok: true })) }))

import { holdSession } from '../lib/sound.js'
import { useUI } from './useUI.js'
import { useStore } from './useStore.js'

let originalSettings
const withSettings = extra => useStore.setState({ S: { ...originalSettings, sound: true, timerFlash: false, ...extra }, user: null })
beforeEach(() => {
  vi.useFakeTimers()
  originalSettings = useStore.getState().S
  withSettings({})
})
afterEach(() => {
  useUI.getState().stopWork()
  useUI.getState().stopRest()
  useStore.setState({ S: originalSettings })
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('a hold that must end at its target', () => {
  it('ends there with overtime on, and logs the target', () => {
    withSettings({ timedSetOvertime: true })
    const done = vi.fn()
    useUI.getState().startWork(30, 'Arm circles', done, null, { noOvertime: true })
    expect(useUI.getState().work.overtime).toBe(false)
    vi.advanceTimersByTime(31000)
    expect(useUI.getState().work).toBe(null)
    expect(done).toHaveBeenCalledTimes(1)
    expect(done.mock.calls[0][0]).toBe(30)
  })

  it('without it, the same hold counts past the target', () => {
    withSettings({ timedSetOvertime: true })
    const done = vi.fn()
    useUI.getState().startWork(30, 'Plank', done)
    vi.advanceTimersByTime(31000)
    expect(useUI.getState().work.left).toBeLessThan(0)
    expect(done).not.toHaveBeenCalled()
  })
})

describe('a paused hold finished with Done', () => {
  it('logs the seconds it held, not the pause', () => {
    const done = vi.fn()
    useUI.getState().startWork(45, 'Plank', done)
    vi.advanceTimersByTime(15000)
    useUI.getState().pauseWork()
    vi.advanceTimersByTime(60000)
    useUI.getState().finishWorkEarly()
    expect(done).toHaveBeenCalledTimes(1)
    expect(done.mock.calls[0][0]).toBe(15)
  })

  it('with overtime on, a pause past the target keeps the seconds over it', () => {
    withSettings({ timedSetOvertime: true })
    const done = vi.fn()
    useUI.getState().startWork(35, 'Plank', done)
    vi.advanceTimersByTime(55000)          // 20 s over the target
    useUI.getState().pauseWork()
    expect(useUI.getState().work.left).toBe(-20)
    vi.advanceTimersByTime(300000)
    holdSession.mockClear()
    useUI.getState().resumeWork()
    expect(useUI.getState().work.left).toBe(-20)
    expect(holdSession).not.toHaveBeenCalledWith(true)   // nothing more sounds past the target
    vi.advanceTimersByTime(5000)
    useUI.getState().finishWorkEarly()
    expect(done.mock.calls[0][0]).toBe(60)
  })
})
