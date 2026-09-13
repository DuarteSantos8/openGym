import { describe, it, expect } from 'vitest'
import {
  jp3SitesFor, navyCircKeysFor, sumSkinfolds, jp3BodyDensity, siriBodyFatPct, jp3BodyFatPct,
  navyBodyFatPct, clampBodyFatPct, toInches, lengthUnitFor
} from './bodyfat.js'

describe('Jackson–Pollock 3-site', () => {
  it('picks sex-specific caliper sites', () => {
    expect(jp3SitesFor('male')).toEqual(['chest', 'abdomen', 'thigh'])
    expect(jp3SitesFor('female')).toEqual(['triceps', 'suprailiac', 'thigh'])
  })

  it('sums male sites and rejects missing folds', () => {
    expect(sumSkinfolds({ chest: 12, abdomen: 24, thigh: 18 }, 'male')).toBe(54)
    expect(sumSkinfolds({ chest: 12, abdomen: 24 }, 'male')).toBe(null)
  })

  // Worked example: chest 12, abdomen 24, thigh 18, age 35 → ~16.8%
  it('matches the published male worked example (~16.8%)', () => {
    const dens = jp3BodyDensity({ chest: 12, abdomen: 24, thigh: 18 }, 35, 'male')
    expect(dens).toBeCloseTo(1.06039, 4)
    expect(siriBodyFatPct(dens)).toBeCloseTo(16.8, 1)
    expect(jp3BodyFatPct({ chest: 12, abdomen: 24, thigh: 18 }, 35, 'male')).toBe(16.8)
  })

  it('computes a plausible female JP3 estimate', () => {
    const pct = jp3BodyFatPct({ triceps: 18, suprailiac: 22, thigh: 28 }, 30, 'female')
    expect(pct).toBeGreaterThan(15)
    expect(pct).toBeLessThan(35)
  })
})

describe('U.S. Navy circumference', () => {
  it('picks sex-specific tape sites', () => {
    expect(navyCircKeysFor('male')).toEqual(['neck', 'waist'])
    expect(navyCircKeysFor('female')).toEqual(['neck', 'waist', 'hip'])
  })

  it('pairs length unit with weight unit', () => {
    expect(lengthUnitFor('lb')).toBe('in')
    expect(lengthUnitFor('kg')).toBe('cm')
  })

  // Male inch formula: neck 16, waist 36, height 70 → known ~18.x%
  it('matches male inch Hodgdon–Beckett arithmetic', () => {
    const pct = navyBodyFatPct({ neck: 16, waist: 36 }, 70, 'male', 'in')
    const expected = 86.010 * Math.log10(20) - 70.041 * Math.log10(70) + 36.76
    expect(pct).toBe(Math.round(expected * 10) / 10)
    expect(pct).toBeGreaterThan(15)
    expect(pct).toBeLessThan(25)
  })

  it('accepts cm inputs by converting to inches', () => {
    const fromIn = navyBodyFatPct({ neck: 15, waist: 34 }, 69, 'male', 'in')
    const fromCm = navyBodyFatPct(
      { neck: toInches(15, 'in') * 2.54, waist: toInches(34, 'in') * 2.54 },
      69 * 2.54,
      'male',
      'cm'
    )
    expect(fromCm).toBe(fromIn)
  })

  it('requires hip for women and rejects waist ≤ neck', () => {
    expect(navyBodyFatPct({ neck: 13, waist: 28 }, 64, 'female', 'in')).toBe(null)
    expect(navyBodyFatPct({ neck: 13, waist: 28, hip: 38 }, 64, 'female', 'in')).toBeGreaterThan(10)
    expect(navyBodyFatPct({ neck: 40, waist: 35 }, 70, 'male', 'in')).toBe(null)
  })
})

describe('clampBodyFatPct', () => {
  it('rounds and rejects out of range', () => {
    expect(clampBodyFatPct(18.56)).toBe(18.6)
    expect(clampBodyFatPct(0)).toBe(null)
    expect(clampBodyFatPct(90)).toBe(null)
  })
})
