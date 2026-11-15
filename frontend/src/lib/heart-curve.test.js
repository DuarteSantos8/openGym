import { describe, expect, it } from 'vitest'
import { heartCurve } from './heart-rate.js'

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
