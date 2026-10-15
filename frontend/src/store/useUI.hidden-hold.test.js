// @vitest-environment happy-dom
// A hold that runs out while the page is hidden finishes on the first tick back (runWork), and the
// rest it earned starts there. The owner's call: that rest has been counting since the hold ended,
// time away taken off (startRest's `since`), and one that is over too ends the way a rest that ran
// out unseen does: Ready and its toast, no sound. Nothing alerts while the phone is locked: nothing
// is booked until the page is back, and then only the end that is still ahead.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ ok: true })) }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), countdown: vi.fn(), hush: vi.fn(), holdSession: vi.fn() }))

import { api } from '../lib/api.js'
import { chime, countdown, holdSession } from '../lib/sound.js'
import { useUI, REST_KEY } from './useUI.js'
import { useStore } from './useStore.js'

const pushes = () => api.mock.calls.filter(([p]) => p === '/api/push/rest-timer').map(([, o]) => JSON.parse(o.body).seconds)

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
  it('has been counting since the hold ended: the time left, its count-in and its push are what is really left', () => {
    const since = Date.now() - 30_000
    useUI.getState().startRest(90, 0, { kind: 'set', since })
    expect(useUI.getState().timer).toMatchObject({ left: 60, total: 90, endsAt: since + 90_000 })
    expect(countdown).toHaveBeenLastCalledWith(true, 60)
    expect(holdSession).toHaveBeenLastCalledWith(true)
    expect(pushes()).toEqual([60])
    expect(JSON.parse(localStorage.getItem(REST_KEY))).toMatchObject({ endsAt: since + 90_000, total: 90 })
  })

  it('and its end, on screen, is a seen one: its sound plays', () => {
    useUI.getState().startRest(90, 0, { kind: 'set', since: Date.now() - 30_000 })
    vi.advanceTimersByTime(59_000)
    expect(useUI.getState().timer).toMatchObject({ left: 1 })
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().timer).toMatchObject({ left: 0, ready: true })
    expect(chime).toHaveBeenCalledWith(true, 'bell')
  })

  it('one that is over too ends now, as a rest that ran out unseen: Ready, its toast, no sound', () => {
    useUI.getState().startRest(90, 0, { kind: 'set', since: Date.now() - 120_000 })
    expect(useUI.getState().timer).toMatchObject({ left: 0, ready: true, total: 90 })
    expect(useUI.getState().toastMsg).toBe('Rest’s over. Next set!')
    expect(chime).not.toHaveBeenCalled()
    // Nothing counted in, held or booked for an end that has passed.
    expect(countdown).not.toHaveBeenCalled()
    expect(holdSession).not.toHaveBeenCalledWith(true)
    expect(pushes()).toEqual([])
    expect(localStorage.getItem(REST_KEY)).toBeNull()
  })

  it('a switch-sides pause that is over too just goes, without its sound', () => {
    useUI.getState().startRest(10, 0, { kind: 'switch', since: Date.now() - 15_000 })
    expect(useUI.getState().timer).toBeNull()
    expect(chime).not.toHaveBeenCalled()
  })

  it('a rest started on screen is not moved by it: no `since`, the whole rest', () => {
    useUI.getState().startRest(90, 0, { kind: 'set' })
    expect(useUI.getState().timer).toMatchObject({ left: 90, total: 90 })
    expect(countdown).toHaveBeenLastCalledWith(true, 90)
    expect(pushes()).toEqual([90])
  })
})
