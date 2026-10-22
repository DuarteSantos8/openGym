import { describe, expect, it, vi } from 'vitest'
import { applySetDone, afterSetDone, SWITCH_SIDES_SEC } from './set-done.js'

const row = (over = {}) => ({ w: 60, r: 8, done: false, ...over })
const ex = (sets, over = {}) => ({ id: 'squat', target: { sets: sets.length, reps: 8 }, sets, ...over })

// The store's update and getState over a plain object, the way useStore clones and mutates.
function harness(active, { restSec = 90, timer = null } = {}) {
  const box = { S: { restSec, active } }
  const update = fn => { const S = structuredClone(box.S); fn(S); box.S = S }
  const get = () => box
  const ui = { timer, startRest: vi.fn(), stopRest: vi.fn() }
  const useUI = { getState: () => ui }
  return { box, update, get, ui, useUI }
}

describe('applySetDone', () => {
  it('ticks the set, stamps when, keeps the planned load and drops a set-aside plan', () => {
    const s = { active: { entries: [ex([row({ planSec: 30 }), row()])] } }
    const res = applySetDone(s, 0, 0, { at: 1234 })
    const set = s.active.entries[0].sets[0]
    expect(set).toMatchObject({ w: 60, r: 8, done: true, at: 1234 })
    expect(set.planSec).toBeUndefined()
    expect(res).toEqual({ checked: true, exJustDone: false, unitDone: false, workoutDone: false })
  })

  it('takes the load and reps it is given, a bodyweight 0 included', () => {
    const s = { active: { entries: [ex([row(), row()])] } }
    applySetDone(s, 0, 1, { at: 1, w: 0, r: 12 })
    expect(s.active.entries[0].sets[1]).toMatchObject({ w: 0, r: 12, done: true })
  })

  it('ignores a load or reps that is not a number', () => {
    const s = { active: { entries: [ex([row()])] } }
    applySetDone(s, 0, 0, { at: 1, w: 'x', r: null })
    expect(s.active.entries[0].sets[0]).toMatchObject({ w: 60, r: 8 })
  })

  it('records the top weight when the exercise is complete', () => {
    const s = { active: { entries: [ex([row({ done: true, w: 70 }), row({ w: 80 })]), ex([row()], { id: 'bench' })] } }
    const res = applySetDone(s, 0, 1, { at: 1 })
    expect(res).toEqual({ checked: true, exJustDone: true, unitDone: true, workoutDone: false })
    expect(s.active.entries[0].topW).toBe(80)
  })

  it('reads the workout as done on the last open set', () => {
    const s = { active: { entries: [ex([row({ done: true })]), ex([row()], { id: 'bench' })] } }
    expect(applySetDone(s, 1, 0, { at: 1 }).workoutDone).toBe(true)
  })
})

