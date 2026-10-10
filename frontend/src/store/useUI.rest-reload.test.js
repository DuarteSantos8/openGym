// @vitest-environment happy-dom
// A reload mid-rest keeps the countdown (v1.3.11): the rest is kept in localStorage (not sessionStorage, which dies with the app process) and comes
// back at boot while its end is ahead, without booking its end a second time.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ setAccessHeaders: vi.fn(), api: vi.fn(() => Promise.resolve({ ok: true })) }))
const { chime } = vi.hoisted(() => ({ chime: vi.fn() }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime, vibrate: vi.fn(), alertBuzz: vi.fn() }))

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
    useStore.setState({ S: { ...original.S, sound: true }, A: { id: 'a', entries: [] }, user: { id: 'u1' } })
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

  it('a paused rest comes back held', () => {
    localStorage.setItem(REST_KEY, JSON.stringify({ endsAt: Date.now() - 5000, total: 90, forIdx: 0, kind: null, paused: true, left: 33 }))
    expect(restoreRest()).toBe(true)
    expect(useUI.getState().timer).toMatchObject({ left: 33, total: 90, paused: true })
    vi.advanceTimersByTime(60_000)
    expect(useUI.getState().timer.left).toBe(33)
  })

  it('a rest that ended meanwhile, or one with no session running, is dropped', () => {
    localStorage.setItem(REST_KEY, JSON.stringify({ endsAt: Date.now() - 1, total: 90, forIdx: 0, paused: false, left: 3 }))
    expect(restoreRest()).toBe(false)
    expect(useUI.getState().timer).toBeNull()
    expect(saved()).toBeNull()
    useStore.setState({ A: null })
    localStorage.setItem(REST_KEY, JSON.stringify({ endsAt: Date.now() + 30_000, total: 90, forIdx: 0, paused: false, left: 30 }))
    expect(restoreRest()).toBe(false)
    expect(useUI.getState().timer).toBeNull()
  })
})
