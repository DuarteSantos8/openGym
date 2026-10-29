// @vitest-environment happy-dom
// The watch's forgotten-workout check against a workout being logged on the phone (#904): the
// watch's copy had stopped at 20:28:32, it ended the workout at 21:13:45 as forgotten, and the
// phone saved it, although 20 sets had been ticked on the phone since, the last 24 s earlier.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyEvents, bindWatchActions, buildSnapshot, staleWatchFinish, phoneActiveAt, phoneWorkedAt, notePhoneEdit, notePhoneOpen, lastTickIn, IDLE_GUARD_MS, _resetWatchSync } from './watch-sync.js'

const T = Date.parse('2026-10-27T20:25:09+01:00')
const min = 60 * 1000
const set = (at, extra = {}) => ({ w: 60, r: 8, done: at != null, ...(at != null ? { at } : {}), ...extra })
const workout = (ats, extra = {}) => ({
  id: 'w-904', name: 'Legs', start: T, d: '2026-10-27',
  entries: [{ id: '0025', target: { sets: ats.length, reps: 8 }, sets: ats.map(at => set(at)) }],
  ...extra,
})

beforeEach(() => { localStorage.clear(); _resetWatchSync() })
afterEach(() => { _resetWatchSync(); vi.useRealTimers() })

describe('a finish from the watch', () => {
  // The issue's timeline: the watch's last known set at 20:28:32, ticks on the phone until 21:13:21.
  const watchLast = T + 3 * min + 23e3
  const phoneLast = T + 48 * min + 12e3
  const ticked = () => workout([T + 2 * min, watchLast, T + 30 * min, phoneLast])

  it('is stale when the phone logged the workout after the watch ended it, idle or not', () => {
    const A = ticked()
    expect(staleWatchFinish(A, { type: 'finish', wid: 'w-904', at: watchLast, idle: true }, phoneLast + 24e3)).toBe(true)
    // the 1.4.3 watch sends no `idle`: its idle finish is at its last set, which is caught too
    expect(staleWatchFinish(A, { type: 'finish', wid: 'w-904', at: watchLast }, phoneLast + 24e3)).toBe(true)
  })

  it('is kept: the phone does not finish, and says why the watch let go', () => {
    const A = ticked()
    const finish = vi.fn(), idleKept = vi.fn()
    bindWatchActions({ setDone: vi.fn(), finish, idleKept })
    expect(applyEvents([{ id: 'f-904', type: 'finish', wid: 'w-904', at: watchLast, idle: true }], () => ({ S: { active: A } }))).toEqual(['f-904'])
    expect(finish).not.toHaveBeenCalled()
    expect(idleKept).toHaveBeenCalledTimes(1)
  })

  it('still finishes a workout that really was forgotten, however late the phone hears of it', () => {
    const A = workout([T + 2 * min, watchLast])
    const finish = vi.fn()
    bindWatchActions({ setDone: vi.fn(), finish })
    // the phone opened hours later: opening it is no work done in the workout
    notePhoneOpen('w-904', T + 5 * 60 * min)
    expect(applyEvents([{ id: 'f-old', type: 'finish', wid: 'w-904', at: watchLast, idle: true }], () => ({ S: { active: A } }))).toEqual(['f-old'])
    expect(finish).toHaveBeenCalledTimes(1)
  })

  it('a Finish tapped on the watch after the last set on the phone finishes, also when the phone hears of it later', () => {
    const A = ticked()
    expect(staleWatchFinish(A, { type: 'finish', wid: 'w-904', at: phoneLast + 2 * min }, phoneLast + 60 * min)).toBe(false)
    // a few seconds of clock difference between phone and watch are no reason to refuse it
    expect(staleWatchFinish(A, { type: 'finish', wid: 'w-904', at: phoneLast - 20e3 }, phoneLast)).toBe(false)
  })

  it('an idle finish while the phone was worked on in the last 20 minutes is refused, even without a newer tick', () => {
    const A = workout([T + 2 * min])
    notePhoneEdit('w-904', T + 30 * min)   // an exercise added, a weight changed
    expect(staleWatchFinish(A, { type: 'finish', wid: 'w-904', at: T + 31 * min, idle: true }, T + 30 * min + IDLE_GUARD_MS - 1)).toBe(true)
    expect(staleWatchFinish(A, { type: 'finish', wid: 'w-904', at: T + 31 * min, idle: true }, T + 30 * min + IDLE_GUARD_MS + 1)).toBe(false)
    // an edit of another workout says nothing about this one
    _resetWatchSync()
    notePhoneEdit('other', T + 30 * min)
    expect(phoneWorkedAt(A)).toBe(T + 2 * min)
  })

  it('the watch\'s own ticks, applied on the phone, are not the phone being used', () => {
    const A = workout([T + 2 * min, null])
    const setDone = vi.fn(() => notePhoneEdit('w-904', T + 90 * min))   // the store change they cause
    const finish = vi.fn()
    bindWatchActions({ setDone, finish })
    applyEvents([
      { id: 'd', type: 'setDone', wid: 'w-904', exId: '0025', entryIdx: 0, setIdx: 1, w: 60, r: 8, at: T + 10 * min },
      { id: 'f', type: 'finish', wid: 'w-904', at: T + 10 * min, idle: true },
    ], () => ({ S: { active: A } }))
    expect(finish).toHaveBeenCalledTimes(1)
  })
})

describe('what the watch hears', () => {
  it('the snapshot carries when the phone was last used in the workout: a tick, an edit, the app opened', () => {
    const A = workout([T + 2 * min, T + 9 * min, null])
    expect(lastTickIn(A)).toBe(T + 9 * min)
    expect(phoneActiveAt(A)).toBe(T + 9 * min)
    notePhoneEdit('w-904', T + 12 * min)
    expect(phoneActiveAt(A)).toBe(T + 12 * min)
    notePhoneOpen('w-904', T + 15 * min)
    expect(phoneActiveAt(A)).toBe(T + 15 * min)
    expect(phoneWorkedAt(A)).toBe(T + 12 * min)
    expect(buildSnapshot({ unit: 'kg', active: A }, { activeAt: phoneActiveAt(A) }).active.activeAt).toBe(T + 15 * min)
    expect('activeAt' in buildSnapshot({ unit: 'kg', active: A }).active).toBe(false)
  })

  it('one side of a per-side set counts as a tick', () => {
    const A = workout([null])
    A.entries[0].sets[0] = { w: 20, r: 8, done: false, at: T + 7 * min, sides: { L: { w: 20, r: 8, done: true }, R: { w: 20, r: 0, done: false } } }
    expect(lastTickIn(A)).toBe(T + 7 * min)
  })
})
