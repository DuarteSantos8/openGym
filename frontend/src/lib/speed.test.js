// Cardio speed in km/h or mph (Discord "miles per hour"): stored in km/h, shown and typed in
// the profile's unit, and exact both ways for what a person types.
import { afterEach, describe, it, expect } from 'vitest'
import { KMH_PER_MPH, speedUnitOf, speedLabel, toSpeed, fromSpeed, fmtSpeed } from './speed.js'
import { setLabel, exLine } from './history.js'
import { planPrintHTML } from './plan-share.js'
import { setWeightDecimals } from './format.js'

const BIKE = '2138'   // stationary bike, cardio

afterEach(() => setWeightDecimals(1))

describe('speedUnitOf', () => {
  it('follows the weight unit until the profile chooses', () => {
    expect(speedUnitOf({ unit: 'kg' })).toBe('kmh')
    expect(speedUnitOf({ unit: 'lb' })).toBe('mph')
    expect(speedUnitOf({})).toBe('kmh')
    expect(speedUnitOf(null)).toBe('kmh')
    expect(speedUnitOf({ unit: 'lb', speedUnit: null })).toBe('mph')
  })
  it('keeps a choice either way round', () => {
    expect(speedUnitOf({ unit: 'kg', speedUnit: 'mph' })).toBe('mph')
    expect(speedUnitOf({ unit: 'lb', speedUnit: 'kmh' })).toBe('kmh')
    // Anything else is not a choice.
    expect(speedUnitOf({ unit: 'lb', speedUnit: 'knots' })).toBe('mph')
  })
  it('labels the numbers', () => {
    expect(speedLabel('kmh')).toBe('km/h')
    expect(speedLabel('mph')).toBe('mph')
    expect(speedLabel(undefined)).toBe('km/h')
  })
})

describe('toSpeed / fromSpeed', () => {
  it('uses the exact mile', () => {
    expect(KMH_PER_MPH).toBe(1.609344)
    expect(toSpeed(1.609344, 'mph')).toBe(1)
    expect(toSpeed(8, 'mph')).toBe(4.97)
    expect(fromSpeed(6, 'mph')).toBe(9.66)
    expect(fromSpeed(10, 'mph')).toBe(16.09)
  })

  it('is the identity in km/h, so a km/h profile stores exactly what it always did', () => {
    for (const v of [0, 8, 9.656064, 10.25, 12.3456]) {
      expect(toSpeed(v, 'kmh')).toBe(v)
      expect(fromSpeed(v, 'kmh')).toBe(v)
      expect(toSpeed(v, undefined)).toBe(v)
    }
  })

  it('reads back every mph speed typed with up to two decimals exactly as typed', () => {
    const off = []
    for (let i = 0; i <= 4000; i++) {
      const typed = i / 100
      const back = toSpeed(fromSpeed(typed, 'mph'), 'mph')
      if (back !== typed) off.push([typed, back])
    }
    expect(off).toEqual([])
  })

  it('stores km/h to the hundredth, not the full float', () => {
    expect(fromSpeed(6.2, 'mph')).toBe(9.98)
    expect(String(fromSpeed(3.3, 'mph'))).toBe('5.31')
  })

  it('passes an empty field through untouched', () => {
    for (const v of [null, undefined, '']) {
      expect(toSpeed(v, 'mph')).toBe(v)
      expect(fromSpeed(v, 'mph')).toBe(v)
    }
  })
})

describe('speed in labels', () => {
  it('formats a stored km/h speed in the unit on screen', () => {
    expect(fmtSpeed(8, 'kmh')).toBe('8 km/h')
    expect(fmtSpeed(8, 'mph')).toBe('5 mph')
    setWeightDecimals(2)
    expect(fmtSpeed(8, 'mph')).toBe('4.97 mph')
  })

  it('reads a logged cardio set and a planned cardio slot in mph', () => {
    const set = { min: 30, speed: 9.66, done: true }
    const target = { id: BIKE, sets: 1, min: 30, speed: 9.66 }
    expect(setLabel(BIKE, set, target, 'mph')).toBe('30 min @ 6 mph')
    expect(setLabel(BIKE, set, target)).toBe('30 min @ 9.7 km/h')
    // A set saved by an older build, with no target: read from its own fields.
    expect(setLabel(BIKE, set, null, 'mph')).toBe('30 min @ 6 mph')
    expect(exLine({ id: BIKE, sets: 2, min: 20, speed: 16.09 }, 'lb', 'mph')).toBe('2 × 20 min @ 10 mph')
    expect(exLine({ id: BIKE, sets: 2, min: 20, speed: 16.09 }, 'kg')).toBe('2 × 20 min @ 16.1 km/h')
  })

  it('prints a plan in the profile\'s speed unit', () => {
    const routines = [{ id: 'c', name: 'Cardio', ex: [{ id: BIKE, sets: 1, min: 25, speed: 16.09 }] }]
    expect(planPrintHTML({ unit: 'lb', week: {}, routines }, '')).toContain('25 min @ 10 mph')
    expect(planPrintHTML({ unit: 'kg', week: {}, routines }, '')).toContain('25 min @ 16.1 km/h')
    expect(planPrintHTML({ unit: 'kg', speedUnit: 'mph', week: {}, routines }, '', { routineId: 'c' })).toContain('25 min @ 10 mph')
  })
})
