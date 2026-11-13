// Settings → Workout → Forgotten workouts (lib/forgotten-workout.js): idle, left the gym, the
// grace, nobody answering, and Reopen.
import { describe, expect, it } from 'vitest'
import {
  decideForgotten, honestEnd, idleSince, lastSetOf, usualRestSec, readForgottenPrefs, writeForgottenPrefs,
  leaveGymOn, forgottenForWatch, readForgottenState, writeForgottenState, keepGoingPatch,
  reopenRecord, saveReopen, readReopen, canReopen, applyReopen, REOPEN_MS, FORGOTTEN_DEFAULTS,
} from './forgotten-workout.js'

const MIN = 60000
const T0 = Date.UTC(2026, 10, 7, 17, 0)
const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) } }
// A workout started at T0, three sets done at +5, +8, +11 min.
const workout = (extra = {}) => ({
  id: 'w1', start: T0, cur: 0,
  entries: [{ id: 'bench', target: { restSec: 120 }, sets: [
    { w: 60, r: 8, done: true, at: T0 + 5 * MIN },
    { w: 60, r: 8, done: true, at: T0 + 8 * MIN },
    { w: 60, r: 8, done: true, at: T0 + 11 * MIN },
    { w: 60, r: 8, done: false },
  ] }],
  ...extra,
})
const last = T0 + 11 * MIN
const prefs = { askMin: 45, graceMin: 5, leaveGym: null }

describe('forgotten workouts: idle', () => {
  it('stays quiet until the threshold, then asks once', () => {
    const A = workout()
    expect(decideForgotten({ A, now: last + 44 * MIN, prefs })).toEqual({ state: 'active', askAt: last + 45 * MIN })
    const d = decideForgotten({ A, now: last + 45 * MIN, prefs })
    expect(d.state).toBe('ask')
    expect(d.askNow).toBe(true)
    expect(d.deadline).toBe(last + 50 * MIN)
  })

  it('nobody answers: it ends after the grace, at the last set plus its usual rest', () => {
    const A = workout()
    const askedAt = last + 45 * MIN
    expect(decideForgotten({ A, now: askedAt + 4 * MIN, prefs, askedAt }).state).toBe('ask')
    const d = decideForgotten({ A, now: askedAt + 5 * MIN, prefs, askedAt })
    expect(d).toEqual({ state: 'end', reason: 'idle', endAt: last + 120 * 1000 })
  })

  it('never ends what it never asked: a phone in a drawer only asks when it wakes', () => {
    const A = workout()
    const d = decideForgotten({ A, now: last + 5 * 3600 * 1000, prefs })
    expect(d.state).toBe('ask')
    expect(d.askNow).toBe(true)
  })

  it('a question asked before the last set does not count', () => {
    const A = workout()
    expect(decideForgotten({ A, now: last + 50 * MIN, prefs, askedAt: last - MIN }).askNow).toBe(true)
  })

  it('Keep going counts idle from then', () => {
    const A = workout()
    const snoozeAt = last + 47 * MIN
    expect(decideForgotten({ A, now: last + 60 * MIN, prefs, snoozeAt }).state).toBe('active')
    expect(decideForgotten({ A, now: snoozeAt + 45 * MIN, prefs, snoozeAt }).state).toBe('ask')
    expect(keepGoingPatch(5)).toEqual({ snoozeAt: 5, askedAt: 0 })
  })

  it('the phone used in the workout (activeAt) counts like a set', () => {
    expect(decideForgotten({ A: workout(), now: last + 50 * MIN, prefs, activeAt: last + 30 * MIN }).state).toBe('active')
  })

  it('a rest, a hold or a pause running is a workout going on', () => {
    expect(decideForgotten({ A: workout(), now: last + 3 * 3600e3, prefs, resting: true }).state).toBe('active')
    expect(decideForgotten({ A: workout({ pausedAt: last }), now: last + 3 * 3600e3, prefs }).state).toBe('active')
  })

  it('Off never asks; editing a saved workout or logging a past one is not a workout to look after', () => {
    expect(decideForgotten({ A: workout(), now: last + 3 * 3600e3, prefs: { ...prefs, askMin: 0 } }).state).toBe('active')
    expect(decideForgotten({ A: workout({ editingWorkoutId: 'x' }), now: last + 3 * 3600e3, prefs }).state).toBe('none')
    expect(decideForgotten({ A: workout({ backfill: {} }), now: last + 3 * 3600e3, prefs }).state).toBe('none')
    expect(decideForgotten({ A: null }).state).toBe('none')
  })

  it('each threshold is honoured', () => {
    for (const askMin of [30, 60, 90]) {
      expect(decideForgotten({ A: workout(), now: last + (askMin - 1) * MIN, prefs: { ...prefs, askMin } }).state).toBe('active')
      expect(decideForgotten({ A: workout(), now: last + askMin * MIN, prefs: { ...prefs, askMin } }).state).toBe('ask')
    }
  })
})

