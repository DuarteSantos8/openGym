import { describe, expect, it } from 'vitest'
import {
  FATIGUE_HALF_LIFE_MS,
  FATIGUE_REF_VOLUME,
  FATIGUE_SCAN_MS,
  FATIGUE_STATES,
  BODYWEIGHT_REF_LOAD,
  CARDIO_TONNAGE_PER_MIN,
  STRENGTH_FLOOR,
  STRENGTH_FULL_MS,
  STRENGTH_HALF_LIFE_MS,
  detrainedMuscles,
  fatiguedMuscles,
  fatigueOf,
  halfLifeDecay,
  strengthOf,
} from './recovery.js'
import { EXDB } from './exercises.js'
import { MUSCLES, musclesOf } from './muscles.js'
import { fatigueStateOf } from './recovery-view.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const NOW = Date.UTC(2026, 0, 1, 12)

// Keep fixtures tied to the shipped catalogue while making the expected stimulus explicit.
const SINGLE = EXDB.find(ex => {
  const weights = musclesOf(ex)
  return ex.bp !== 'cardio' && Object.keys(weights).length === 1 && Object.values(weights)[0] === 1
})
const WEIGHTED = EXDB.find(ex => {
  const weights = musclesOf(ex)
  return ex.bp !== 'cardio' && Object.values(weights).includes(0.4)
})
if (!SINGLE || !WEIGHTED) throw new Error('recovery tests require single- and secondary-weight fixtures')

const SINGLE_WEIGHTS = musclesOf(SINGLE)
const WEIGHTED_WEIGHTS = musclesOf(WEIGHTED)
const SINGLE_SLUG = Object.keys(SINGLE_WEIGHTS)[0]
const WEIGHTED_PRIMARY_SLUG = Object.keys(WEIGHTED_WEIGHTS).find(slug => WEIGHTED_WEIGHTS[slug] === 1)
const SECONDARY_SLUG = Object.keys(WEIGHTED_WEIGHTS).find(slug => WEIGHTED_WEIGHTS[slug] === 0.4)
if (!WEIGHTED_PRIMARY_SLUG || !SECONDARY_SLUG) throw new Error('recovery tests require weighted primary and secondary fixtures')

const workoutAt = (id, start, sets = [{ done: true }]) => ({
  d: new Date(start).toISOString(),
  start,
  entries: [{ id, sets: sets.map(set => ({ ...set })) }],
})
const V = 640 * (30 / 38) ** 1.5  // intensity-weighted tonnage of one 80x8 fixture set (its own Epley estimate implies intensity 30/38)

const doneWorkoutAt = (id, start, count = 1) =>
  workoutAt(id, start, Array.from({ length: count }, () => ({ done: true, w: 80, r: 8 })))
const zeroFatigue = () => Object.fromEntries(MUSCLES.map(slug => [slug, 0]))
const floorStrength = () => Object.fromEntries(MUSCLES.map(slug => [slug, STRENGTH_FLOOR]))

// Numeric fatigue remains the math API; the UI boundary selector is imported from production.
const stableFloat = value => Number(value.toFixed(12))

describe('recovery constants', () => {
  it('exports the pinned windows, half-lives, floor, and state labels', () => {
    expect(FATIGUE_REF_VOLUME).toBe(2000)
    expect(FATIGUE_SCAN_MS).toBe(30 * DAY)
    expect(FATIGUE_HALF_LIFE_MS).toBe(36 * HOUR)
    expect(BODYWEIGHT_REF_LOAD).toBe(75)
    expect(CARDIO_TONNAGE_PER_MIN).toBe(50)
    expect(STRENGTH_FULL_MS).toBe(14 * DAY)
    expect(STRENGTH_HALF_LIFE_MS).toBe(28 * DAY)
    expect(STRENGTH_FLOOR).toBe(0.5)
    expect(FATIGUE_STATES).toEqual({ READY: 'ready', RECOVERING: 'recovering', FATIGUED: 'fatigued' })
    expect(halfLifeDecay(FATIGUE_HALF_LIFE_MS, FATIGUE_HALF_LIFE_MS)).toBe(0.5)
  })
})

