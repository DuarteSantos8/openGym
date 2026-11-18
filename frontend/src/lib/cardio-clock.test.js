import { describe, expect, it } from 'vitest'
import { clockLabel, elapsedSec, minutesFor, parseRun, runAt, runSec } from './cardio-clock.js'

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
    expect(clockLabel(0)).toBe('0:00')
    expect(clockLabel(42)).toBe('0:42')
    expect(clockLabel(12 * 60 + 5)).toBe('12:05')
    expect(clockLabel(3600)).toBe('1:00:00')
    expect(clockLabel(3600 + 2 * 60 + 9)).toBe('1:02:09')
  })
})

describe('runSec', () => {
  const run = { wid: 'w1', idx: 0, i: 0, id: '2259', startedAt: T0 }
  const min = m => m * 60_000
  it('is the time since the start while the workout never paused', () => {
    expect(runSec(run, { id: 'w1', start: T0 - min(5) }, T0 + min(3))).toBe(180)
  })
  it('leaves out the workout’s pauses after the start, a pause still running included', () => {
    const A = { id: 'w1', start: T0, pauses: [{ from: T0 - min(10), to: T0 - min(8) }, { from: T0 + min(5), to: T0 + min(15) }] }
    expect(runSec(run, A, T0 + min(25))).toBe(15 * 60)
    // Paused now: the clock stands still at the pause.
    const paused = { ...A, pausedAt: T0 + min(20) }
    expect(runSec(run, paused, T0 + min(30))).toBe(10 * 60)
    expect(runSec(run, paused, T0 + min(50))).toBe(10 * 60)
  })
  it('counts a pause only from the clock’s start', () => {
    const A = { id: 'w1', start: T0 - min(20), pauses: [{ from: T0 - min(2), to: T0 + min(2) }] }
    expect(runSec(run, A, T0 + min(10))).toBe(8 * 60)
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
