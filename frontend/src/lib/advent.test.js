// The advent calendar's rules (lib/advent.js): which doors open when, what is kept, how two
// devices' calendars come together.
import { describe, expect, it } from 'vitest'
import {
  DOORS, LAYOUT, OPEN_DEG, inAdvent, adventOpenable, cleanAdvent, adventOf, doorState, openDoor, markDone, nextDoor, mergeAdvent,
  countReps, repsDone, adventLit, treeOf, trainedOn, dragAngle, projectAngle, releaseOpens, springStep, springSettled,
} from './advent.js'
import { mergeStates } from './sync-merge.js'

const local = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min)
const dec5 = local(2026, 12, 5, 9)

describe('the days', () => {
  it('runs 1 to 24 December, local time; the calendar stays openable to the end of December', () => {
    expect(inAdvent(local(2026, 11, 30, 23, 59))).toBe(false)
    expect(inAdvent(local(2026, 12, 1, 0, 0))).toBe(true)
    expect(inAdvent(local(2026, 12, 24, 23, 59))).toBe(true)
    expect(inAdvent(local(2026, 12, 25, 0, 0))).toBe(false)
    expect(adventOpenable(local(2026, 12, 31, 23, 59))).toBe(true)
    expect(adventOpenable(local(2027, 1, 1, 0, 0))).toBe(false)
  })

  it('hangs all 24 doors, each once', () => {
    expect([...LAYOUT].sort((a, b) => a - b)).toEqual(Array.from({ length: DOORS }, (_, i) => i + 1))
  })
})

describe('the doors', () => {
  it('a day still to come is locked, today waits, an earlier one is still there to take', () => {
    expect(doorState({}, 6, dec5)).toBe('locked')
    expect(doorState({}, 24, dec5)).toBe('locked')
    expect(doorState({}, 5, dec5)).toBe('today')
    expect(doorState({}, 1, dec5)).toBe('ready')
    // the day turns at local midnight
    expect(doorState({}, 6, local(2026, 12, 5, 23, 59))).toBe('locked')
    expect(doorState({}, 6, local(2026, 12, 6, 0, 0))).toBe('today')
  })

  it('out of December every door is locked, and nonsense days are too', () => {
    expect(doorState({}, 1, local(2026, 11, 30))).toBe('locked')
    expect(doorState({}, 1, local(2027, 1, 2))).toBe('locked')
    for (const d of [0, 25, -1, 1.5, NaN]) expect(doorState({}, d, dec5)).toBe('locked')
  })

  it('opening: today and a missed day open, a future door does not and nothing changes', () => {
    const s = {}
    expect(openDoor(s, 6, dec5)).toBe(false)
    expect(s.advent).toBeUndefined()
    expect(openDoor(s, 5, dec5)).toBe(true)
    expect(openDoor(s, 2, dec5)).toBe(true)
    expect(openDoor(s, 5, dec5)).toBe(true)   // again: still once
    expect(s.advent).toEqual({ year: 2026, opened: [2, 5], done: [] })
    expect(doorState(s, 5, dec5)).toBe('open')
    expect(nextDoor(s, dec5)).toBe(1)
  })

  it('a challenge is ticked off only behind an open door', () => {
    const s = {}
    expect(markDone(s, 3, dec5)).toBe(false)
    openDoor(s, 3, dec5)
    expect(markDone(s, 3, dec5)).toBe(true)
    expect(adventOf(s, dec5).done).toEqual([3])
  })

  it('the next door: today\'s first, then the earliest one left, then none', () => {
    expect(nextDoor({}, dec5)).toBe(5)
    const s = {}
    for (const d of [5, 1, 2, 3]) openDoor(s, d, dec5)
    expect(nextDoor(s, dec5)).toBe(4)
    openDoor(s, 4, dec5)
    expect(nextDoor(s, dec5)).toBe(null)
    expect(nextDoor({}, local(2026, 12, 28))).toBe(1)
    expect(nextDoor({}, local(2026, 7, 1))).toBe(null)
  })
})

describe('what is kept', () => {
  it('a calendar from last year reads as a fresh one, and opening starts this year\'s', () => {
    const s = { advent: { year: 2025, opened: [1, 2, 3], done: [2] } }
    expect(adventOf(s, dec5)).toEqual({ year: 2026, opened: [], done: [], reps: {} })
    expect(doorState(s, 1, dec5)).toBe('ready')
    openDoor(s, 1, dec5)
    expect(s.advent).toEqual({ year: 2026, opened: [1], done: [] })
  })

  it('whatever a device sends, only the numbers 1 to 24, once each, sorted', () => {
    const junk = { year: 2026, opened: [3, 3, '4', 99, -1, 2.5, null, 24, ...Array(5000).fill(7)], done: [3, 9, 'x'] }
    expect(cleanAdvent(junk)).toEqual({ year: 2026, opened: [3, 4, 7, 24], done: [3] })
    expect(JSON.stringify(cleanAdvent({ year: 2026, opened: Array.from({ length: 1e4 }, (_, i) => i), done: [] })).length).toBeLessThan(200)
    for (const bad of [null, 'x', [], { year: 'soon' }, { year: 12 }]) expect(cleanAdvent(bad)).toBe(null)
  })
})

