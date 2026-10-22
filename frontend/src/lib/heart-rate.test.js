import { describe, expect, it } from 'vitest'
import { betterHr, fmtHr, hrSummary } from './heart-rate.js'

// The heart rate Apple Health holds for a workout's window, summarised onto the workout as w.hr.
const start = Date.UTC(2026, 9, 20, 18)
const end = start + 60 * 60000
const at = (sec, bpm) => ({ t: start + sec * 1000, bpm })

describe('hrSummary', () => {
  it('is null without samples', () => {
    expect(hrSummary([], start, end)).toBeNull()
    expect(hrSummary(null, start, end)).toBeNull()
    expect(hrSummary([at(-120, 90), at(3800, 90)], start, end)).toBeNull()
  })

  it('keeps the window with a minute of slack, sorted, as offsets from the start', () => {
    const hr = hrSummary([at(600, 150.4), at(-30, 90), at(-61, 200), at(3659, 120), at(3661, 40), at(10, 100.6)], start, end)
    expect(hr).toEqual({ avg: 115, max: 150, min: 90, n: 4, s: [[-30, 90], [10, 101], [600, 150], [3659, 120]] })
  })

  it('ignores a sample with no reading', () => {
    expect(hrSummary([at(10, 0), at(20, NaN), at(30, 120)], start, end)).toMatchObject({ n: 1, avg: 120 })
  })

  it('buckets a long run into 240 points, the summary over every raw sample', () => {
    // one sample a second for the hour: 3600 raw, 15 per bucket of 15 s
    const samples = Array.from({ length: 3600 }, (_, i) => at(i, i < 1800 ? 100 : 160))
    samples.push(at(1, 190))
    const hr = hrSummary(samples, start, end)
    expect(hr.n).toBe(3601)
    expect(hr.max).toBe(190)
    expect(hr.min).toBe(100)
    expect(hr.s).toHaveLength(240)
    expect(hr.s[0]).toEqual([8, Math.round((15 * 100 + 190) / 16)])
    expect(hr.s[1]).toEqual([23, 100])
    expect(hr.s[239]).toEqual([3593, 160])
  })

  it('keeps only the buckets that have samples', () => {
    const samples = Array.from({ length: 300 }, (_, i) => at(i < 150 ? i : 3000 + i, 120))
    const hr = hrSummary(samples, start, end)
    expect(hr.n).toBe(300)
    expect(hr.s.length).toBeLessThan(240)
    expect(hr.s.every(([o, b]) => b === 120 && o >= 0 && o <= 3600)).toBe(true)
  })
})

describe('betterHr', () => {
  const a = { avg: 120, max: 150, min: 90, n: 10, s: [] }
  const b = { avg: 125, max: 160, min: 90, n: 40, s: [] }
  it('takes a later fetch only with more samples', () => {
    expect(betterHr(undefined, a)).toBe(a)
    expect(betterHr(a, b)).toBe(b)
    expect(betterHr(b, a)).toBe(b)
    expect(betterHr(a, { ...a })).toBe(a)
    expect(betterHr(a, null)).toBe(a)
  })
})

describe('fmtHr', () => {
  it('reads as the average and the peak', () => {
    expect(fmtHr({ avg: 132, max: 171, min: 80, n: 3, s: [] })).toBe('132 avg · 171 max')
    expect(fmtHr(null)).toBe('')
  })
})
