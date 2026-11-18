import { describe, expect, it } from 'vitest'
import { clockLabel, elapsedSec, minutesFor, parseRun, runAt } from './cardio-clock.js'

const T0 = 1_760_000_000_000

describe('elapsedSec', () => {
  it('counts whole seconds from the start', () => {
    expect(elapsedSec(T0, T0)).toBe(0)
    expect(elapsedSec(T0, T0 + 999)).toBe(0)
    expect(elapsedSec(T0, T0 + 61_500)).toBe(61)
  })
  it('never goes below 0 when the clock was set back', () => {
    expect(elapsedSec(T0, T0 - 5000)).toBe(0)
  })
})

describe('minutesFor', () => {
  it('rounds to the nearest whole minute', () => {
    expect(minutesFor(89)).toBe(1)
    expect(minutesFor(90)).toBe(2)
    expect(minutesFor(20 * 60 + 29)).toBe(20)
    expect(minutesFor(20 * 60 + 30)).toBe(21)
  })
  it('writes 1, never 0, for a run of 30 seconds or more', () => {
    expect(minutesFor(30)).toBe(1)
    expect(minutesFor(59)).toBe(1)
  })
  it('writes nothing for a run under 30 seconds, a tap by mistake', () => {
    expect(minutesFor(0)).toBe(null)
    expect(minutesFor(29)).toBe(null)
    expect(minutesFor(NaN)).toBe(null)
  })
})

describe('clockLabel', () => {
  it('reads m:ss, and h:mm:ss past an hour', () => {
    expect(clockLabel(T0, T0)).toBe('0:00')
    expect(clockLabel(T0, T0 + 42_000)).toBe('0:42')
    expect(clockLabel(T0, T0 + (12 * 60 + 5) * 1000)).toBe('12:05')
    expect(clockLabel(T0, T0 + 3600_000)).toBe('1:00:00')
    expect(clockLabel(T0, T0 + (3600 + 2 * 60 + 9) * 1000)).toBe('1:02:09')
  })
})

describe('parseRun', () => {
  const run = { wid: 'w1', idx: 0, i: 1, id: '2259', startedAt: T0 }
  it('reads a stored run, from text or as is', () => {
    expect(parseRun(JSON.stringify(run))).toEqual(run)
    expect(parseRun(run)).toEqual(run)
  })
  it('turns down anything else', () => {
    expect(parseRun('not json')).toBe(null)
    expect(parseRun('null')).toBe(null)
    expect(parseRun({ ...run, wid: undefined })).toBe(null)
    expect(parseRun({ ...run, id: null })).toBe(null)
    expect(parseRun({ ...run, idx: -1 })).toBe(null)
    expect(parseRun({ ...run, i: 1.5 })).toBe(null)
    expect(parseRun({ ...run, startedAt: 0 })).toBe(null)
    expect(parseRun({ ...run, startedAt: 'soon' })).toBe(null)
  })
})

describe('runAt', () => {
  const active = (more = {}) => ({
    id: 'w1',
    entries: [
      { id: '1', sets: [{ r: 5, done: true }] },
      { id: '2259', sets: [{ min: 20, done: true }, { min: 20, done: false }] },
    ],
    ...more,
  })
  const run = { wid: 'w1', idx: 1, i: 1, id: '2259', startedAt: T0 }
  it('finds the set it times', () => {
    expect(runAt(active(), run)).toEqual({ idx: 1, i: 1 })
  })
  it('ignores a run kept from another workout', () => {
    expect(runAt(active({ id: 'w2' }), run)).toBe(null)
    expect(runAt(null, run)).toBe(null)
  })
  it('lets go of a set that is gone or ticked', () => {
    expect(runAt(active(), { ...run, i: 2 })).toBe(null)
    expect(runAt(active(), { ...run, i: 0 })).toBe(null)
  })
  it('follows its exercise to another place, while only one entry has that exercise', () => {
    const moved = active()
    moved.entries.reverse()
    expect(runAt(moved, run)).toEqual({ idx: 0, i: 1 })
    moved.entries.push({ id: '2259', sets: [{ min: 10, done: false }, { min: 10, done: false }] })
    expect(runAt(moved, run)).toBe(null)
  })
})