describe('two devices', () => {
  it('merge by union for the same year; the later year wins', () => {
    const a = { year: 2026, opened: [1, 2], done: [1] }, b = { year: 2026, opened: [2, 5], done: [5] }
    expect(mergeAdvent(a, b)).toEqual({ year: 2026, opened: [1, 2, 5], done: [1, 5] })
    expect(mergeAdvent(b, a)).toEqual(mergeAdvent(a, b))
    expect(mergeAdvent(a, { year: 2027, opened: [1], done: [] })).toEqual({ year: 2027, opened: [1], done: [] })
    expect(mergeAdvent(undefined, a)).toEqual(a)
    expect(mergeAdvent(undefined, 'junk')).toBeUndefined()
  })

  it('in the full sync merge, a door opened on either copy stays open, whichever changed it last', () => {
    const T = 1_800_000_000_000
    const base = { unit: 'kg', workouts: [], routines: [], bodyweight: [] }
    const phone = { ...base, _ts: T + 10, advent: { year: 2026, opened: [1, 3], done: [3] }, edited: { advent: T + 10 } }
    const laptop = { ...base, _ts: T + 20, advent: { year: 2026, opened: [1, 2], done: [] }, edited: { advent: T + 20 } }
    for (const out of [mergeStates(phone, laptop), mergeStates(laptop, phone)]) {
      expect(out.advent).toEqual({ year: 2026, opened: [1, 2, 3], done: [3] })
    }
    // a copy without a calendar takes the other's
    expect(mergeStates({ ...base, _ts: T + 30 }, phone).advent).toEqual(phone.advent)
  })
})

describe('only in December, every year', () => {
  it('nothing opens in November or January, whatever the year; every December it does', () => {
    for (const now of [local(2026, 11, 30, 23, 59), local(2027, 11, 15), local(2027, 1, 1, 0, 0), local(2031, 6, 1)]) {
      expect(inAdvent(now)).toBe(false)
      expect(adventOpenable(now)).toBe(false)
      expect(nextDoor({}, now)).toBe(null)
      const s = {}
      expect(openDoor(s, 1, now)).toBe(false)
      expect(s.advent).toBeUndefined()
    }
    for (const now of [local(2026, 12, 1, 0, 0), local(2027, 12, 3), local(2025, 12, 5)]) expect(inAdvent(now)).toBe(true)
  })
})

describe('counting doors', () => {
  it('counts up in steps, saves only below the goal, and reaching it does the door', () => {
    const s = {}
    expect(countReps(s, 5, 10, 50, dec5)).toBe(false)          // not open yet
    openDoor(s, 5, dec5)
    expect(countReps(s, 5, 10, 50, dec5)).toBe('counted')
    expect(countReps(s, 5, 20, 50, dec5)).toBe('counted')
    expect(s.advent.reps).toEqual({ 5: 30 })
    expect(repsDone(s, 5, 50, dec5)).toBe(30)
    expect(countReps(s, 5, -40, 50, dec5)).toBe('counted')     // a slip of the thumb, never below 0
    expect(repsDone(s, 5, 50, dec5)).toBe(0)
    expect(s.advent).toEqual({ year: 2026, opened: [5], done: [] })
    countReps(s, 5, 40, 50, dec5)
    expect(countReps(s, 5, 10, 50, dec5)).toBe('done')
    expect(s.advent).toEqual({ year: 2026, opened: [5], done: [5] })
    expect(repsDone(s, 5, 50, dec5)).toBe(50)
    expect(countReps(s, 5, 10, 50, dec5)).toBe(false)          // done is done
  })

  it('keeps the field tiny: counts only for open, unfinished doors, capped', () => {
    const v = cleanAdvent({ year: 2026, opened: [1, 2], done: [2], reps: { 1: 5e9, 2: 10, 3: 4, x: 2, 0: 1, 4: -2 } })
    expect(v).toEqual({ year: 2026, opened: [1, 2], done: [2], reps: { 1: 999 } })
    expect(cleanAdvent({ year: 2026, opened: [1], done: [], reps: 'lots' })).toEqual({ year: 2026, opened: [1], done: [] })
  })
})

