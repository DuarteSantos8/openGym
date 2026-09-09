import { describe, expect, it } from 'vitest'
import {
  FATIGUE_HALF_LIFE_MS,
  FATIGUE_MIN_SESSIONS,
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
import { EXDB, registerCustom } from './exercises.js'
import { MUSCLES, exerciseMuscleSnapshot, musclesOf } from './muscles.js'
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
const referenceAfter = (reference, stimulus) => Math.min(
  reference,
  reference + (stimulus - reference) / FATIGUE_MIN_SESSIONS,
)

const expectedFatigue = sessions => {
  let reference = FATIGUE_REF_VOLUME
  let normalised = 0
  for (const { stimulus, age = 0 } of sessions) {
    normalised += stimulus / reference * halfLifeDecay(age, FATIGUE_HALF_LIFE_MS)
    reference = referenceAfter(reference, stimulus)
  }
  return 1 - Math.exp(-normalised)
}

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
    expect(fatigueOf(highRep, NOW)[SINGLE_SLUG]).toBeCloseTo(
      1 - Math.exp(-weighted / FATIGUE_REF_VOLUME),
      10,
    )
    expect(fatigueOf(highRep, NOW)[SINGLE_SLUG]).toBeGreaterThan(0.5)
  })

  it('uses a deleted exercise snapshot for the same bounded primary and secondary fatigue', () => {
    const resolved = doneWorkoutAt(WEIGHTED.id, NOW)
    const deleted = {
      ...resolved,
      entries: [{
        ...resolved.entries[0],
        id: 'deleted-weighted-exercise',
        muscleSnapshot: exerciseMuscleSnapshot(WEIGHTED),
      }],
    }

    expect(fatigueOf([deleted], NOW)).toEqual(fatigueOf([resolved], NOW))
    expect(fatigueOf([deleted], NOW)[WEIGHTED_PRIMARY_SLUG]).toBeGreaterThan(0)
    expect(fatigueOf([deleted], NOW)[SECONDARY_SLUG]).toBeGreaterThan(0)
  })

  it('uses a deleted exercise snapshot for strength without changing decay or floor semantics', () => {
    const start = NOW - 15 * DAY
    const resolved = doneWorkoutAt(WEIGHTED.id, start)
    const deleted = {
      ...resolved,
      entries: [{
        ...resolved.entries[0],
        id: 'deleted-weighted-exercise',
        muscleSnapshot: exerciseMuscleSnapshot(WEIGHTED),
      }],
    }
    const untouchedSlug = MUSCLES.find(slug => !WEIGHTED_WEIGHTS[slug])
    const strength = strengthOf([deleted], NOW)

    expect(strength).toEqual(strengthOf([resolved], NOW))
    expect(strength[WEIGHTED_PRIMARY_SLUG]).toBeCloseTo(0.5 ** (1 / 28), 10)
    expect(strength[SECONDARY_SLUG]).toBeCloseTo(0.5 ** (1 / 28), 10)
    expect(strength[untouchedSlug]).toBe(STRENGTH_FLOOR)
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
        expect(fatigue[slug]).toBeCloseTo(
          1 - Math.exp(-V * weight * expectedDecay / FATIGUE_REF_VOLUME),
          10,
        )
      }
      if (age === FATIGUE_HALF_LIFE_MS) {
        expect(fatigue[WEIGHTED_PRIMARY_SLUG]).toBeCloseTo(
          1 - Math.exp(-V * 0.5 / FATIGUE_REF_VOLUME),
          10,
        )
      }
      if (age === FATIGUE_HALF_LIFE_MS / 2) {
        expect(fatigue[WEIGHTED_PRIMARY_SLUG]).toBeCloseTo(
          1 - Math.exp(-V * (0.5 ** 0.5) / FATIGUE_REF_VOLUME),
          10,
        )
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
    const atHalf = [doneWorkoutAt(
      SINGLE.id,
      NOW - FATIGUE_HALF_LIFE_MS * Math.log2(sets * V / rawAt(0.4999)),
      sets,
    )]
    const aboveHalf = [
      doneWorkoutAt(
        SINGLE.id,
        NOW - FATIGUE_HALF_LIFE_MS * Math.log2(sets * V / rawAt(0.5001)),
        sets,
      ),
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


describe('causal fatigue reference', () => {
  const loadedWorkout = (start, weight, count = 8) => workoutAt(
    '1254',
    start,
    Array.from({ length: count }, () => ({ done: true, w: weight, r: 8 })),
  )

  it('scores each session against only the reference left by strictly earlier sessions', () => {
    const old = doneWorkoutAt(SINGLE.id, NOW - DAY)
    const today = doneWorkoutAt(SINGLE.id, NOW)
    const earlierReference = referenceAfter(FATIGUE_REF_VOLUME, V)
    const expected = 1 - Math.exp(-(
      V / FATIGUE_REF_VOLUME * halfLifeDecay(DAY, FATIGUE_HALF_LIFE_MS)
      + V / earlierReference
    ))

    expect(fatigueOf([old, today], NOW)[SINGLE_SLUG]).toBeCloseTo(expected, 10)
    expect(fatigueOf([today], NOW)[SINGLE_SLUG]).toBeCloseTo(
      1 - Math.exp(-V / FATIGUE_REF_VOLUME),
      10,
    )
  })

  it('keeps the 8x100x8 ten-day reproduction non-increasing as sessions leave the scan', () => {
    const base = Date.UTC(2026, 0, 31, 12)
    const workouts = [-20, -10, 0].map(days => loadedWorkout(base + days * DAY, 100))
    const observed = Array.from(
      { length: 31 * 24 + 1 },
      (_, hour) => fatigueOf(workouts, base + hour * HOUR).chest,
    )

    expect(observed[0]).toBeGreaterThan(0.5)
    expect(observed.at(-1)).toBe(0)
    for (let index = 1; index < observed.length; index += 1) {
      expect(observed[index]).toBeLessThanOrEqual(observed[index - 1] + Number.EPSILON)
    }
  })

  it('ignores imports older than the scan, including their heavier 1RM data', () => {
    const today = loadedWorkout(NOW, 100, 5)
    const baseline = fatigueOf([today], NOW).chest
    const heavyImport = loadedWorkout(NOW - 90 * DAY, 140, 10)
    const highVolumeImport = loadedWorkout(NOW - 90 * DAY, 100, 20)

    expect(fatigueOf([heavyImport, today], NOW).chest).toBe(baseline)
    expect(fatigueOf([highVolumeImport, today], NOW).chest).toBe(baseline)
  })

  it('never increases fatigue when any one workout is deleted', () => {
    const workouts = [
      loadedWorkout(NOW - 40 * DAY, 100, 15),
      loadedWorkout(NOW - 3 * DAY, 100, 8),
      loadedWorkout(NOW - 2 * DAY, 100, 8),
      loadedWorkout(NOW - DAY, 60, 4),
      loadedWorkout(NOW, 120, 10),
    ]
    const before = fatigueOf(workouts, NOW)

    workouts.forEach((_, deletedIndex) => {
      const after = fatigueOf(workouts.filter((__, index) => index !== deletedIndex), NOW)
      for (const slug of MUSCLES) expect(after[slug]).toBeLessThanOrEqual(before[slug] + Number.EPSILON)
    })
  })

  it('rates a lighter current week below repeating the established load', () => {
    const prior = [-21, -14, -7].map(days => loadedWorkout(NOW + days * DAY, 100))
    const lighter = fatigueOf([...prior, loadedWorkout(NOW, 50)], NOW).chest
    const repeated = fatigueOf([...prior, loadedWorkout(NOW, 100)], NOW).chest

    expect(lighter).toBeLessThan(repeated)
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
    const firstAge = ages[0]
    const secondAge = ages[1]
    const expected = expectedFatigue([
      { stimulus: V, age: firstAge },
      { stimulus: V, age: secondAge },
    ])

    expect(raw).toBeLessThan(FATIGUE_REF_VOLUME)
    expect(fatigueOf(workouts, NOW)[SINGLE_SLUG]).toBeCloseTo(expected, 10)
    expect(fatigueOf([...workouts].reverse(), NOW)[SINGLE_SLUG]).toBeCloseTo(expected, 10)
  })

  it('saturates without pinning and returns identical results without mutating inputs or sharing state', () => {
    const saturated = [doneWorkoutAt(SINGLE.id, NOW, 2)]
    expect(fatigueOf(saturated, NOW)[SINGLE_SLUG]).toBeCloseTo(
      1 - Math.exp(-2 * V / FATIGUE_REF_VOLUME),
      10,
    )
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

describe('drop-set drops add fatigue tonnage on top of the main set', () => {
  // Same within-session Epley baseline setTonnage derives from the row's own w/r (8 reps,
  // under REP_CAP), so a drop is weighted against the same 1RM as the main set.
  const oneRm = 80 * (1 + 8 / 30)

  it('a drop-set drop adds its own intensity-weighted tonnage', () => {
    const dropRow = { done: true, type: 'dropset', w: 80, r: 8, drops: [{ w: 60, r: 6 }] }
    const dropTonnage = 60 * 6 * Math.min(1, 60 / oneRm) ** 1.5
    const expected = expectedFatigue([{ stimulus: V + dropTonnage }])

    expect(fatigueOf([workoutAt(SINGLE.id, NOW, [dropRow])], NOW)[SINGLE_SLUG]).toBeCloseTo(expected, 8)
    // strictly more than the plain 80x8 set alone — the drop is real extra work
    expect(fatigueOf([workoutAt(SINGLE.id, NOW, [dropRow])], NOW)[SINGLE_SLUG])
      .toBeGreaterThan(fatigueOf([doneWorkoutAt(SINGLE.id, NOW)], NOW)[SINGLE_SLUG])
  })

  it('leaves fatigue unchanged for a straight set with no drops', () => {
    const plain = { done: true, w: 80, r: 8 }
    expect(fatigueOf([workoutAt(SINGLE.id, NOW, [plain])], NOW)[SINGLE_SLUG])
      .toBeCloseTo(expectedFatigue([{ stimulus: V }]), 8)
  })
})

describe('a rest-pause row\'s clusters add no extra fatigue tonnage', () => {
  // Its own r is already the total across every burst (see applyIntensifierPlan/history.js),
  // so setTonnage's main w x r term already covers all of it — clusters are a breakdown only.
  it('matches a plain set of the same w/r exactly, regardless of how the clusters break it down', () => {
    const burstRow = { done: true, type: 'restpause', w: 80, r: 8, clusters: [{ r: 4, restSec: 15 }] }
    const plainRow = { done: true, w: 80, r: 8 }
    expect(fatigueOf([workoutAt(SINGLE.id, NOW, [burstRow])], NOW)[SINGLE_SLUG])
      .toBeCloseTo(fatigueOf([workoutAt(SINGLE.id, NOW, [plainRow])], NOW)[SINGLE_SLUG], 10)
  })

  it('holds for a realistic planned total too — a full descending split adds nothing beyond the row\'s own r', () => {
    const burstRow = { done: true, type: 'restpause', w: 80, r: 20, clusters: [{ r: 10, restSec: 15 }, { r: 5, restSec: 15 }, { r: 3, restSec: 15 }, { r: 1, restSec: 15 }, { r: 1, restSec: 15 }] }
    const plainRow = { done: true, w: 80, r: 20 }
    expect(fatigueOf([workoutAt(SINGLE.id, NOW, [burstRow])], NOW)[SINGLE_SLUG])
      .toBeCloseTo(fatigueOf([workoutAt(SINGLE.id, NOW, [plainRow])], NOW)[SINGLE_SLUG], 10)
  })
})

describe('canonical loads and configured bodyweight', () => {
  const loaded = EXDB.find(ex => {
    const weights = musclesOf(ex)
    return ex.bp !== 'cardio' && ex.eq !== 'body weight'
      && Object.keys(weights).length === 1 && Object.values(weights)[0] === 1
  })
  const bodyweight = EXDB.find(ex => ex.bp !== 'cardio' && ex.eq === 'body weight')
  if (!loaded || !bodyweight) throw new Error('recovery tests require loaded and bodyweight fixtures')
  const loadedSlug = Object.keys(musclesOf(loaded))[0]
  const bodyweightSlug = Object.keys(musclesOf(bodyweight))[0]
  const stampedWorkout = ({ id, start, unit, weight, target, bw }) => ({
    d: new Date(start).toISOString(), start, unit, bw,
    entries: [{ id, target, sets: [{ done: true, w: weight, r: 8 }] }],
  })

  it('gives kg and physically equivalent stamped-pound histories the same fatigue', () => {
    const kg = stampedWorkout({ id: loaded.id, start: NOW, unit: 'kg', weight: 80 })
    const lb = stampedWorkout({ id: loaded.id, start: NOW, unit: 'lb', weight: 176.3696 })

    expect(fatigueOf([lb], NOW, { unit: 'kg' })[loadedSlug])
      .toBeCloseTo(fatigueOf([kg], NOW, { unit: 'kg' })[loadedSlug], 6)
  })

  it('normalizes mixed stamped units before computing the causal reference volume', () => {
    const starts = [NOW - 3 * DAY, NOW - 2 * DAY, NOW - DAY, NOW]
    const kg = starts.map(start => stampedWorkout({ id: loaded.id, start, unit: 'kg', weight: 80 }))
    const mixed = starts.map((start, i) => stampedWorkout({
      id: loaded.id, start, unit: i % 2 ? 'lb' : 'kg', weight: i % 2 ? 176.3696 : 80,
    }))

    expect(fatigueOf(mixed, NOW, { unit: 'kg' })[loadedSlug])
      .toBeCloseTo(fatigueOf(kg, NOW, { unit: 'kg' })[loadedSlug], 6)
  })

  it('treats an unstamped legacy history as being in the profile unit', () => {
    const kg = stampedWorkout({ id: loaded.id, start: NOW, unit: 'kg', weight: 80 })
    const legacyLb = { ...kg, unit: undefined, entries: [{ ...kg.entries[0], sets: [{ done: true, w: 176.3696, r: 8 }] }] }

    expect(fatigueOf([legacyLb], NOW, { unit: 'lb' })[loadedSlug])
      .toBeCloseTo(fatigueOf([kg], NOW, { unit: 'kg' })[loadedSlug], 6)
  })

  it('uses configured bodyweight for a non-catalogue bodyweight target', () => {
    const workout = stampedWorkout({
      id: loaded.id, start: NOW, unit: 'kg', weight: 0,
      target: { bodyweight: true }, bw: 80,
    })

    expect(fatigueOf([workout], NOW, { unit: 'kg' })[loadedSlug]).toBeGreaterThan(0)
    expect(strengthOf([workout], NOW, { unit: 'kg' })[loadedSlug]).toBe(1)
  })

  it('adds external load to bodyweight instead of replacing the body mass', () => {
    const unloaded = stampedWorkout({ id: bodyweight.id, start: NOW, unit: 'kg', weight: 0, bw: 80 })
    const loadedSet = { done: true, w: 10, r: 8 }
    const added = { ...unloaded, entries: [{ ...unloaded.entries[0], sets: [loadedSet] }] }

    expect(fatigueOf([added], NOW, { unit: 'kg' })[bodyweightSlug])
      .toBeGreaterThan(fatigueOf([unloaded], NOW, { unit: 'kg' })[bodyweightSlug])
  })

  it('lets explicitly configured custom bodyweight work reset strength', () => {
    const id = 'recovery-custom-bodyweight'
    registerCustom([{ id, n: 'Custom bodyweight', bp: 'chest', tg: 'chest', eq: 'custom', sm: [] }])
    try {
      const workout = stampedWorkout({ id, start: NOW, unit: 'kg', weight: 0, bw: 80, target: { bodyweight: true } })
      expect(fatigueOf([workout], NOW, { unit: 'kg' }).chest).toBeGreaterThan(0)
      expect(strengthOf([workout], NOW, { unit: 'kg' }).chest).toBe(1)
    } finally {
      registerCustom([])
    }
  })

  it('treats a future-dated workout as its own timestamp, never amplified', () => {
    // A CSV import with a bad timezone can date a workout 10 days in the future. The final
    // decay clamps the age to zero instead of exponentiating, so the session counts exactly
    // like the same workout dated now - no 2^(10d/36h) ~ 102x amplification.
    const future = doneWorkoutAt(SINGLE.id, NOW + 10 * DAY, 5)
    const now = doneWorkoutAt(SINGLE.id, NOW, 5)
    const futureValue = fatigueOf([future], NOW)[SINGLE_SLUG]
    const nowValue = fatigueOf([now], NOW)[SINGLE_SLUG]
    expect(futureValue).toBeCloseTo(nowValue, 10)
    expect(futureValue).toBeLessThan(1)
  })

  it('counts a default custom zero-load ring push-up for fatigue and load-blind strength', () => {
    const id = 'recovery-ring-push-up'
    registerCustom([{ id, n: 'Ring push-up', bp: 'chest', tg: 'chest', eq: 'custom', sm: [] }])
    try {
      const workout = workoutAt(id, NOW, [
        { done: true, w: 0, r: 20 },
        { done: true, w: 0, r: 20 },
      ])
      expect(fatigueOf([workout], NOW).chest).toBeCloseTo(1 - Math.exp(-2 / 3), 10)
      expect(strengthOf([workout], NOW).chest).toBe(1)
    } finally {
      registerCustom([])
    }
  })
})
