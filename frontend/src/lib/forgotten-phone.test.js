// @vitest-environment happy-dom
// The phone's side of Forgotten workouts (lib/forgotten-phone.js): the card, the finish nobody
// answered, Keep going, a gym leave from the native side and its notification's answer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ln = vi.hoisted(() => ({ scheduled: [], cancelled: 0, listeners: {}, granted: true, types: null }))
vi.mock('./mobile.js', () => ({ MOBILE: true }))
const fakeNotifications = {
    checkPermissions: async () => ({ display: ln.granted ? 'granted' : 'denied' }),
    schedule: async ({ notifications }) => { ln.scheduled.push(...notifications) },
    cancel: async () => { ln.cancelled++ },
    registerActionTypes: async ({ types }) => { ln.types = types },
    addListener: async (name, fn) => { ln.listeners[name] = fn; return { remove () {} } },
}

import { startForgotten, checkForgotten, keepGoing, noteLeftGym, _resetForgottenPhone, forgottenCopy } from './forgotten-phone.js'
import { readForgottenState, writeForgottenPrefs, FORGOTTEN_STATE_KEY } from './forgotten-workout.js'

const MIN = 60000
const T0 = Date.UTC(2026, 10, 7, 17, 0)
const last = T0 + 11 * MIN
const flush = () => new Promise(r => setTimeout(r, 0))

function makeStores (active) {
  let S = { restSec: 90, active }
  const subs = new Set()
  const useStore = {
    getState: () => ({ S, tourSandbox: false }),
    subscribe: fn => { subs.add(fn); return () => subs.delete(fn) },
    set (next) { const prev = { S }; S = next; for (const f of subs) f({ S }, prev) },
  }
  const useUI = { getState: () => ({ timer: null, work: null }) }
  return { useStore, useUI }
}
const workout = () => ({ id: 'w1', start: T0, entries: [{ id: 'bench', target: { restSec: 120 }, sets: [
  { w: 60, r: 8, done: true, at: T0 + 5 * MIN }, { w: 60, r: 8, done: true, at: last }, { w: 60, r: 8 },
] }] })

let stop = () => {}
beforeEach(() => { localStorage.clear(); ln.scheduled = []; ln.cancelled = 0; ln.listeners = {}; ln.granted = true; vi.useFakeTimers({ toFake: ['Date'] }) })
afterEach(() => { stop(); _resetForgottenPhone(); vi.useRealTimers() })

function start (A = workout()) {
  const st = makeStores(A)
  const calls = { finish: [], prompts: [], closed: 0, discard: 0, used: [] }
  stop = startForgotten({
    ...st,
    finish: o => { calls.finish.push(o); st.useStore.set({ ...st.useStore.getState().S, active: null }) },
    discard: () => { calls.discard++ },
    openPrompt: p => { calls.prompts.push(p); return { close: () => { calls.closed++ } } },
    gymOn: () => true,
    noteUse: (wid, at) => calls.used.push([wid, at]),
    readLeft: async () => null,
    onLeft: () => () => {},
    notifications: fakeNotifications,
  })
  return { st, calls }
}