describe('forgotten workouts: left the gym', () => {
  it('asks at once, ends after the grace, never discards', () => {
    const A = workout()
    const leftAt = last + 3 * MIN
    const d = decideForgotten({ A, now: leftAt + MIN, prefs, leaveGym: true, leftAt })
    expect(d).toEqual({ state: 'left', reason: 'left', deadline: leftAt + 5 * MIN })
    expect(decideForgotten({ A, now: leftAt + 5 * MIN, prefs, leaveGym: true, leftAt })).toEqual({ state: 'end', reason: 'left', endAt: last + 120e3 })
  })

  it('a leave before the last set (popped out to the car, came back) is old news', () => {
    expect(decideForgotten({ A: workout(), now: last + 2 * MIN, prefs, leaveGym: true, leftAt: last - MIN }).state).toBe('active')
  })

  it('Keep going after leaving answers the leave', () => {
    const leftAt = last + 3 * MIN
    expect(decideForgotten({ A: workout(), now: leftAt + 10 * MIN, prefs, leaveGym: true, leftAt, snoozeAt: leftAt + MIN }).state).toBe('active')
  })

  it('only with the switch on and the gym reminder set up', () => {
    const leftAt = last + 3 * MIN
    expect(decideForgotten({ A: workout(), now: leftAt + 10 * MIN, prefs, leaveGym: false, leftAt }).state).toBe('active')
    expect(leaveGymOn({ leaveGym: null }, true)).toBe(true)
    expect(leaveGymOn({ leaveGym: null }, false)).toBe(false)
    expect(leaveGymOn({ leaveGym: false }, true)).toBe(false)
    expect(leaveGymOn({ leaveGym: true }, false)).toBe(false)
  })

  it('the grace is the one chosen', () => {
    const leftAt = last + 3 * MIN
    expect(decideForgotten({ A: workout(), now: leftAt + 2 * MIN, prefs: { ...prefs, graceMin: 2 }, leaveGym: true, leftAt }).state).toBe('end')
    expect(decideForgotten({ A: workout(), now: leftAt + 9 * MIN, prefs: { ...prefs, graceMin: 10 }, leaveGym: true, leftAt }).state).toBe('left')
  })
})

describe('forgotten workouts: the honest end', () => {
  it('last set plus its own rest, then the exercise rest, then the app default', () => {
    expect(honestEnd(workout(), { now: last + 3600e3 })).toBe(last + 120e3)
    const A = workout(); delete A.entries[0].target.restSec
    expect(honestEnd(A, { now: last + 3600e3, restSec: 75 })).toBe(last + 75e3)
    A.entries[0].sets[2].rest = 200
    expect(honestEnd(A, { now: last + 3600e3 })).toBe(last + 200e3)
    expect(usualRestSec(null, 0)).toBe(0)
  })

  it('never later than now', () => {
    expect(honestEnd(workout(), { now: last + 30e3 })).toBe(last + 30e3)
  })

  it('nothing logged: it ends where it began', () => {
    const A = workout(); A.entries[0].sets.forEach(s => { s.done = false; delete s.at })
    expect(lastSetOf(A)).toBe(null)
    expect(honestEnd(A, { now: T0 + 3600e3 })).toBe(T0)
  })

  it('a cardio row ticked at its start reaches to its end', () => {
    const A = workout()
    A.entries.push({ id: 'run', sets: [{ min: 20, done: true, at: last + 2 * MIN }] })
    expect(honestEnd(A, { now: last + 3600e3, restSec: 0 })).toBe(last + 22 * MIN)
  })

  it('one side of a per-side set counts', () => {
    const A = workout({ entries: [{ id: 'lunge', sets: [{ sides: { L: { r: 8, done: true }, R: { r: 8 } }, at: T0 + 9 * MIN }] }] })
    expect(lastSetOf(A).at).toBe(T0 + 9 * MIN)
    expect(idleSince(A)).toBe(T0 + 9 * MIN)
  })
})

