// @vitest-environment happy-dom
// A reload mid-rest keeps the countdown (v1.3.11): the rest is kept in localStorage (not sessionStorage, which dies with the app process) and comes
// back at boot while its end is ahead, without booking its end a second time.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ ok: true })) }))
const { chime, countdown } = vi.hoisted(() => ({ chime: vi.fn(), countdown: vi.fn() }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime, vibrate: vi.fn(), alertBuzz: vi.fn(), countdown, hush: vi.fn(), holdSession: vi.fn() }))

import { api } from '../lib/api.js'
import { useUI, restoreRest, REST_KEY } from './useUI.js'
import { useStore } from './useStore.js'

const saved = () => JSON.parse(localStorage.getItem(REST_KEY) || 'null')
const pushes = () => api.mock.calls.filter(([p]) => p === '/api/push/rest-timer')

describe('the rest timer across a reload', () => {
  let original
  beforeEach(() => {
    vi.useFakeTimers()
    original = { S: useStore.getState().S, user: useStore.getState().user }
    useStore.setState({ S: { ...original.S, sound: true, active: { id: 'a', entries: [] } }, user: { id: 'u1' } })
    useUI.setState({ timer: null, work: null, toastMsg: '' })
    localStorage.clear()
    api.mockClear(); chime.mockClear()
  })
  afterEach(() => {
    useUI.getState().stopRest()
    useStore.setState(original)
    vi.useRealTimers()
  })

  it('keeps the running rest, and forgets it once it is skipped', () => {
    useUI.getState().startRest(90, 2)
    expect(saved()).toMatchObject({ total: 90, forIdx: 2, paused: false, kind: null })
    expect(saved().endsAt).toBe(useUI.getState().timer.endsAt)
    useUI.getState().pauseRest()
    expect(saved()).toMatchObject({ paused: true, left: 90 })
    useUI.getState().stopRest()
    expect(saved()).toBeNull()
  })

  it('comes back at boot with the time left, books nothing new, and chimes once at the end', () => {
    const endsAt = Date.now() + 40_000
    localStorage.setItem(REST_KEY, JSON.stringify({ endsAt, total: 90, forIdx: 1, kind: null, paused: false, left: 50 }))
    expect(restoreRest()).toBe(true)
    expect(useUI.getState().timer).toMatchObject({ left: 40, total: 90, endsAt, forIdx: 1 })
    expect(pushes()).toEqual([])
    vi.advanceTimersByTime(41_000)
    expect(useUI.getState().timer).toMatchObject({ ready: true, left: 0 })
    expect(chime).toHaveBeenCalledTimes(1)
    expect(saved()).toBeNull()
  })

  // The push booked before the reload survives it, so whether the server took it comes back too:
  // a rest that then runs out on a hidden page leaves the alert to that push, or, when the server
  // never took it, shows the local one in its place.
  it('keeps whether the server took the push, and a hidden end after the reload alerts only when it did not', async () => {
    const shown = vi.fn()
    globalThis.Notification = { permission: 'granted' }
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => ({ showNotification: shown, pushManager: { getSubscription: async () => ({ endpoint: 'https://push.example/x' }) } }) } })
    const hide = hidden => { Object.defineProperty(document, 'hidden', { configurable: true, value: hidden }); document.dispatchEvent(new Event('visibilitychange')) }
    const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
    try {
      useUI.getState().startRest(90, 2)
      expect(saved().pushed).toBe(false)             // asked, not answered yet
      await flush()
      expect(saved().pushed).toBe(true)              // the server took it
      for (const [pushed, alerts] of [[true, 0], [false, 1]]) {
        useUI.getState().stopRest(); hide(false); shown.mockClear()
        localStorage.setItem(REST_KEY, JSON.stringify({ endsAt: Date.now() + 40_000, total: 90, forIdx: 1, kind: null, paused: false, left: 50, pushed }))
        expect(restoreRest()).toBe(true)
        hide(true)
        vi.advanceTimersByTime(41_000)
        await flush()
        expect(shown).toHaveBeenCalledTimes(alerts)
      }
    } finally {
      hide(false)
      delete globalThis.Notification
      delete navigator.serviceWorker
    }
  })

  it('queues the count-in again for the time that is left, and none for a paused one', () => {
    localStorage.setItem(REST_KEY, JSON.stringify({ endsAt: Date.now() + 40_000, total: 90, forIdx: 1, kind: null, paused: false, left: 50 }))
    countdown.mockClear()
    expect(restoreRest()).toBe(true)
    expect(countdown).toHaveBeenLastCalledWith(true, 40)
    useUI.setState({ timer: null })
    countdown.mockClear()
    localStorage.setItem(REST_KEY, JSON.stringify({ endsAt: Date.now() - 5000, total: 90, forIdx: 0, kind: null, paused: true, left: 33 }))
    expect(restoreRest()).toBe(true)
    expect(countdown).not.toHaveBeenCalled()
  })

  it('a paused rest comes back held', () => {
    localStorage.setItem(REST_KEY, JSON.stringify({ endsAt: Date.now() - 5000, total: 90, forIdx: 0, kind: null, paused: true, left: 33 }))
    expect(restoreRest()).toBe(true)
    expect(useUI.getState().timer).toMatchObject({ left: 33, total: 90, paused: true })
    vi.advanceTimersByTime(60_000)
    expect(useUI.getState().timer.left).toBe(33)
  })

  // The kind picks the sound the rest ends with (Settings → Sound), and with the phase the bar's
  // word: a reload keeps both.
  it('keeps what the rest leads into across a reload, and ends with that kind\'s sound', () => {
    useStore.setState({ S: { ...useStore.getState().S, restSound: 'bell', restSoundByKind: { block: 'whistle' } } })
    useUI.getState().startRest(90, 2, { kind: 'block', phase: 'work' })
    expect(saved()).toMatchObject({ kind: 'block', phase: 'work' })
    const kept = saved()
    useUI.setState({ timer: null })
    localStorage.setItem(REST_KEY, JSON.stringify(kept))
    expect(restoreRest()).toBe(true)
    expect(useUI.getState().timer).toMatchObject({ kind: 'block', phase: 'work', forIdx: 2 })
    vi.advanceTimersByTime(91_000)
    expect(chime).toHaveBeenCalledWith(true, 'whistle')
  })

  it('a rest that ended meanwhile, or one with no session running, is dropped', () => {
    localStorage.setItem(REST_KEY, JSON.stringify({ endsAt: Date.now() - 1, total: 90, forIdx: 0, paused: false, left: 3 }))
    expect(restoreRest()).toBe(false)
    expect(useUI.getState().timer).toBeNull()
    expect(saved()).toBeNull()
    useStore.setState({ S: { ...useStore.getState().S, active: null } })
    localStorage.setItem(REST_KEY, JSON.stringify({ endsAt: Date.now() + 30_000, total: 90, forIdx: 0, paused: false, left: 30 }))
    expect(restoreRest()).toBe(false)
    expect(useUI.getState().timer).toBeNull()
  })
})
