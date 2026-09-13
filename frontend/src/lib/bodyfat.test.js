import { describe, it, expect } from 'vitest'
import {
  jp3SitesFor, sumSkinfolds, jp3BodyDensity, siriBodyFatPct, jp3BodyFatPct, clampBodyFatPct
} from './bodyfat.js'

describe('Jackson–Pollock 3-site', () => {
  it('picks sex-specific sites', () => {
    expect(jp3SitesFor('male')).toEqual(['chest', 'abdomen', 'thigh'])
    expect(jp3SitesFor('female')).toEqual(['triceps', 'suprailiac', 'thigh'])
    expect(jp3SitesFor(undefined)).toEqual(['chest', 'abdomen', 'thigh'])
  })

  it('sums male sites and rejects missing folds', () => {
    expect(sumSkinfolds({ chest: 12, abdomen: 24, thigh: 18 }, 'male')).toBe(54)
    expect(sumSkinfolds({ chest: 12, abdomen: 24 }, 'male')).toBe(null)
    expect(sumSkinfolds({ chest: 12, abdomen: 0, thigh: 18 }, 'male')).toBe(null)
  })

  // Worked example from common JP3 references: chest 12, abdomen 24, thigh 18, age 35 → ~16.8%
  it('matches the published male worked example (~16.8%)', () => {
    const dens = jp3BodyDensity({ chest: 12, abdomen: 24, thigh: 18 }, 35, 'male')
    expect(dens).toBeCloseTo(1.06039, 4)
    expect(siriBodyFatPct(dens)).toBeCloseTo(16.8, 1)
    expect(jp3BodyFatPct({ chest: 12, abdomen: 24, thigh: 18 }, 35, 'male')).toBe(16.8)
  })

  it('computes a plausible female estimate', () => {
    const pct = jp3BodyFatPct({ triceps: 18, suprailiac: 22, thigh: 28 }, 30, 'female')
    expect(pct).toBeGreaterThan(15)
    expect(pct).toBeLessThan(35)
  })

  it('rejects bad age / clamps percent', () => {
    expect(jp3BodyFatPct({ chest: 12, abdomen: 24, thigh: 18 }, 5, 'male')).toBe(null)
    expect(clampBodyFatPct(18.56)).toBe(18.6)
    expect(clampBodyFatPct(0)).toBe(null)
    expect(clampBodyFatPct(90)).toBe(null)
  })
})