describe('forgotten workouts: choices and state', () => {
  it('defaults, and only known choices', () => {
    const st = mem()
    expect(readForgottenPrefs(st)).toEqual({ ...FORGOTTEN_DEFAULTS })
    expect(writeForgottenPrefs({ askMin: 90, graceMin: 10, leaveGym: false }, st)).toEqual({ askMin: 90, graceMin: 10, leaveGym: false })
    expect(writeForgottenPrefs({ askMin: 13, graceMin: 99 }, st)).toEqual({ askMin: 45, graceMin: 5, leaveGym: false })
    expect(writeForgottenPrefs({ askMin: 0 }, st).askMin).toBe(0)
    expect(forgottenForWatch({ askMin: 30, graceMin: 2, leaveGym: null }, true)).toEqual({ askMin: 30, graceMin: 2, leaveGym: true })
  })

  it('remembers the question per workout', () => {
    const st = mem()
    writeForgottenState('w1', { askedAt: 5 }, st)
    expect(readForgottenState('w1', st).askedAt).toBe(5)
    expect(readForgottenState('w2', st)).toEqual({ wid: 'w2', askedAt: 0, snoozeAt: 0, leftAt: 0, notifyAt: 0 })
    writeForgottenState(null, {}, st)
    expect(readForgottenState('w1', st).askedAt).toBe(0)
  })
})

describe('forgotten workouts: Reopen', () => {
  const state = () => {
    const A = workout()
    return { active: A, workouts: [{ id: 'old', d: '2026-11-01' }], exWeights: { bench: { w: 55, d: '2026-11-01' } }, sessionTargets: { bench: { w: 62 } } }
  }

  it('puts the workout back as it was, for 24 hours, with idle counted from then', () => {
    const st = mem()
    const s = state()
    const A = s.active
    const rec = reopenRecord(s, A, { id: 'w1' }, { now: last + 50 * MIN })
    saveReopen(rec, st)
    // The finish: saved, best weight raised, target used.
    s.workouts.push({ id: 'w1', d: '2026-11-07', entries: A.entries })
    s.exWeights.bench = { w: 60, d: '2026-11-07' }
    s.sessionTargets = {}
    s.active = null
    const got = readReopen(st, last + 60 * MIN)
    expect(canReopen({ id: 'w1' }, got, last + 60 * MIN)).toBe(true)
    expect(canReopen({ id: 'old' }, got, last + 60 * MIN)).toBe(false)
    expect(applyReopen(s, got, last + 60 * MIN)).toBe(true)
    expect(s.workouts.map(w => w.id)).toEqual(['old'])
    expect(s.active.id).toBe('w1')
    expect(s.active.entries[0].sets[2].done).toBe(true)
    expect(s.active.reopenedAt).toBe(last + 60 * MIN)
    expect(s.exWeights.bench).toEqual({ w: 55, d: '2026-11-01' })
    expect(s.sessionTargets).toEqual({ bench: { w: 62 } })
    // Idle counts from the reopen, not from the old last set.
    expect(decideForgotten({ A: s.active, now: last + 61 * MIN, prefs, activeAt: s.active.reopenedAt }).state).toBe('active')
  })

  it('gone after 24 hours, and never over another running workout', () => {
    const st = mem()
    const s = state()
    saveReopen(reopenRecord(s, s.active, { id: 'w1' }, { now: T0 }), st)
    expect(readReopen(st, T0 + REOPEN_MS + 1)).toBe(null)
    const rec = readReopen(st, T0 + 1000)
    s.workouts.push({ id: 'w1', d: '2026-11-07' })
    expect(applyReopen(s, rec)).toBe(false) // s.active still runs
    s.active = null
    s.workouts = s.workouts.filter(w => w.id !== 'w1')
    expect(applyReopen(s, rec)).toBe(false) // deleted meanwhile
  })

  it('a best weight set later by another workout stays', () => {
    const s = state()
    const rec = reopenRecord(s, s.active, { id: 'w1' }, { now: T0 })
    s.active = null
    s.workouts.push({ id: 'w1', d: '2026-11-07' })
    s.exWeights.bench = { w: 70, d: '2026-11-08' }
    applyReopen(s, rec)
    expect(s.exWeights.bench).toEqual({ w: 70, d: '2026-11-08' })
  })
})
