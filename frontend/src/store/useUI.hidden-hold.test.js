// @vitest-environment happy-dom
// A hold that runs out while the page is hidden finishes on the first tick back (runWork), and the
// rest it earned starts there. The owner's call: that rest has been counting since the hold ended,
// time away taken off (the workout screen starts it and moves it back to the hold's end,
// useUI.backdateRest), and one that is over too ends the way a rest that ran out unseen does:
// Ready and its toast, no sound. Nothing alerts while the phone is locked: nothing is booked until
// the page is back, and then only the end that is still ahead.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ ok: true })) }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), countdown: vi.fn(), hush: vi.fn(), holdSession: vi.fn() }))

import { api } from '../lib/api.js'
import { chime, countdown, holdSession } from '../lib/sound.js'
import { useUI, REST_KEY } from './useUI.js'
import { useStore } from './useStore.js'

const pushes = () => api.mock.calls.filter(([p]) => p === '/api/push/rest-timer').map(([, o]) => JSON.parse(o.body).seconds)
const cancels = () => api.mock.calls.filter(([p]) => p === '/api/push/rest-timer/cancel').length
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
// A booking the server has not answered yet; `land()` answers it.
const slowBooking = () => {
  let land
  api.mockImplementationOnce(() => new Promise(r => { land = () => r({ ok: true }) }))
  return () => land()
}
// What Workout.jsx holdDone does with a hold that ended `since`: the rest it earned, moved back.
const restSince = (sec, kind, since) => {
  useUI.getState().startRest(sec, 0, { kind })
  useUI.getState().backdateRest(since)
}

let original
beforeEach(() => {
  vi.useFakeTimers()
  original = { S: useStore.getState().S, user: useStore.getState().user }
  useStore.setState({ S: { ...original.S, active: { id: 'a', cur: 0, entries: [] }, sound: true, timerFlash: false, restSound: 'bell' }, user: { id: 'u1' } })
  useUI.setState({ timer: null, work: null, toastMsg: '' })
  localStorage.clear()
  for (const f of [api, chime, countdown, holdSession]) f.mockClear()
})
afterEach(() => {
  useUI.getState().stopRest()
  useStore.setState(original)
  vi.useRealTimers()
})

describe('the rest after a hold that ran out while the page was hidden', () => {
  it('has been counting since the hold ended: the time left, its count-in and its push are what is really left', async () => {
    const since = Date.now() - 30_000
    restSince(90, 'set', since)
    await flush()
    expect(useUI.getState().timer).toMatchObject({ left: 60, total: 90, endsAt: since + 90_000 })
    expect(countdown).toHaveBeenLastCalledWith(true, 60)
    expect(holdSession).toHaveBeenLastCalledWith(true)
    expect(pushes().at(-1)).toBe(60)
    expect(JSON.parse(localStorage.getItem(REST_KEY))).toMatchObject({ endsAt: since + 90_000, total: 90 })
  })

  it('and its end, on screen, is a seen one: its sound plays', () => {
    restSince(90, 'set', Date.now() - 30_000)
    vi.advanceTimersByTime(59_000)
    expect(useUI.getState().timer).toMatchObject({ left: 1 })
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().timer).toMatchObject({ left: 0, ready: true })
    expect(chime).toHaveBeenCalledWith(true, 'bell')
  })

  it('one that is over too ends now, as a rest that ran out unseen: Ready, its toast, no sound', async () => {
    restSince(90, 'set', Date.now() - 120_000)
    await flush()
    expect(useUI.getState().timer).toMatchObject({ left: 0, ready: true, total: 90 })
    expect(useUI.getState().toastMsg).toBe('Rest’s over. Next set!')
    expect(chime).not.toHaveBeenCalled()
    // Nothing left counted in or held, and the push the full rest booked is called off.
    expect(countdown).toHaveBeenLastCalledWith(true, 0)
    expect(holdSession).toHaveBeenLastCalledWith(false)
    expect(pushes()).toEqual([90])
    expect(cancels()).toBeGreaterThan(0)
    expect(localStorage.getItem(REST_KEY)).toBeNull()
  })

  it('a switch-sides pause that is over too just goes, without its sound', () => {
    restSince(10, 'switch', Date.now() - 15_000)
    expect(useUI.getState().timer).toBeNull()
    expect(chime).not.toHaveBeenCalled()
  })

  it('a rest started on screen is not moved by it: the whole rest', () => {
    useUI.getState().startRest(90, 0, { kind: 'set' })
    useUI.getState().backdateRest(Date.now())
    expect(useUI.getState().timer).toMatchObject({ left: 90, total: 90 })
    expect(countdown).toHaveBeenLastCalledWith(true, 90)
    expect(pushes()).toEqual([90])
  })

  // The server takes a booking or a cancel as it arrives. Sent in the same moment, the cancel of a
  // rest that is over already could overtake the booking the full rest made as it started, and a
  // "rest over" rang 90 s on, at an end that was called off. Each request waits for the one before.
  it('one that is over too is called off only once the booking it replaces has landed', async () => {
    const land = slowBooking()
    restSince(90, 'set', Date.now() - 120_000)
    await flush()
    expect(pushes()).toEqual([90])
    expect(cancels()).toBe(0)
    land()
    await flush()
    expect(cancels()).toBe(1)
  })

  it('with time left, the true end is booked after the full one has landed, so it is the one that stays', async () => {
    const land = slowBooking()
    restSince(90, 'set', Date.now() - 30_000)
    await flush()
    expect(pushes()).toEqual([90])
    land()
    await flush()
    expect(pushes()).toEqual([90, 60])
  })

  it('a booking that a later one or a cancel replaces while it waits is not sent at all', async () => {
    const land = slowBooking()
    useUI.getState().startRest(90, 0, { kind: 'set' })
    useUI.getState().addRest(15)                       // waits behind the first
    useUI.getState().stopRest()                        // and is replaced by the cancel
    land()
    await flush()
    expect(pushes()).toEqual([90])
    expect(cancels()).toBe(1)
  })
})
