import { describe, it, expect } from 'vitest'
import {
  jp3SitesFor, navyCircKeysFor, sumSkinfolds, jp3BodyDensity, siriBodyFatPct, jp3BodyFatPct,
  navyBodyFatPct, clampBodyFatPct, toInches, lengthUnitFor, formatFtIn, clampHeightInches,
  bodyFatMethodLabel, leanMassFromWeight, estimateBodyFatAtWeight
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

  // Female equation check against the closed-form sum (triceps 18 + suprailiac 22 + thigh 28, age 30)
  it('matches female JP3 closed-form arithmetic', () => {
    const sites = { triceps: 18, suprailiac: 22, thigh: 28 }
    const age = 30
    const S = 68
    const dens = 1.0994921 - 0.0009929 * S + 0.0000023 * S * S - 0.0001392 * age
    expect(jp3BodyDensity(sites, age, 'female')).toBeCloseTo(dens, 8)
    expect(jp3BodyFatPct(sites, age, 'female')).toBe(clampBodyFatPct(495 / dens - 450))
  })

  it('rejects bad age', () => {
    expect(jp3BodyFatPct({ chest: 12, abdomen: 24, thigh: 18 }, 5, 'male')).toBe(null)
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

  it('matches male inch Hodgdon–Beckett arithmetic', () => {
    const pct = navyBodyFatPct({ neck: 16, waist: 36 }, 70, 'male', 'in')
    const expected = 86.010 * Math.log10(20) - 70.041 * Math.log10(70) + 36.76
    expect(pct).toBe(Math.round(expected * 10) / 10)
    expect(pct).toBeGreaterThan(15)
    expect(pct).toBeLessThan(25)
  })

  it('matches female inch Hodgdon–Beckett arithmetic', () => {
    const circ = { neck: 13, waist: 28, hip: 38 }
    const height = 64
    const expected = 163.205 * Math.log10(28 + 38 - 13) - 97.684 * Math.log10(64) - 78.387
    expect(navyBodyFatPct(circ, height, 'female', 'in')).toBe(Math.round(expected * 10) / 10)
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

describe('height feet-inches', () => {
  it('formats and steps whole inches', () => {
    expect(formatFtIn(69)).toBe("5'9\"")
    expect(formatFtIn(72)).toBe("6'0\"")
    expect(clampHeightInches(69.4)).toBe(69)
    expect(clampHeightInches(47)).toBe(48)
  })
})

describe('bodyFatMethodLabel', () => {
  it('names each saved method', () => {
    expect(bodyFatMethodLabel('jp3')).toBe('Caliper')
    expect(bodyFatMethodLabel('navy')).toBe('Tape')
    expect(bodyFatMethodLabel('manual')).toBe('Manual')
    expect(bodyFatMethodLabel('estimate')).toBe('Est.')
    expect(bodyFatMethodLabel('estimated')).toBe('Est.')
    expect(bodyFatMethodLabel('')).toBe('')
  })
})

describe('lean-mass hold estimates', () => {
  // Anchor from a real Navy log: 28.2% @ 208.6 lb → lean ≈ 149.77 lb
  it('recovers lean mass and back-solves BF% at another weight', () => {
    const lean = leanMassFromWeight(208.6, 28.2)
    expect(lean).toBeCloseTo(208.6 * (1 - 0.282), 6)
    expect(estimateBodyFatAtWeight(208.6, lean)).toBe(28.2)
    expect(estimateBodyFatAtWeight(222, lean)).toBe(32.5)
    expect(estimateBodyFatAtWeight(207.4, lean)).toBe(27.8)
  })

  it('rejects impossible inputs', () => {
    expect(leanMassFromWeight(0, 20)).toBe(null)
    expect(leanMassFromWeight(200, 0)).toBe(null)
    expect(estimateBodyFatAtWeight(150, 160)).toBe(null)
    expect(estimateBodyFatAtWeight(0, 100)).toBe(null)
  })
})
