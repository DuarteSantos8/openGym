// The advent calendar's rules (lib/advent.js): which doors open when, what is kept, how two
// devices' calendars come together.
import { describe, expect, it } from 'vitest'
import { DOORS, LAYOUT, inAdvent, adventOpenable, cleanAdvent, adventOf, doorState, openDoor, markDone, nextDoor, mergeAdvent } from './advent.js'
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
    expect(adventOf(s, dec5)).toEqual({ year: 2026, opened: [], done: [] })
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
