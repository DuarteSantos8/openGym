import { describe, expect, it } from 'vitest'
import { FATIGUE_STATES, fatigueHalfLifeOf, fatigueOf, strengthOf } from './recovery.js'
import { fatigueStateOf, fatigueRecoveryMs, fmtRecoveryIn, recoveryEtas, fmtRecoveryShort, fmtReadyAt } from './recovery-view.js'
import { MUSCLES, levelsOf } from './muscles.js'

const FATIGUE_BANDS = [
  { at: 0, level: 4 },
  { at: 0.25, level: 2 },
  { at: 0.5, level: 0, exclusive: true },
]
const STRENGTH_BANDS = [
  { at: 0.5, level: 0 },
  { at: 0.625, level: 1 },
  { at: 0.75, level: 2 },
  { at: 0.875, level: 3 },
  { at: 1, level: 4 },
]

describe('production recovery view selectors', () => {
  it('preserves the relative balance scale when no thresholds are supplied', () => {
    const levels = levelsOf({ chest: 10, biceps: 5 })
    expect(levels.chest).toBe(4)
    expect(levels.biceps).toBe(2)
  })

  it('uses the production fatigue selector at both approved boundaries', () => {
    expect(fatigueStateOf(0.2499)).toBe(FATIGUE_STATES.READY)
    expect(fatigueStateOf(0.25)).toBe(FATIGUE_STATES.RECOVERING)
    expect(fatigueStateOf(0.5)).toBe(FATIGUE_STATES.RECOVERING)
    expect(fatigueStateOf(0.5001)).toBe(FATIGUE_STATES.FATIGUED)
  })

  it('renders fatigue bands on a fixed absolute scale rather than relative to the map maximum', () => {
    const levels = levelsOf({
      chest: 0.25,
      biceps: 0.6,
      triceps: 0.1,
    }, FATIGUE_BANDS)
    expect(levels.chest).toBe(2)
    expect(levels.biceps).toBe(0)
    expect(levels.triceps).toBe(4)
  })

  it('renders strength on fixed .5-to-1 bands with full retention at l4', () => {
    const levels = levelsOf({ chest: 0.9, biceps: 1, triceps: 0.5 }, STRENGTH_BANDS)
    expect(levels.chest).toBe(3)
    expect(levels.biceps).toBe(4)
    expect(levels.triceps).toBe(0)
  })

  it('keeps selectors tied to the same render-time clock', () => {
    const now = Date.UTC(2026, 0, 22)
    const workout = { start: now - 15 * 86400000, d: '2026-01-07', entries: [] }
    expect(strengthOf([workout], now).chest).toBe(0.5)
    expect(fatigueOf([workout], now).chest).toBe(0)
    expect(strengthOf([workout], now + 7 * 86400000).chest).toBe(0.5)
  })
})

describe('fatigue recovery forecast', () => {
  it('returns nulls for a ready muscle and only toReady for a recovering one', () => {
    expect(fatigueRecoveryMs(0, 'chest')).toEqual({ toRecoveringMs: null, toReadyMs: null })
    expect(fatigueRecoveryMs(0.24, 'chest')).toEqual({ toRecoveringMs: null, toReadyMs: null })
    const mid = fatigueRecoveryMs(0.4, 'chest')
    expect(mid.toRecoveringMs).toBe(null)
    expect(mid.toReadyMs).toBeGreaterThan(0)
  })

  it('returns both crossings for a fatigued muscle, recovering first', () => {
    const { toRecoveringMs, toReadyMs } = fatigueRecoveryMs(0.6, 'chest')
    expect(toRecoveringMs).toBeGreaterThan(0)
    expect(toReadyMs).toBeGreaterThan(toRecoveringMs)
  })

  it('matches the closed-form crossing: HL * log2(v0 / targetV)', () => {
    const v = 0.6
    const hl = fatigueHalfLifeOf('chest')
    const v0 = -Math.log(1 - v)
    const expected = hl * Math.log2(v0 / -Math.log(1 - 0.5))
    expect(fatigueRecoveryMs(v, 'chest').toRecoveringMs).toBeCloseTo(expected, 6)
  })

  it('gives longer recoveries to 48h legs than to 24h arms at the same value', () => {
    expect(fatigueRecoveryMs(0.6, 'quadriceps').toReadyMs)
      .toBeGreaterThan(fatigueRecoveryMs(0.6, 'biceps').toReadyMs)
  })

  it('formats durations without locale-pack words', () => {
    expect(fmtRecoveryIn(null)).toBe(null)
    expect(fmtRecoveryIn(30 * 60000)).toMatch(/30/)
    expect(fmtRecoveryIn(30 * 3600000)).toMatch(/6|hour/)
  })
})

describe('recovery in hours per muscle', () => {
  const now = Date.parse('2026-11-05T09:00:00')
  it('lists the tired muscles, soonest ready first, with the moment they are ready', () => {
    const etas = recoveryEtas({ chest: 0.7, quadriceps: 0.7, biceps: 0.1, 'front-delts': 0.4 }, now)
    expect(etas.map(e => e.slug)).toEqual(['front-delts', 'chest', 'quadriceps'])
    for (const e of etas) {
      expect(e.ms).toBeCloseTo(fatigueRecoveryMs({ chest: 0.7, quadriceps: 0.7, 'front-delts': 0.4 }[e.slug], e.slug).toReadyMs, 6)
      expect(e.at).toBe(now + e.ms)
    }
    // Lower body has the 48 h half-life, the chest 30 h: same fatigue, later ready.
    expect(etas[2].ms / etas[1].ms).toBeCloseTo(48 / 30, 6)
  })
  it('knows the split shoulder and the lats', () => {
    const etas = recoveryEtas({ 'side-delts': 0.6, 'rear-delts': 0.6, lats: 0.6 }, now)
    expect(etas.map(e => e.slug).sort()).toEqual(['lats', 'rear-delts', 'side-delts'])
    expect(etas.find(e => e.slug === 'lats').ms / etas.find(e => e.slug === 'side-delts').ms).toBeCloseTo(30 / 24, 6)
  })
  it('is empty when everything is rested', () => {
    expect(recoveryEtas({ chest: 0.1, lats: 0 }, now)).toEqual([])
    expect(recoveryEtas(null, now)).toEqual([])
  })
  it('says the wait short and the moment as a weekday and a time', () => {
    expect(fmtRecoveryShort(18 * 3600000)).toMatch(/^~18\s?h/)
    expect(fmtRecoveryShort(30 * 60000)).toMatch(/^~30/)
    expect(fmtRecoveryShort(72 * 3600000)).toMatch(/^~3\s?d/)
    expect(fmtReadyAt(Date.parse('2026-11-05T15:07:00'), now)).toBe('15:00')
    expect(fmtReadyAt(Date.parse('2026-11-06T07:02:00'), now)).toMatch(/^Fri\w* 0?7:00$/)
  })
})
