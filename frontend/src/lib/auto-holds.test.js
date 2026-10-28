// Timed holds that run themselves: the pure decisions (which hold comes next, what a hold logs,
// when the chain waits, what a locked phone is told). The clocks are store/useUI.auto-holds.test.js.
import { describe, expect, it } from 'vitest'
import { COUNT_IN_SEC, autoHoldsFor, chainCues, forecastHolds, heldSec, holdPlanSec, nextAutoHold, phaseLeft, resumedEnd, shouldWait } from './auto-holds.js'

const hold = (sec, extra = {}) => ({ sec, done: false, ...extra })
const timedEntry = (id, sets, target = {}, extra = {}) => ({ id, target: { mode: 'time', ...target }, sets, ...extra })
const repsEntry = (id, sets, extra = {}) => ({ id, target: { mode: 'reps' }, sets, ...extra })
const isTimedIn = S => idx => S.active.entries[idx]?.target?.mode === 'time'
const session = (entries, extra = {}) => ({ autoHolds: true, restSec: 90, active: { id: 'w', cur: 0, entries, ...extra.active }, ...extra.S })

describe('whether holds start by themselves', () => {
  it('follows the setting, off by default', () => {
    expect(autoHoldsFor({ active: { entries: [] } }, {})).toBe(false)
    expect(autoHoldsFor({ autoHolds: true, active: { entries: [] } }, {})).toBe(true)
  })
  it('lets an exercise say otherwise, either way', () => {
    expect(autoHoldsFor({ autoHolds: false, active: {} }, { autoHold: true })).toBe(true)
    expect(autoHoldsFor({ autoHolds: true, active: {} }, { autoHold: false })).toBe(false)
  })
  it('stops for the rest of the workout after Stop auto, and never runs in a saved workout or one entered later', () => {
    expect(autoHoldsFor({ autoHolds: true, active: { autoHoldsOff: true } }, { autoHold: true })).toBe(false)
    expect(autoHoldsFor({ autoHolds: true, active: { editingWorkoutId: 'x' } }, {})).toBe(false)
    expect(autoHoldsFor({ autoHolds: true, active: { backfill: true } }, {})).toBe(false)
    expect(autoHoldsFor({ autoHolds: true }, {})).toBe(false)
  })
})

describe('the next hold', () => {
  it('is the next open timed set of the current exercise, with its seconds', () => {
    const S = session([timedEntry('plank', [hold(30, { done: true }), hold(40)])])
    expect(nextAutoHold(S, isTimedIn(S))).toEqual({ idx: 0, i: 1, id: 'plank', plan: 40, current: true })
  })
  it('keeps the plan a hold that did not finish put aside', () => {
    expect(holdPlanSec({ sec: 3, planSec: 30 })).toBe(30)
    expect(holdPlanSec({ sec: 3, planSec: 30, done: true })).toBe(3)
    expect(holdPlanSec({})).toBe(45)
  })
  it('stops at a reps set: the workout goes on as it always did', () => {
    const S = session([timedEntry('plank', [hold(30, { done: true })]), repsEntry('bench', [{ w: 60, r: 8 }])])
    expect(nextAutoHold(S, isTimedIn(S))).toBeNull()
  })
  it('moves on to the next exercise when that one is a timed hold too', () => {
    const S = session([timedEntry('plank', [hold(30, { done: true })]), timedEntry('lsit', [hold(20)])])
    expect(nextAutoHold(S, isTimedIn(S))).toMatchObject({ idx: 1, i: 0, id: 'lsit', current: false })
  })
  it('stops at an exercise whose own setting is off', () => {
    const S = session([timedEntry('plank', [hold(30, { done: true })]), timedEntry('hang', [hold(20)], { autoHold: false })])
    expect(nextAutoHold(S, isTimedIn(S))).toBeNull()
  })
  it('takes the left side, then the right side of a per-side hold', () => {
    const S = session([timedEntry('side', [hold(30, { side: 'L' }), hold(30, { side: 'R' })], { side: true })])
    expect(nextAutoHold(S, isTimedIn(S))).toMatchObject({ i: 0 })
    S.active.entries[0].sets[0].done = true
    expect(nextAutoHold(S, isTimedIn(S))).toMatchObject({ i: 1 })
  })
  it('follows a superset’s turn order: the member whose turn it is, round by round', () => {
    const S = session([
      timedEntry('plank', [hold(30, { done: true }), hold(30)], {}, { sg: 'a' }),
      timedEntry('lsit', [hold(20), hold(20)], {}, { sg: 'a' }),
    ], { active: { cur: 1 } })
    expect(nextAutoHold(S, isTimedIn(S))).toMatchObject({ idx: 1, i: 0, current: true })
    S.active.entries[1].sets[0].done = true
    S.active.cur = 0
    expect(nextAutoHold(S, isTimedIn(S))).toMatchObject({ idx: 0, i: 1 })
  })
  it('stops at a reps member of a superset', () => {
    const S = session([
      timedEntry('plank', [hold(30, { done: true })], {}, { sg: 'a' }),
      repsEntry('row', [{ w: 40, r: 10 }], { sg: 'a' }),
    ], { active: { cur: 1 } })
    expect(nextAutoHold(S, isTimedIn(S))).toBeNull()
  })
})