describe('afterSetDone', () => {
  it('rests after a plain set', () => {
    const h = harness({ cur: 0, entries: [ex([row({ done: true }), row()])] })
    afterSetDone({ ...h, S: h.box.S, idx: 0, i: 0, result: { checked: true } })
    expect(h.ui.startRest).toHaveBeenCalledWith(90, 0, { forSet: 0 })
    expect(h.ui.stopRest).not.toHaveBeenCalled()
  })

  it('uses the exercise rest and the startRest it is handed', () => {
    const h = harness({ cur: 0, entries: [ex([row({ done: true }), row()], { target: { sets: 2, reps: 8, restSec: 120 } })] })
    const startRest = vi.fn()
    afterSetDone({ ...h, S: h.box.S, idx: 0, i: 0, result: { checked: true }, startRest })
    expect(startRest).toHaveBeenCalledWith(120, 0, { forSet: 0 })
    expect(h.ui.startRest).not.toHaveBeenCalled()
  })

  it('stops the running rest and rests again after the closing set of an exercise', () => {
    const h = harness({ cur: 0, entries: [ex([row({ done: true })]), ex([row()], { id: 'bench' })] })
    const onFocusProgress = vi.fn()
    afterSetDone({ ...h, S: h.box.S, idx: 0, i: 0, result: { checked: true }, onFocusProgress })
    expect(h.ui.stopRest).toHaveBeenCalled()
    expect(h.ui.startRest).toHaveBeenCalledWith(90, 0, { forSet: 0 })
    expect(onFocusProgress).toHaveBeenCalledWith({ unitDone: true })
  })

  it('does nothing for an un-tick', () => {
    const h = harness({ cur: 0, entries: [ex([row(), row()])] })
    afterSetDone({ ...h, S: h.box.S, idx: 0, i: 0, result: { checked: false } })
    expect(h.ui.startRest).not.toHaveBeenCalled()
  })

  it('moves to the partner without a rest inside a superset round', () => {
    const h = harness({ cur: 0, entries: [ex([row({ done: true }), row()], { sg: 'a' }), ex([row(), row()], { id: 'row', sg: 'a' })] })
    afterSetDone({ ...h, S: h.box.S, idx: 0, i: 0, result: { checked: true } })
    expect(h.box.S.active.cur).toBe(1)
    expect(h.ui.startRest).not.toHaveBeenCalled()
  })

  it('rests at the end of a superset round and goes back to the first member', () => {
    const h = harness({ cur: 1, entries: [ex([row({ done: true }), row()], { sg: 'a' }), ex([row({ done: true }), row()], { id: 'row', sg: 'a' })] })
    afterSetDone({ ...h, S: h.box.S, idx: 1, i: 0, result: { checked: true } })
    expect(h.box.S.active.cur).toBe(0)
    expect(h.ui.startRest).toHaveBeenCalledWith(90, 1, { forSet: 0 })
  })

  it('advances cur past a finished unit when collapsing, and says so', () => {
    const h = harness({ cur: 0, entries: [ex([row({ done: true })]), ex([row()], { id: 'bench' })] })
    const onCollapse = vi.fn()
    afterSetDone({ ...h, S: h.box.S, idx: 0, i: 0, result: { checked: true }, collapse: true, onCollapse })
    expect(onCollapse).toHaveBeenCalled()
    expect(h.box.S.active.cur).toBe(1)
  })

  it('keeps cur without collapsing', () => {
    const h = harness({ cur: 0, entries: [ex([row({ done: true })]), ex([row()], { id: 'bench' })] })
    afterSetDone({ ...h, S: h.box.S, idx: 0, i: 0, result: { checked: true } })
    expect(h.box.S.active.cur).toBe(0)
  })

  it('a re-check only owes a rest when none runs', () => {
    const h = harness({ cur: 0, entries: [ex([row({ done: true }), row()])] }, { timer: { left: 30 } })
    afterSetDone({ ...h, S: h.box.S, idx: 0, i: 0, result: { checked: true }, isNew: false })
    expect(h.ui.startRest).not.toHaveBeenCalled()
    const idle = harness({ cur: 0, entries: [ex([row({ done: true }), row()])] })
    afterSetDone({ ...idle, S: idle.box.S, idx: 0, i: 0, result: { checked: true }, isNew: false })
    expect(idle.ui.startRest).toHaveBeenCalledWith(90, 0, { forSet: 0 })
  })

  it('pauses briefly between the sides of a timed per-side set', () => {
    const t = { id: 'side-plank', target: { sets: 1, mode: 'time', sec: 30 } }
    const h = harness({ cur: 0, entries: [{ ...t, sets: [{ sec: 30, side: 'L', done: true }, { sec: 30, side: 'R', done: false }] }] })
    afterSetDone({ ...h, S: h.box.S, idx: 0, i: 0, result: { checked: true } })
    expect(h.ui.startRest).toHaveBeenCalledWith(SWITCH_SIDES_SEC, 0, { kind: 'switch', forSet: 0 })
  })
})
