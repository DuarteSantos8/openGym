// @vitest-environment happy-dom
// The get-ready count in front of a flow hold (Settings → Get ready before each hold). It runs
// inside the hold's own timer: the hold's clock starts when it ends, it logs nothing, Pause holds
// it, Start skips it, and a hold that also ran out while the page was away still ends unwatched.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../lib/sound.js', () => ({
  beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), countOver: vi.fn(),
  countdown: vi.fn(), countdownTo: vi.fn(), hush: vi.fn(), holdSession: vi.fn(),
}))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ ok: true })) }))

import { useUI, restoreWork, WORK_KEY } from './useUI.js'
import { useStore } from './useStore.js'
import { countdown, countdownTo, countOver, chime } from '../lib/sound.js'

let originalSettings
const withSettings = extra => useStore.setState({ S: { ...originalSettings, sound: true, timerFlash: false, ...extra }, user: null })
const setHidden = hidden => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}
beforeEach(() => {
  vi.useFakeTimers()
  originalSettings = useStore.getState().S
  withSettings({})
  localStorage.clear()
})
afterEach(() => {
  setHidden(false)
  useUI.getState().stopWork()
  useUI.getState().stopRest()
  useStore.setState({ S: originalSettings })
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('a hold with a get-ready count in front of it', () => {
  it('counts the get-ready first, then the whole hold, and logs only the hold', () => {
    const done = vi.fn()
    useUI.getState().startWork(30, 'Pigeon', done, null, { noOvertime: true, prep: 5 })
    expect(useUI.getState().work).toMatchObject({ prep: 5, prepTotal: 5, left: 30, total: 30 })
    // both ends are queued at once: the count's last seconds, then the hold's
    expect(countdownTo).toHaveBeenLastCalledWith(true, 5, 30)
    vi.advanceTimersByTime(3000)
    expect(useUI.getState().work).toMatchObject({ prep: 2, left: 30 })
    vi.advanceTimersByTime(2000)
    // the count is over: the hold runs, sounded with the count's own two beeps
    expect(useUI.getState().work.prep).toBeUndefined()
    expect(countOver).toHaveBeenCalledWith(true)
    vi.advanceTimersByTime(29000)
    expect(useUI.getState().work.left).toBe(1)
    vi.advanceTimersByTime(1000)
    expect(chime).toHaveBeenCalled()
    expect(done).toHaveBeenCalledTimes(1)
    expect(done.mock.calls[0][0]).toBe(30)
    expect(done.mock.calls[0][1]).toEqual({ chimed: true })   // watched: no `endedAt`
  })

  // The count's end is the same two beeps whatever Settings → Sound picks, for rests or for a kind
  // of rest: with that sound there, the end of the count and the end of the hold after it would be
  // one sound.
  it('ends with its own two beeps whatever the sound setting says', () => {
    withSettings({ restSound: 'bell', restSoundByKind: { set: 'whistle' } })
    useUI.getState().startWork(30, 'Pigeon', vi.fn(), null, { noOvertime: true, prep: 3 })
    vi.advanceTimersByTime(3000)
    expect(countOver).toHaveBeenCalledWith(true)
    expect(chime).not.toHaveBeenCalled()
  })

  it('without one, starts at once as before', () => {
    useUI.getState().startWork(30, 'Pigeon', vi.fn(), null, { prep: 0 })
    expect(useUI.getState().work.prep).toBeUndefined()
    expect(countdown).toHaveBeenLastCalledWith(true, 30)
    expect(countdownTo).not.toHaveBeenCalled()
  })

  it('never counts more than ten seconds, whatever it is asked', () => {
    useUI.getState().startWork(30, 'Pigeon', vi.fn(), null, { prep: 60 })
    expect(useUI.getState().work.prep).toBe(10)
  })

  it('Pause holds the count, and Resume carries on with the whole hold still after it', () => {
    const done = vi.fn()
    useUI.getState().startWork(20, 'Heel slides', done, null, { prep: 5 })
    vi.advanceTimersByTime(2000)
    useUI.getState().pauseWork()
    expect(useUI.getState().work).toMatchObject({ prep: 3, left: 20, paused: true })
    vi.advanceTimersByTime(60000)
    expect(useUI.getState().work).toMatchObject({ prep: 3, left: 20, paused: true })
    useUI.getState().resumeWork()
    expect(countdownTo).toHaveBeenLastCalledWith(true, 3, 20)
    vi.advanceTimersByTime(3000)
    expect(useUI.getState().work.prep).toBeUndefined()
    // The whole hold, from the end of the count: not a second of it went into the count.
    vi.advanceTimersByTime(19000)
    expect(done).not.toHaveBeenCalled()
    expect(useUI.getState().work.left).toBe(1)
    vi.advanceTimersByTime(1000)
    expect(done.mock.calls[0][0]).toBe(20)
  })

  it('Start (the Done button) skips the rest of the count and begins the hold now, logging nothing', () => {
    const done = vi.fn()
    useUI.getState().startWork(20, 'Bird dog', done, null, { prep: 10 })
    vi.advanceTimersByTime(3000)
    useUI.getState().finishWorkEarly()
    expect(done).not.toHaveBeenCalled()
    expect(useUI.getState().work).toMatchObject({ left: 20 })
    expect(useUI.getState().work.prep).toBeUndefined()
    expect(countdown).toHaveBeenLastCalledWith(true, 20)
    vi.advanceTimersByTime(20000)
    expect(done.mock.calls[0][0]).toBe(20)
  })

  it('Start works from a paused count too', () => {
    const done = vi.fn()
    useUI.getState().startWork(20, 'Bird dog', done, null, { prep: 5 })
    useUI.getState().pauseWork()
    useUI.getState().finishWorkEarly()
    expect(useUI.getState().work.paused).toBe(false)
    vi.advanceTimersByTime(20000)
    expect(done.mock.calls[0][0]).toBe(20)
  })

  it('a rest or another hold that displaces it during the count logs nothing', () => {
    const done = vi.fn()
    useUI.getState().startWork(20, 'Bird dog', done, null, { prep: 5 })
    vi.advanceTimersByTime(4000)
    useUI.getState().abandonWork()
    expect(done).not.toHaveBeenCalled()
  })

  it('a hold that also ran out while the page was away still ends unwatched', () => {
    const done = vi.fn()
    useUI.getState().startWork(10, 'Pigeon', done, null, { prep: 5 })
    setHidden(true)
    vi.advanceTimersByTime(20000)
    setHidden(false)
    expect(done).toHaveBeenCalledTimes(1)
    expect(done.mock.calls[0][1]).toMatchObject({ chimed: false, endedAt: expect.any(Number) })   // unwatched
    expect(countOver).not.toHaveBeenCalled()
  })

  it('a Settings change mid-count re-queues both ends', () => {
    useUI.getState().startWork(20, 'Bird dog', vi.fn(), null, { prep: 5 })
    vi.advanceTimersByTime(2000)
    useUI.getState().restartCountdown()
    expect(countdownTo).toHaveBeenLastCalledWith(true, 3, 20)
  })

  // Start pressed off the second must not keep the old tick's phase, or the hold ends up to half a
  // second away from the ticks just queued for it.
  it('Start off the second still ends the hold exactly its length later', () => {
    const done = vi.fn()
    useUI.getState().startWork(20, 'Bird dog', done, null, { prep: 10 })
    vi.advanceTimersByTime(3400)
    useUI.getState().finishWorkEarly()
    vi.advanceTimersByTime(19999)
    expect(done).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(done.mock.calls[0][0]).toBe(20)
  })
})

// v1.3.10 keeps a hold across a reload (gym_work). A count still running comes back as the count,
// with the whole hold still after it; one that ended while the app was away comes back as the
// hold, whose end it already includes — not as 0:38 of a 0:35 hold.
describe('a get-ready count across a reload', () => {
  const owner = { idx: 0, i: 0, id: 'pigeon' }
  const withSession = () => withSettings({ active: { id: 'a', entries: [{ id: 'pigeon', sets: [{ sec: 30 }, { sec: 30 }] }] } })
  const saved = () => JSON.parse(localStorage.getItem(WORK_KEY) || 'null')

  it('is kept with the hold while it runs', () => {
    withSession()
    useUI.getState().startWork(30, 'Pigeon', vi.fn(), owner, { prep: 5 })
    expect(saved()).toMatchObject({ total: 30, prepTotal: 5, owner })
    expect(saved().prepEndsAt).toBe(Date.now() + 5000)
    expect(saved().endsAt).toBe(Date.now() + 35000)
  })

  it('comes back as the count while it is still running', () => {
    withSession()
    const now = Date.now()
    localStorage.setItem(WORK_KEY, JSON.stringify({ endsAt: now + 33_000, total: 30, label: 'Pigeon', overtime: false, owner, prepEndsAt: now + 3_000, prepTotal: 5 }))
    expect(restoreWork()).toBe(true)
    expect(useUI.getState().work).toMatchObject({ prep: 3, prepTotal: 5, left: 30, total: 30 })
    expect(countdownTo).toHaveBeenLastCalledWith(true, 3, 30)
    vi.advanceTimersByTime(3000)
    expect(useUI.getState().work.prep).toBeUndefined()
    expect(useUI.getState().work.left).toBe(30)
  })

  it('comes back as the hold once the count is over', () => {
    withSession()
    const now = Date.now()
    localStorage.setItem(WORK_KEY, JSON.stringify({ endsAt: now + 28_000, total: 30, label: 'Pigeon', overtime: false, owner, prepEndsAt: now - 2_000, prepTotal: 5 }))
    expect(restoreWork()).toBe(true)
    expect(useUI.getState().work.prep).toBeUndefined()
    expect(useUI.getState().work.left).toBe(28)
  })
})