describe('fatigueOf and strengthOf', () => {
  it('returns every muscle, ready/floor defaults, and hook defaults for empty history', () => {
    const fatigue = fatigueOf([], NOW)
    const strength = strengthOf([], NOW)

    expect(Object.keys(fatigue)).toEqual(MUSCLES)
    expect(fatigue).toEqual(zeroFatigue())
    expect(Object.values(fatigue).map(fatigueStateOf)).toEqual(
      MUSCLES.map(() => FATIGUE_STATES.READY),
    )
    expect(Object.keys(strength)).toEqual(MUSCLES)
    expect(strength).toEqual(floorStrength())
    expect(fatiguedMuscles([], NOW)).toEqual([])
    expect(detrainedMuscles([], NOW)).toEqual(MUSCLES)
  })

  it('applies one completed set to each of the exercise muscle weights', () => {
    const workouts = [doneWorkoutAt(WEIGHTED.id, NOW)]
    const fatigue = fatigueOf(workouts, NOW)
    const strength = strengthOf(workouts, NOW)

    for (const slug of MUSCLES) {
      const weight = WEIGHTED_WEIGHTS[slug] || 0
      expect(fatigue[slug]).toBeCloseTo(1 - Math.exp(-V * weight / FATIGUE_REF_VOLUME), 10)
      expect(strength[slug]).toBe(weight ? 1 : STRENGTH_FLOOR)
    }
    // one set (80 x 8) never crosses the fatigued threshold on the saturating curve
    expect(fatiguedMuscles(workouts, NOW)).toEqual([])

    // pure volume: one high-rep set at medium weight registers real tonnage (weighted by
    // its intensity - its own Epley estimate with the 12-rep cap is 50 x 40/30 = 70 kg)
    const highRep = [doneWorkoutAt(SINGLE.id, NOW, 1)]
    highRep[0].entries[0].sets[0].w = 50
    highRep[0].entries[0].sets[0].r = 50
    const weighted = 2500 * (50 / (50 * (1 + 12 / 30))) ** 1.5
    expect(fatigueOf(highRep, NOW)[SINGLE_SLUG]).toBeCloseTo(1 - Math.exp(-weighted / FATIGUE_REF_VOLUME), 10)
    expect(fatigueOf(highRep, NOW)[SINGLE_SLUG]).toBeGreaterThan(0.5)
  })

  it('raises starting fatigue with volume, never pins, and fades without a cliff', () => {
    const at0 = count => fatigueOf([doneWorkoutAt(SINGLE.id, NOW, count)], NOW)[SINGLE_SLUG]
    expect(at0(1)).toBeCloseTo(1 - Math.exp(-V / FATIGUE_REF_VOLUME), 10)
    expect(at0(5)).toBeCloseTo(1 - Math.exp(-5 * V / FATIGUE_REF_VOLUME), 10)
    expect(at0(12)).toBeCloseTo(1 - Math.exp(-12 * V / FATIGUE_REF_VOLUME), 10)
    expect(at0(12)).toBeGreaterThan(at0(5))
    expect(at0(5)).toBeGreaterThan(at0(1))
    expect(at0(12)).toBeLessThan(1)
    // one half-life later the gradient is still visible at any volume
    const later = fatigueOf([doneWorkoutAt(SINGLE.id, NOW - FATIGUE_HALF_LIFE_MS, 12)], NOW)[SINGLE_SLUG]
    expect(later).toBeCloseTo(1 - Math.exp(-6 * V / FATIGUE_REF_VOLUME), 10)
    expect(later).toBeLessThan(at0(12))
    // no cliff: 72h keeps decaying instead of snapping to zero
    const old = fatigueOf([doneWorkoutAt(SINGLE.id, NOW - 72 * HOUR)], NOW)[SINGLE_SLUG]
    expect(old).toBeGreaterThan(0)
    expect(old).toBeLessThan(0.25)
  })

  it('decays each weighted stimulus exactly at 36 hours and by sqrt-half at 18 hours', () => {
    for (const age of [FATIGUE_HALF_LIFE_MS, FATIGUE_HALF_LIFE_MS / 2]) {
      const fatigue = fatigueOf([doneWorkoutAt(WEIGHTED.id, NOW - age)], NOW)
      const expectedDecay = 0.5 ** (age / FATIGUE_HALF_LIFE_MS)
      for (const [slug, weight] of Object.entries(WEIGHTED_WEIGHTS)) {
        expect(fatigue[slug]).toBeCloseTo(1 - Math.exp(-V * weight * expectedDecay / FATIGUE_REF_VOLUME), 10)
      }
      if (age === FATIGUE_HALF_LIFE_MS) {
        expect(fatigue[WEIGHTED_PRIMARY_SLUG]).toBeCloseTo(1 - Math.exp(-V * 0.5 / FATIGUE_REF_VOLUME), 10)
      }
      if (age === FATIGUE_HALF_LIFE_MS / 2) {
        expect(fatigue[WEIGHTED_PRIMARY_SLUG]).toBeCloseTo(1 - Math.exp(-V * (0.5 ** 0.5) / FATIGUE_REF_VOLUME), 10)
      }
    }
  })

  it('fades a 72-hour-old set below the ready threshold instead of hard-cutting', () => {
    const workouts = [doneWorkoutAt(SINGLE.id, NOW - 72 * HOUR)]
    const value = fatigueOf(workouts, NOW)[SINGLE_SLUG]
    expect(value).toBeGreaterThan(0)
    expect(value).toBeLessThan(0.25)
    expect(fatigueStateOf(value)).toBe(FATIGUE_STATES.READY)
    expect(strengthOf(workouts, NOW)[SINGLE_SLUG]).toBe(1)
  })

  it('ignores sets whose done flag is false for both axes', () => {
    const workouts = [workoutAt(WEIGHTED.id, NOW, [{ done: false }])]
    expect(fatigueOf(workouts, NOW)).toEqual(zeroFatigue())
    expect(strengthOf(workouts, NOW)).toEqual(floorStrength())
    expect(fatiguedMuscles(workouts, NOW)).toEqual([])
    expect(detrainedMuscles(workouts, NOW)).toEqual(MUSCLES)
  })
})