describe('forgotten workouts on the phone', () => {
  it('plans the notification for when the question is due, with its buttons', async () => {
    vi.setSystemTime(last + MIN)
    start()
    await vi.waitFor(() => expect(ln.scheduled).toHaveLength(1))
    expect(ln.scheduled[0].schedule.at.getTime()).toBe(last + 45 * MIN)
    expect(ln.scheduled[0].actionTypeId).toBe('og-forgotten')
    expect(ln.types.map(x => x.id)).toEqual(['og-forgotten', 'og-left'])
    expect(readForgottenState('w1').notifyAt).toBe(last + 45 * MIN)
    // Android 14 without "Alarms & reminders": inexact, so the plugin opens no settings screen (QA66).
    expect(ln.scheduled[0].isExactNotification).toBe(false)
  })

  it('asks on screen, then ends at the last set plus its rest when nobody answers', () => {
    vi.setSystemTime(last + 45 * MIN)
    ln.granted = false
    const { calls } = start()
    expect(calls.prompts.at(-1).state).toBe('ask')
    expect(readForgottenState('w1').askedAt).toBe(last + 45 * MIN)
    vi.setSystemTime(last + 50 * MIN)
    checkForgotten()
    expect(calls.finish).toEqual([{ end: last + 120e3, auto: 'idle' }])
    expect(calls.closed).toBeGreaterThan(0)
  })

  it('a notification that went out counts as asked: a phone woken later ends it at once, honestly', () => {
    vi.setSystemTime(last + MIN)
    localStorage.setItem(FORGOTTEN_STATE_KEY, JSON.stringify({ wid: 'w1', notifyAt: last + 45 * MIN }))
    vi.setSystemTime(last + 3 * 3600e3)
    const { calls } = start()
    expect(calls.finish).toEqual([{ end: last + 120e3, auto: 'idle' }])
  })

  it('Keep going: the card goes, idle counts from then, the watches hear the phone was used', () => {
    vi.setSystemTime(last + 46 * MIN)
    ln.granted = false
    const { calls } = start()
    expect(calls.prompts).toHaveLength(1)
    keepGoing()
    expect(calls.used).toEqual([['w1', last + 46 * MIN]])
    expect(readForgottenState('w1').snoozeAt).toBe(last + 46 * MIN)
    vi.setSystemTime(last + 60 * MIN)
    expect(checkForgotten().state).toBe('active')
    expect(calls.finish).toEqual([])
  })

  it('leaving the gym asks at once; the notification button finishes it', () => {
    vi.setSystemTime(last + 3 * MIN)
    const { calls } = start()
    noteLeftGym(last + 2 * MIN)
    expect(calls.prompts.at(-1).state).toBe('left')
    expect(calls.prompts.at(-1).deadline).toBe(last + 7 * MIN)
    noteLeftGym(last + 2 * MIN, 'finish')
    expect(calls.finish).toEqual([undefined])
  })

  it('a leave from before the workout or before Keep going is old news', () => {
    vi.setSystemTime(last + 3 * MIN)
    const { calls } = start()
    noteLeftGym(T0 - MIN)
    expect(calls.prompts).toHaveLength(0)
  })

  it('with the gym switch off a leave changes nothing', () => {
    writeForgottenPrefs({ leaveGym: false })
    vi.setSystemTime(last + 3 * MIN)
    const { calls } = start()
    noteLeftGym(last + 2 * MIN)
    expect(calls.prompts).toHaveLength(0)
  })

  it('a set logged moves the question and takes the card away', () => {
    vi.setSystemTime(last + 46 * MIN)
    ln.granted = false
    const { st, calls } = start()
    expect(calls.prompts).toHaveLength(1)
    const A = workout(); A.entries[0].sets[2] = { w: 60, r: 8, done: true, at: last + 46 * MIN }
    st.useStore.set({ ...st.useStore.getState().S, active: A })
    expect(calls.closed).toBeGreaterThan(0)
    expect(checkForgotten().state).toBe('active')
  })

  it('the notification buttons: Keep going snoozes, Finish finishes, other notifications are not ours', async () => {
    vi.setSystemTime(last + 46 * MIN)
    const { calls } = start()
    await vi.waitFor(() => expect(ln.listeners.localNotificationActionPerformed).toBeTruthy())
    const tap = ln.listeners.localNotificationActionPerformed
    tap({ actionId: 'finish', notification: { id: 3000 } })
    expect(calls.finish).toEqual([])
    tap({ actionId: 'keep', notification: { id: 3100 } })
    expect(readForgottenState('w1').snoozeAt).toBeGreaterThanOrEqual(last + 46 * MIN)
    tap({ actionId: 'finish', notification: { id: 3100 } })
    expect(calls.finish).toEqual([undefined])
  })

  it('the words name the minutes chosen', () => {
    const c = forgottenCopy({ askMin: 60, graceMin: 10 })
    expect(c.askBody).toContain('60')
    expect(c.askBody).toContain('10')
    expect(c.leftBody).toContain('10')
  })
})
