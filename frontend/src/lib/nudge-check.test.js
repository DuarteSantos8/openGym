import { beforeEach, describe, expect, it, vi } from 'vitest'

/* The phone's background check before a nudge or a reminder it scheduled on itself
   (lib/nudge-check.js): which days it is for, what an answer from GET /api/nudge-check takes back,
   and when it is handed to the native NudgeCheck plugin at all. The plugin is a stand-in shaped
   like Capacitor's: a Proxy whose `then` is a native call that never answers (#42). */
const mocks = vi.hoisted(() => ({ MOBILE: true, auth: null, arm: vi.fn(async () => {}), disarm: vi.fn(async () => {}), registered: 0 }))
vi.mock('./mobile.js', () => ({ get MOBILE() { return mocks.MOBILE } }))
vi.mock('./api.js', () => ({ remoteAuth: () => mocks.auth }))
vi.mock('@capacitor/core', () => ({
  registerPlugin: name => {
    mocks.registered++
    expect(name).toBe('NudgeCheck')
    return new Proxy({}, { get: (_, k) => k === 'arm' ? mocks.arm : k === 'disarm' ? mocks.disarm : () => new Promise(() => {}) })
  }
}))

import { nudgeCheckPlan, idsToCancel, armNudgeCheck, _resetNudgeCheck } from './nudge-check.js'

const at = (iso, hhmm) => new Date(`${iso}T${hhmm}:00`)
const n = (id, iso, hhmm) => ({ id, title: 'x', body: 'y', schedule: { at: at(iso, hhmm), allowWhileIdle: true } })
const NOW = at('2026-10-13', '12:00').getTime()
// What syncReminder schedules at noon: today's nudge, tomorrow's reminder and nudge.
const scheduled = [n(1001, '2026-10-14', '08:00'), n(2000, '2026-10-13', '20:00'), n(2001, '2026-10-14', '20:00'), n(1000, '2026-10-13', '08:00')]
const today = { date: '2026-10-13', at: at('2026-10-13', '20:00').getTime(), reminder: [], nudge: [2000] }
const tomorrow = { date: '2026-10-14', at: at('2026-10-14', '08:00').getTime(), reminder: [1001], nudge: [2001] }
const S = (reminder = { on: true, nudge: true, time: '08:00' }) => ({ reminder })

beforeEach(() => {
  mocks.MOBILE = true
  mocks.auth = { base: 'https://gym.example.com', headers: { Authorization: 'Bearer tok' } }
  mocks.arm.mockClear(); mocks.disarm.mockClear()
  _resetNudgeCheck()
})

describe('nudgeCheckPlan', () => {
  it('one entry per day still ahead, soonest first, reminders and nudges apart', () => {
    expect(nudgeCheckPlan(scheduled, NOW)).toEqual([today, tomorrow])
  })
  it('leaves out what has fired, and anything that is not a reminder or a nudge', () => {
    expect(nudgeCheckPlan([n(1000, '2026-10-13', '08:00'), n(42, '2026-10-14', '09:00'), { id: 2003 }], NOW)).toEqual([])
    expect(nudgeCheckPlan(null, NOW)).toEqual([])
  })
})

describe('idsToCancel', () => {
  it('logged on another device: the day’s nudge and reminder go', () => {
    expect(idsToCancel(tomorrow, { date: '2026-10-14', done: true, nudge: false, rev: 9 })).toEqual([1001, 2001])
  })
  it('a day note written elsewhere counts the same (the server says done)', () => {
    expect(idsToCancel(today, { date: '2026-10-13', done: true, nudge: false, rev: 9 })).toEqual([2000])
  })
  it('not logged: everything stays', () => {
    expect(idsToCancel(tomorrow, { date: '2026-10-14', done: false, nudge: true, rev: 9 })).toEqual([])
  })
  it('the plan moved elsewhere, nothing due that day: only the nudge goes, the reminder is the next sync’s', () => {
    expect(idsToCancel(tomorrow, { date: '2026-10-14', done: false, nudge: false, rev: 9 })).toEqual([2001])
  })
  it('no answer, an error, or an answer about another day: nothing changes', () => {
    for (const a of [null, undefined, 'offline', { error: 'not signed in' }, { date: '2026-10-13', done: true }]) {
      expect(idsToCancel(tomorrow, a), JSON.stringify(a)).toEqual([])
    }
  })
})

describe('armNudgeCheck', () => {
  it('a paired phone with the reminder and the nudge on hands over the server, its headers and the days', async () => {
    expect(await armNudgeCheck(S(), scheduled, NOW)).toBe(true)
    expect(mocks.arm).toHaveBeenCalledWith({ server: 'https://gym.example.com', headers: { Authorization: 'Bearer tok' }, entries: [today, tomorrow] })
    expect(mocks.disarm).not.toHaveBeenCalled()
  })
  it('takes it back when there is nothing to check: not paired, the nudge or the reminder off, nothing scheduled', async () => {
    for (const [state, list, auth] of [[S(), scheduled, null], [S({ on: true, nudge: false }), scheduled, mocks.auth], [S({ on: false, nudge: true }), scheduled, mocks.auth], [S(), [], mocks.auth]]) {
      mocks.auth = auth
      expect(await armNudgeCheck(state, list, NOW)).toBe(false)
    }
    expect(mocks.disarm).toHaveBeenCalledTimes(4)
    expect(mocks.arm).not.toHaveBeenCalled()
  })
  it('the web build registers nothing', async () => {
    mocks.MOBILE = false
    mocks.registered = 0
    expect(await armNudgeCheck(S(), scheduled, NOW)).toBe(false)
    expect(mocks.registered).toBe(0)
  })
  it('a native shell without the plugin goes without the check, quietly', async () => {
    mocks.arm.mockRejectedValueOnce(new Error('"NudgeCheck" plugin is not implemented on ios'))
    expect(await armNudgeCheck(S(), scheduled, NOW)).toBe(false)
  })
})