describe('fatigue state boundaries', () => {
  // Inverse of the saturation curve: raw stimulus needed to land exactly on a target level.
  const rawAt = target => -FATIGUE_REF_VOLUME * Math.log(1 - target)
  const RAW0 = 4 * V  // four 80x8 sets, primary weight 1

  it('classifies exactly .25 as recovering and .2499 as ready', () => {
    const weight = WEIGHTED_WEIGHTS[SECONDARY_SLUG]
    const sets = 4
    const valueAt = target => {
      const age = FATIGUE_HALF_LIFE_MS * Math.log2(sets * V * weight / rawAt(target))
      const value = fatigueOf([doneWorkoutAt(WEIGHTED.id, NOW - age, sets)], NOW)[SECONDARY_SLUG]
      expect(value).toBeCloseTo(target, 10)
      return stableFloat(value)
    }

    expect(fatigueStateOf(valueAt(0.25))).toBe(FATIGUE_STATES.RECOVERING)
    expect(fatigueStateOf(valueAt(0.2499))).toBe(FATIGUE_STATES.READY)
  })

  it('classifies exactly .5 as recovering, .5001 as fatigued, and hooks only fatigued muscles', () => {
    const sets = 4
    const atHalf = [doneWorkoutAt(SINGLE.id, NOW - FATIGUE_HALF_LIFE_MS * Math.log2(sets * V / rawAt(0.4999)), sets)]
    const aboveHalf = [
      doneWorkoutAt(SINGLE.id, NOW - FATIGUE_HALF_LIFE_MS * Math.log2(sets * V / rawAt(0.5001)), sets),
    ]
    const half = fatigueOf(atHalf, NOW)[SINGLE_SLUG]
    const above = fatigueOf(aboveHalf, NOW)[SINGLE_SLUG]

    expect(half).toBeCloseTo(0.4999, 10)
    expect(fatigueStateOf(stableFloat(half))).toBe(FATIGUE_STATES.RECOVERING)
    expect(fatiguedMuscles(atHalf, NOW)).toEqual([])
    expect(above).toBeCloseTo(0.5001, 10)
    expect(fatigueStateOf(stableFloat(above))).toBe(FATIGUE_STATES.FATIGUED)
    expect(fatiguedMuscles(aboveHalf, NOW)).toEqual([SINGLE_SLUG])
  })
})


