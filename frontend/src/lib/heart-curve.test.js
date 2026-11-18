import { describe, expect, it } from 'vitest'
import { heartCurve, heartPerMinute } from './heart-rate.js'
import { hrMaxOf, hrZone } from './live-tiles.js'

// The session's heart rate as a curve to draw (components/HeartBand.jsx, HeartGraph.jsx).
describe('heartCurve', () => {
  it('draws the session from its start, with the samples\' average and maximum', () => {
    const curve = heartCurve([[1000, 100], [2000, 120], [3000, 140]], 1000, 4000)
    expect(curve.points).toEqual([{ t: 0, hr: 100 }, { t: 1000, hr: 120 }, { t: 2000, hr: 140 }])
    expect(curve).toMatchObject({ avg: 120, max: 140 })
  })

  it('leaves out what is outside the session or not a heart rate', () => {
    const curve = heartCurve([[500, 200], [1000, 100], [2000, 300], [3000, 120], [5000, 200]], 1000, 4000)
    expect(curve.points.map(p => p.hr)).toEqual([100, 120])
    expect(curve.max).toBe(120)
  })

  it('thins a long session to what a graph can draw, the peak still in the maximum', () => {
    const start = 0, end = 2 * 3600e3
    const samples = Array.from({ length: 3000 }, (_, i) => [i * 2400, i === 1500 ? 190 : 120])
    const curve = heartCurve(samples, start, end)
    expect(curve.points.length).toBeLessThanOrEqual(240)
    expect(curve.max).toBe(190)
    expect(curve.points.every(p => p.t >= 0 && p.t <= end)).toBe(true)
  })

  it('has nothing to draw with too little', () => {
    expect(heartCurve([], 0, 1000)).toBeNull()
    expect(heartCurve([[10, 100]], 0, 1000)).toBeNull()
    expect(heartCurve([[10, 100], [20, 110]], 1000, 1000)).toBeNull()
    expect(heartCurve(null, 0, 1000)).toBeNull()
  })
})

// The copied text's curve, one number a minute.
describe('heartPerMinute', () => {
  it('averages each minute from the start, null for a minute without a reading', () => {
    const min = 60000
    const out = heartPerMinute([[10, 100], [30000, 110], [2 * min + 5000, 150], [3 * min - 1, 200], [5 * min, 120]], 0, 3 * min)
    expect(out).toEqual([105, null, 175])
  })

  it('leaves out what is outside the session or not a heart rate', () => {
    expect(heartPerMinute([[-1, 100], [1000, 300], [2000, 20]], 0, 60000)).toEqual([null])
    expect(heartPerMinute(null, 0, 60000)).toEqual([])
    expect(heartPerMinute([[10, 100]], 1000, 1000)).toEqual([])
  })
})

// The graph's top and the zones work from the same age-predicted maximum (Tanaka).
describe('hrMaxOf', () => {
  const now = Date.UTC(2026, 5, 1)
  it('is 208 - 0.7 x age, rounded, or null without a plausible birth year', () => {
    expect(hrMaxOf({ birthYear: 1990 }, now)).toBe(183)   // 208 - 25.2 = 182.8
    expect(hrMaxOf({}, now)).toBeNull()
    expect(hrMaxOf({ birthYear: 2020 }, now)).toBeNull()
  })
  it('puts the zones where the graph draws them', () => {
    const max = hrMaxOf({ birthYear: 1990 }, now)
    expect(hrZone(Math.ceil(max * 0.9), { birthYear: 1990 }, now)).toBe(5)
    expect(hrZone(Math.floor(max * 0.5) - 1, { birthYear: 1990 }, now)).toBeNull()
  })
})

// The copied text's curve: one reading a minute, a gap where the hub had nothing.
describe('heartPerMinute', () => {
  it('averages each minute and leaves an empty one as null', () => {
    const start = 1000
    const samples = [[start + 10e3, 100], [start + 50e3, 110], [start + 130e3, 150], [start + 200e3, 300], [start + 179e3, 141]]
    expect(heartPerMinute(samples, start, start + 3 * 60e3)).toEqual([105, null, 146])
  })
  it('is empty without a session', () => {
    expect(heartPerMinute([[5, 100]], 10, 10)).toEqual([])
    expect(heartPerMinute(null, 0, 60e3)).toEqual([])
  })
})
