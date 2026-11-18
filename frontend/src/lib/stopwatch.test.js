import { describe, expect, it } from 'vitest'
import { elapsed, running, showing, startW, stopW, resetW, ofSession, stopwatchText, stopwatchShort } from './stopwatch.js'

describe('workout stopwatch', () => {
  it('counts what ran, keeps it while stopped and goes on from there', () => {
    let w = ofSession(null, 'w1')
    expect(showing(w)).toBe(false)
    w = startW(w, 1000)
    expect(running(w)).toBe(true)
    expect(elapsed(w, 3500)).toBe(2500)
    expect(startW(w, 3000)).toBe(w)   // a second Start does not restart it
    w = stopW(w, 3500)
    expect(running(w)).toBe(false)
    expect(showing(w)).toBe(true)
    expect(elapsed(w, 99_999)).toBe(2500)
    expect(stopW(w, 5000)).toBe(w)
    w = startW(w, 10_000)
    expect(elapsed(w, 10_500)).toBe(3000)
    expect(elapsed(resetW(w), 10_500)).toBe(0)
    expect(showing(resetW(w))).toBe(false)
  })

  it('a stopwatch of another workout reads as a fresh one', () => {
    const w = { session: 'w1', since: 1000, acc: 500 }
    expect(ofSession(w, 'w1')).toBe(w)
    expect(ofSession(w, 'w2')).toEqual({ session: 'w2', since: null, acc: 0 })
  })

  it('shows tenths, and whole seconds for the header', () => {
    expect(stopwatchText(0)).toBe('0:00.0')
    expect(stopwatchText(42_340)).toBe('0:42.3')
    expect(stopwatchText(725_000)).toBe('12:05.0')
    expect(stopwatchText(3_725_300)).toBe('1:02:05.3')
    expect(stopwatchShort(65_900)).toBe('1:05')
    expect(stopwatchShort(3_725_300)).toBe('1:02:05')
  })
})