describe('personalised fatigue reference', () => {
  it('uses the user\'s own average session tonnage once three sessions exist', () => {
    // Three prior sessions of one 80x8 set (640 kg) at 20-28 days old: within the scan
    // window for the reference, but their decayed contribution to today\'s value is ~0.
    const norm = [20, 24, 28].map(days => doneWorkoutAt(SINGLE.id, NOW - days * DAY))
    const today = doneWorkoutAt(SINGLE.id, NOW)
    // REF = mean(640, 640, 640, 640) = 640, so today\'s session lands at 1 - e^-1 (the old
    // sessions contribute only ~1e-4 of decayed tonnage, safely inside the tolerance).
    expect(fatigueOf([...norm, today], NOW)[SINGLE_SLUG]).toBeCloseTo(1 - Math.exp(-1), 4)
    // A five-set day raises its own reference too: mean(4 x 640, 3200) = 1280, so the
    // five-set day lands at 1 - e^-2.5 - far harder than the default curve would show.
    const heavy = doneWorkoutAt(SINGLE.id, NOW, 5)
    expect(fatigueOf([...norm, heavy], NOW)[SINGLE_SLUG]).toBeCloseTo(1 - Math.exp(-2.5), 4)
  })

  it('keeps the default reference until three sessions exist', () => {
    // One prior session plus today = two total, so the reference stays at the default 3000.
    const one = [doneWorkoutAt(SINGLE.id, NOW - 3 * DAY)]
    const today = doneWorkoutAt(SINGLE.id, NOW)
    const decayed = V * (1 + 0.5 ** (3 * DAY / FATIGUE_HALF_LIFE_MS))
    expect(fatigueOf([...one, today], NOW)[SINGLE_SLUG]).toBeCloseTo(
      1 - Math.exp(-decayed / FATIGUE_REF_VOLUME),
      10,
    )
  })

  it('uses the last registered bodyweight for bodyweight exercises', () => {
    const bwEx = EXDB.find(ex => ex.eq === 'body weight' && ex.bp !== 'cardio')
    if (!bwEx) throw new Error('test requires a bodyweight exercise fixture')
    const slug = Object.keys(musclesOf(bwEx))[0]
    const workout = { d: new Date(NOW).toISOString(), start: NOW, entries: [{ id: bwEx.id, sets: [{ done: true, r: 10 }] }] }
    const at80 = fatigueOf([workout], NOW, { bodyweightKg: 80 })[slug]
    const at90 = fatigueOf([workout], NOW, { bodyweightKg: 90 })[slug]
    expect(at80).toBeCloseTo(1 - Math.exp(-800 / FATIGUE_REF_VOLUME), 10)
    expect(at90).toBeCloseTo(1 - Math.exp(-900 / FATIGUE_REF_VOLUME), 10)
    expect(at90).toBeGreaterThan(at80)
  })
})