describe('the tree', () => {
  const T = { workouts: [{ id: 'w', d: '2026-12-03', entries: [] }, { id: 'old', d: '2025-12-04', entries: [] }] }
  it('an open door hangs a bauble; it lights when its thing is done or you trained that day', () => {
    const s = { ...T }
    for (const d of [2, 3, 4]) openDoor(s, d, dec5)
    markDone(s, 2, dec5)
    expect(adventLit(s, 2, dec5)).toBe(true)     // done
    expect(adventLit(s, 3, dec5)).toBe(true)     // trained on 3 December
    expect(adventLit(s, 4, dec5)).toBe(false)    // last year's 4 December is not this one
    expect(adventLit(s, 1, dec5)).toBe(false)    // not open: nothing hangs
    expect(treeOf(s, dec5)).toEqual({ hung: 3, lit: 2 })
    expect(trainedOn(T, 2026, 3)).toBe(true)
    expect(trainedOn({}, 2026, 3)).toBe(false)
  })
})

describe('a 1.4.4 copy and a 1.4.5 one', () => {
  it('merge: doors and done by union, the higher count of a door, finished doors drop their count', () => {
    const old = { year: 2026, opened: [1, 2, 3], done: [1] }
    const now = { year: 2026, opened: [2, 3], done: [], reps: { 2: 20, 3: 10 } }
    expect(mergeAdvent(old, now)).toEqual({ year: 2026, opened: [1, 2, 3], done: [1], reps: { 2: 20, 3: 10 } })
    expect(mergeAdvent(now, { ...now, reps: { 2: 30 }, done: [3] })).toEqual({ year: 2026, opened: [2, 3], done: [3], reps: { 2: 30 } })
    // what a 1.4.4 device keeps of a 1.4.5 calendar (its own cleanAdvent drops reps) still merges
    const { reps, ...as144 } = mergeAdvent(old, now)
    expect(mergeAdvent(as144, now)).toEqual(mergeAdvent(old, now))
  })

  it('in the full sync merge, counts survive whichever copy changed last', () => {
    const T = 1_800_000_000_000
    const base = { unit: 'kg', workouts: [], routines: [], bodyweight: [] }
    const phone = { ...base, _ts: T + 10, advent: { year: 2026, opened: [1], done: [], reps: { 1: 30 } }, edited: { advent: T + 10 } }
    const laptop = { ...base, _ts: T + 20, advent: { year: 2026, opened: [1, 2], done: [] }, edited: { advent: T + 20 } }
    for (const out of [mergeStates(phone, laptop), mergeStates(laptop, phone)]) {
      expect(out.advent).toEqual({ year: 2026, opened: [1, 2], done: [], reps: { 1: 30 } })
    }
  })
})

describe('swinging the big door', () => {
  it('follows the finger: dragging the free edge toward the hinge opens it, the other way gives a little', () => {
    expect(dragAngle(0, 200)).toBe(0)
    expect(dragAngle(-100, 200)).toBeCloseTo(70)
    expect(dragAngle(100, 200, true)).toBeCloseTo(70)        // right to left: the hinge is on the right
    const back = dragAngle(80, 200)
    expect(back).toBeLessThan(0)
    expect(back).toBeGreaterThan(-20)                          // rubber-banded, not 1:1
    expect(dragAngle(-1000, 200)).toBeLessThan(OPEN_DEG + 30)  // never far past wide open
  })

  it('on release, where the swing is heading decides: a flick opens it, a slow drag needs half way', () => {
    expect(releaseOpens(10, 0)).toBe(false)
    expect(releaseOpens(10, 600)).toBe(true)                  // flicked
    expect(releaseOpens(60, 0)).toBe(true)
    expect(releaseOpens(70, -700)).toBe(false)                // pushed back shut
    expect(projectAngle(20, 0)).toBe(20)
  })

  it('the spring gets there, overshoots a touch at most, and settles', () => {
    let st = { x: 0, v: 520 }, peak = 0, t = 0
    while (!springSettled(st, OPEN_DEG) && t < 3) { st = springStep(st, OPEN_DEG, 1 / 60); peak = Math.max(peak, st.x); t += 1 / 60 }
    expect(t).toBeLessThan(2)
    expect(peak).toBeLessThan(OPEN_DEG * 1.1)
    expect(Math.abs(st.x - OPEN_DEG)).toBeLessThan(0.5)
    // a long frame does not blow it up
    expect(Math.abs(springStep({ x: 0, v: 0 }, OPEN_DEG, 0.5).x)).toBeLessThan(OPEN_DEG * 1.5)
  })
})
