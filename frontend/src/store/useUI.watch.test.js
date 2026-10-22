// @vitest-environment happy-dom
// The rest timer mirrored on the Apple Watch (lib/watch-link.js): every change to it goes to the
// watch as it is after the change, and a stopped one as null.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ ok: true })) }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))
const { watchRest } = vi.hoisted(() => ({ watchRest: vi.fn() }))
vi.mock('../lib/watch-link.js', () => ({ watchRest, initWatchLink: vi.fn() }))

import { useUI } from './useUI.js'

const last = () => watchRest.mock.calls.at(-1)[0]

describe('the rest timer on the watch', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_790_000_000_000 })
    useUI.setState({ timer: null, work: null })
    watchRest.mockClear()
  })
  afterEach(() => {
    useUI.getState().stopRest()
    vi.useRealTimers()
  })

  it('follows a start, a pause, a resume, +15 s and the stop', () => {
    const ui = useUI.getState()
    ui.startRest(90, 0)
    expect(last()).toBe(useUI.getState().timer)
    expect(last()).toMatchObject({ left: 90, total: 90 })
    vi.advanceTimersByTime(30000)
    ui.pauseRest()
    expect(last()).toMatchObject({ left: 60, paused: true })
    ui.resumeRest()
    expect(last().paused).toBeUndefined()
    ui.addRest(15)
    expect(last()).toMatchObject({ left: 75, total: 90 })
    ui.stopRest()
    expect(last()).toBeNull()
  })

  it('follows the Android notification too', () => {
    useUI.getState().followNativeRest({ endsAt: Date.now() + 40000, left: 40, total: 60, paused: false })
    expect(last()).toMatchObject({ left: 40, total: 60 })
    useUI.getState().followNativeRest({ endsAt: Date.now() + 40000, left: 40, total: 60, paused: true })
    expect(last()).toMatchObject({ paused: true })
  })

  it('is not sent on every tick of the countdown', () => {
    useUI.getState().startRest(90, 0)
    const n = watchRest.mock.calls.length
    vi.advanceTimersByTime(10000)
    expect(watchRest.mock.calls.length).toBe(n)
  })
})
