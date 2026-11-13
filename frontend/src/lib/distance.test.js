// #887: a cardio set logged by its distance, the speed worked out from it, in km or miles.
import { describe, expect, it } from 'vitest'
import { distUnitOf, byDistance, withCardioBy, toDist, fromDist, distanceKmOf, settleSpeed, fmtDist, fmtPace } from './distance.js'
import { setLabel } from './history.js'

describe('cardio distance (#887)', () => {
  it('follows the speed unit: miles with mph, km otherwise', () => {
    expect(distUnitOf({ unit: 'kg' })).toBe('km')
    expect(distUnitOf({ unit: 'lb' })).toBe('mi')
    expect(distUnitOf({ unit: 'kg', speedUnit: 'mph' })).toBe('mi')
    expect(toDist(1.609344, 'mi')).toBe(1)
    expect(fromDist(3.1, 'mi')).toBeCloseTo(4.989, 3)
    expect(fromDist(5, 'km')).toBe(5)
  })
  it('works the speed out from distance and time, and a speed set keeps speed × time', () => {
    const s = settleSpeed({ min: 30, km: 5 })
    expect(s.speed).toBe(10)
    expect(distanceKmOf(s)).toBe(5)
    expect(distanceKmOf({ min: 30, speed: 8 })).toBe(4)
    s.min = 25; settleSpeed(s)
    expect(s.speed).toBe(12)
    expect(fmtDist(5, 'km')).toBe('5 km')
    expect(fmtPace({ min: 30, km: 5 }, 'km')).toBe('6:00 /km')
    expect(fmtPace({ min: 30 }, 'km')).toBe('')
  })
  it('is chosen per exercise', () => {
    const S = { cardioBy: withCardioBy({}, 'bike', 'distance') }
    expect(byDistance(S, 'bike')).toBe(true)
    expect(byDistance(S, 'run')).toBe(false)
    expect(withCardioBy(S.cardioBy, 'bike', 'speed')).toEqual({})
  })
  it('a set with a distance reads as its distance and pace in the history', () => {
    const id = '2138'
    expect(setLabel(id, { min: 30, km: 5, speed: 10 }, { id, mode: 'cardio' }, 'kmh')).toBe('30 min · 5 km · 6:00 /km')
    expect(setLabel(id, { min: 30, speed: 8 }, { id, mode: 'cardio' }, 'kmh')).toBe('30 min @ 8 km/h')
  })
})
