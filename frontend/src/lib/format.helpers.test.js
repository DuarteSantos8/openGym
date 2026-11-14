// The small formatting helpers most screens lean on and no other test pins down: a span of days,
// a duration that may be unknown, names cased for a toast, volume and plain numbers.
import { afterEach, describe, expect, it } from 'vitest'
import { fmtDateRange, durPart, capWords, fmtVol, fmtNum, setWeightDecimals } from './format.js'

const NOW = new Date('2026-10-19T12:00:00')

describe('fmtDateRange', () => {
  it('leaves the year out for a span inside the current year', () => {
    expect(fmtDateRange('2026-02-03', '2026-12-21', false, NOW)).toBe('3 Feb – 21 Dec')
  })
  it('shows the year on both ends when the span crosses one', () => {
    expect(fmtDateRange('2025-12-30', '2026-01-02', false, NOW)).toBe('30 Dec 2025 – 2 Jan 2026')
  })
  it('shows the year for a span that lies in another year', () => {
    expect(fmtDateRange('2025-03-01', '2025-03-04', false, NOW)).toBe('1 Mar 2025 – 4 Mar 2025')
  })
  it('is a single date when both ends are the same day or there is no end', () => {
    expect(fmtDateRange('2025-03-01', '2025-03-01', true, NOW)).toBe('Sat, 1 Mar 2025')
    expect(fmtDateRange('2026-03-01', null, false, NOW)).toBe('1 Mar')
  })
  it('is empty with no start', () => {
    expect(fmtDateRange('', '2026-03-01', false, NOW)).toBe('')
    expect(fmtDateRange(null, null, false, NOW)).toBe('')
  })
})

describe('durPart', () => {
  it('leaves an unknown or sub-minute duration out instead of saying "0 min"', () => {
    expect(durPart(0)).toEqual([])
    expect(durPart(59999)).toEqual([])
    expect(durPart(undefined)).toEqual([])
  })
  it('formats a known one', () => {
    expect(durPart(60000)).toEqual(['1 min'])
    expect(durPart((62 * 60 + 5) * 1000)).toEqual(['1h 2m'])
  })
})

describe('capWords', () => {
  it('capitalises every word, also after brackets, hyphens and slashes', () => {
    expect(capWords('barbell bench press (wide-grip)/close')).toBe('Barbell Bench Press (Wide-Grip)/Close')
  })
  it('handles letters outside ASCII and leaves upper case alone', () => {
    expect(capWords('über kreuz')).toBe('Über Kreuz')
    expect(capWords('EZ bar curl')).toBe('EZ Bar Curl')
  })
  it('reads nothing as an empty string', () => {
    expect(capWords(null)).toBe('')
    expect(capWords(undefined)).toBe('')
  })
})

describe('fmtNum / fmtVol', () => {
  afterEach(() => setWeightDecimals(1))

  it('rounds to the profile\'s decimals and groups thousands', () => {
    expect(fmtVol(7535.5, 'kg')).toBe('7,535.5 kg')
    expect(fmtNum(62.5)).toBe('62.5')
    expect(fmtNum(80)).toBe('80')
    setWeightDecimals(2)
    expect(fmtNum(21.25)).toBe('21.25')
  })

  // A change that rounds away ("-0.03 kg") printed "-0": a minus sign in front of nothing.
  it('never prints a negative zero', () => {
    expect(fmtNum(-0.03)).toBe('0')
    expect(fmtNum(-0)).toBe('0')
    setWeightDecimals(2)
    expect(fmtNum(-0.004)).toBe('0')
    expect(fmtNum(-0.05)).toBe('-0.05')
  })
})