describe('strengthOf', () => {
  const strengthAt = age => strengthOf([doneWorkoutAt(SINGLE.id, NOW - age)], NOW)[SINGLE_SLUG]

  it('stays at full retention through 14 days and decays from 15 days by the 28-day half-life', () => {
    expect(strengthAt(STRENGTH_FULL_MS)).toBe(1)
    expect(strengthAt(15 * DAY)).toBeCloseTo(0.5 ** (1 / 28), 10)
  })

  it('clamps the 42-day half-life point and later 56-day value at the .5 floor', () => {
    expect(strengthAt(42 * DAY)).toBe(0.5)
    expect(strengthAt(56 * DAY)).toBe(STRENGTH_FLOOR)
  })

  it('resets retained strength when a later completed session retrains the muscle', () => {
    const workouts = [
      doneWorkoutAt(SINGLE.id, NOW - 20 * DAY),
      doneWorkoutAt(SINGLE.id, NOW),
    ]
    expect(strengthOf(workouts, NOW)[SINGLE_SLUG]).toBe(1)
  })
})

describe('accumulation and purity', () => {
  it('matches the saturated sum of independently decayed stimuli in chronological order', () => {
    const ages = [64 * HOUR, 40 * HOUR]
    const workouts = ages.map(age => doneWorkoutAt(SINGLE.id, NOW - age))
    const raw = ages.reduce(
      (sum, age) => sum + V * 0.5 ** (age / FATIGUE_HALF_LIFE_MS),
      0,
    )
    const expected = 1 - Math.exp(-raw / FATIGUE_REF_VOLUME)

    expect(raw).toBeLessThan(FATIGUE_REF_VOLUME)
    expect(fatigueOf(workouts, NOW)[SINGLE_SLUG]).toBeCloseTo(expected, 10)
    expect(fatigueOf([...workouts].reverse(), NOW)[SINGLE_SLUG]).toBeCloseTo(expected, 10)
  })

  it('saturates without pinning and returns identical results without mutating inputs or sharing state', () => {
    const saturated = [doneWorkoutAt(SINGLE.id, NOW, 2)]
    expect(fatigueOf(saturated, NOW)[SINGLE_SLUG]).toBeCloseTo(1 - Math.exp(-2 * V / FATIGUE_REF_VOLUME), 10)
    expect(fatigueOf(saturated, NOW)[SINGLE_SLUG]).toBeLessThan(1)

    const workouts = [
      doneWorkoutAt(SINGLE.id, NOW - 64 * HOUR),
      doneWorkoutAt(SINGLE.id, NOW - 40 * HOUR),
    ]
    const before = JSON.parse(JSON.stringify(workouts))
    const firstFatigue = fatigueOf(workouts, NOW)
    const firstStrength = strengthOf(workouts, NOW)
    const secondFatigue = fatigueOf(workouts, NOW)
    const secondStrength = strengthOf(workouts, NOW)

    expect(secondFatigue).toEqual(firstFatigue)
    expect(secondStrength).toEqual(firstStrength)
    expect(workouts).toEqual(before)
  })
})


describe('warm-up flag in strength and fatigue', () => {
  it('a warm-up set does not reset strength but still adds fatigue volume', () => {
    const now = Date.UTC(2026, 7, 1, 12)
    const oldWork = { id: 'w1', d: '2026-07-10', start: now - 20 * 86400000, unit: 'kg',
      entries: [{ id: '1254', sets: [{ done: true, w: 80, r: 8 }] }] }
    const warm = { id: 'w2', d: '2026-08-01', start: now - 3600000, unit: 'kg',
      entries: [{ id: '1254', sets: [{ done: true, warmup: true, w: 20, r: 8 }] }] }
    const workouts = [oldWork, warm]
    const strength = strengthOf(workouts, now)
    // the strength edge is 20 days old: the fresh warm-up must NOT be the latest training event
    expect(strength.chest).toBeLessThan(1)
    // but the warm-up still contributes to the fatigue stimulus (real mechanical work)
    const fatigue = fatigueOf(workouts, now)
    expect(fatigue.chest).toBeGreaterThan(0)
  })
})