describe('clocks from timestamps', () => {
  it('counts 3, 2, 1, then 0 from the end time, whatever ticked in between', () => {
    const endsAt = 10_000 + COUNT_IN_SEC * 1000
    expect(phaseLeft({ endsAt }, 10_000)).toBe(3)
    expect(phaseLeft({ endsAt }, 11_100)).toBe(2)
    expect(phaseLeft({ endsAt }, 12_999)).toBe(1)
    expect(phaseLeft({ endsAt }, 13_000)).toBe(0)
    expect(phaseLeft({ endsAt }, 99_000)).toBe(0)
  })
  it('holds a paused phase at its seconds and moves its end out by the pause on resume', () => {
    expect(phaseLeft({ endsAt: 0, left: 7, paused: true }, 99_000)).toBe(7)
    expect(resumedEnd({ left: 7 }, 50_000)).toBe(57_000)
  })
  it('logs the planned seconds when the hold ran out, the held ones when it was ended early', () => {
    const wk = { total: 45, endsAt: 100_000 }
    expect(heldSec(wk, 200_000, { early: false })).toBe(45)
    expect(heldSec(wk, 100_000 - 7000)).toBe(38)
    expect(heldSec(wk, 100_000 - 45_000)).toBe(1)
  })
  it('leaves paused time out of what was held', () => {
    expect(heldSec({ total: 45, left: 20, paused: true, endsAt: 0 }, 999_999)).toBe(25)
  })
})

describe('waiting for the person', () => {
  it('waits under a sheet or while a field has the keyboard', () => {
    expect(shouldWait({ sheets: 1 })).toBe(true)
    expect(shouldWait({ activeTag: 'INPUT' })).toBe(true)
    expect(shouldWait({ activeTag: 'TEXTAREA' })).toBe(true)
    expect(shouldWait({ editable: true })).toBe(true)
    expect(shouldWait({ activeTag: 'BUTTON' })).toBe(false)
    expect(shouldWait()).toBe(false)
  })
})

describe('what a locked phone is told', () => {
  const words = { ready: n => `ready ${n}`, go: n => `go ${n}`, done: n => `done ${n}` }
  it('rings the count-in at the rest’s end, then go, then the hold’s end, then the holds after it', () => {
    const c = chainCues({ start: 'rest', at: 1000, name: 'Plank', plan: 30, forecast: [{ restBefore: 60, plan: 40 }], words })
    expect(c.title).toBe('ready Plank')
    expect(c.cues).toEqual([
      { dt: 3000, title: 'go Plank' },
      { dt: 33_000, title: 'done Plank' },
      { dt: 93_000, title: 'ready Plank' },
      { dt: 96_000, title: 'go Plank' },
      { dt: 136_000, title: 'done Plank' },
    ])
  })
  it('starts from the count-in’s end or the hold’s end', () => {
    expect(chainCues({ start: 'countin', at: 0, name: 'L-sit', plan: 20, words })).toEqual({ at: 0, title: 'go L-sit', cues: [{ dt: 20_000, title: 'done L-sit' }] })
    expect(chainCues({ start: 'hold', at: 0, name: 'L-sit', plan: 20, words })).toEqual({ at: 0, title: 'done L-sit', cues: [] })
  })
  it('forecasts the same exercise’s holds with their rests, and the short switch between two sides', () => {
    const S = session([timedEntry('side', [hold(30, { side: 'L' }), hold(30, { side: 'R' }), hold(30, { side: 'L' }), hold(30, { side: 'R' })], { side: true, restSec: 60 })])
    const f = forecastHolds(S, { idx: 0, i: 0 }, { isTimed: isTimedIn(S), switchSec: 10 })
    expect(f).toEqual([
      { i: 1, restBefore: 10, plan: 30, kind: 'switch' },
      { i: 2, restBefore: 60, plan: 30, kind: null },
      { i: 3, restBefore: 10, plan: 30, kind: 'switch' },
    ])
  })
  it('forecasts nothing past a superset or with auto off', () => {
    const ss = session([timedEntry('a', [hold(30), hold(30)], {}, { sg: 'x' }), timedEntry('b', [hold(30)], {}, { sg: 'x' })])
    expect(forecastHolds(ss, { idx: 0, i: 0 }, { isTimed: isTimedIn(ss) })).toEqual([])
    const off = session([timedEntry('a', [hold(30), hold(30)])], { S: { autoHolds: false } })
    expect(forecastHolds(off, { idx: 0, i: 0 }, { isTimed: isTimedIn(off) })).toEqual([])
  })
})
