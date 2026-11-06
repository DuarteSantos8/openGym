// Vitals from the phone's health store (lib/vitals.js): sleep merged as time, never summed; a day
// a read covered is rewritten, older ones kept; the card's summary against your own usual.
import { describe, it, expect } from 'vitest'
import { unionOf, minus, sleepByDay, mergeVitals, vitalsSummary, sleepHoursOn, VITALS_KEEP_DAYS } from './vitals.js'

const at = (iso, h, m = 0) => new Date(`${iso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime()

describe('sleep', () => {
  it('merges overlapping stretches instead of adding them', () => {
    expect(unionOf([[1, 5], [3, 8], [10, 12]])).toEqual([[1, 8], [10, 12]])
    expect(minus([[0, 10]], [[2, 3], [5, 6]])).toEqual([[0, 2], [3, 5], [6, 10]])
  })
  it('counts a night once when the watch and the phone both tracked it, minus the awake bits', () => {
    const sleep = [
      { s: at('2026-11-05', 23), e: at('2026-11-06', 7), a: 0 },          // the watch
      { s: at('2026-11-05', 23, 30), e: at('2026-11-06', 6, 30), a: 0 },  // the phone, inside it
      { s: at('2026-11-06', 3), e: at('2026-11-06', 3, 30), a: 1 },       // awake for half an hour
    ]
    expect(sleepByDay(sleep)).toEqual({ '2026-11-06': 450 })
  })
  it('leaves an afternoon nap out, and takes "in bed" only for a night with nothing better', () => {
    const sleep = [
      { s: at('2026-11-06', 15), e: at('2026-11-06', 16), a: 0 },
      { s: at('2026-11-06', 23), e: at('2026-11-07', 6), a: 2 },
      { s: at('2026-11-07', 22), e: at('2026-11-08', 7), a: 2 },
      { s: at('2026-11-07', 23), e: at('2026-11-08', 6), a: 0 },
    ]
    expect(sleepByDay(sleep)).toEqual({ '2026-11-07': 420, '2026-11-08': 420 })
  })
})

describe('merging a read', () => {
  const raw = {
    sleep: [{ s: at('2026-11-05', 23), e: at('2026-11-06', 7), a: 0 }],
    rhr: [{ t: at('2026-11-06', 6), v: 58 }, { t: at('2026-11-06', 9), v: 55 }, { t: at('2026-11-06', 10), v: 400 }],
    hrv: [{ t: at('2026-11-06', 6), v: 40 }, { t: at('2026-11-06', 7), v: 60 }],
    steps: [{ d: '2026-11-06', n: 8123.4 }, { d: '2026-11-05', n: -3 }],
    hrvKind: 'rmssd',
  }
  it('keeps one value per day: the last resting rate, the mean variability, the store’s step total', () => {
    const v = mergeVitals({}, raw, { from: '2026-11-05', today: '2026-11-06' })
    expect(v.days['2026-11-06']).toEqual({ sleepMin: 480, rhr: 55, hrv: 50, steps: 8123 })
    expect(v.hrvKind).toBe('rmssd')
  })
  it('rewrites only the days the read covered, keeps a kind it did not bring, and forgets old days', () => {
    const before = { days: { '2026-11-04': { steps: 100 }, '2026-11-06': { steps: 50, rhr: 60 }, '2026-01-01': { steps: 5 } }, hrvKind: 'rmssd' }
    const v = mergeVitals(before, { steps: [{ d: '2026-11-06', n: 9000 }, { d: '2026-11-04', n: 1 }] }, { from: '2026-11-05', today: '2026-11-06' })
    expect(v.days['2026-11-04'].steps).toBe(100)
    expect(v.days['2026-11-06']).toEqual({ steps: 9000, rhr: 60 })
    expect(v.days['2026-01-01']).toBeUndefined()
    expect(VITALS_KEEP_DAYS).toBeGreaterThanOrEqual(90)
  })
})

describe('the card’s summary', () => {
  it('shows the latest of each with the usual from a week of readings up', () => {
    const days = {}
    for (let i = 1; i <= 10; i++) days[`2026-10-${String(20 + i).padStart(2, '0')}`] = { sleepMin: 420, rhr: 60 }
    days['2026-11-06'] = { sleepMin: 360, rhr: 52, steps: 4000 }
    const s = vitalsSummary({ days }, '2026-11-06')
    expect(s.sleep).toEqual({ v: 360, d: '2026-11-06', usual: 420 })
    expect(s.rhr.usual).toBe(60)
    expect(s.steps.usual).toBeNull()
    expect(s.hrv).toBeNull()
    expect(sleepHoursOn({ days }, '2026-11-06')).toBe(6)
    expect(sleepHoursOn({ days }, '2026-11-07')).toBeNull()
  })
  it('says nothing about a reading more than a week old', () => {
    expect(vitalsSummary({ days: { '2026-10-01': { steps: 9000 } } }, '2026-11-06').steps).toBeNull()
  })
})
