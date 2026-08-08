import { describe, expect, it } from 'vitest'
import {
  PHASES,
  TARGET_KINDS,
  normalizePhase,
  isWarmupRow,
  normalizeTarget,
  normalizePlannedSet,
  normalizeLoggedSet,
  normalizeEntry,
  modeForSet,
  modeForEntry,
  isProgressionEligible,
  is1RMEligible,
  setVolume,
  historyUnitFor,
  historyUnitCompatible,
  cachedWeightFor,
  weightCacheEntry,
  entryVolume,
  workoutVolumeFromEntries,
  stampCompletedWorkout
} from './workout-model.js'

describe('phase and target constants', () => {
  it('exposes the only normalized phase and target values', () => {
    expect(PHASES).toEqual(['warmup', 'work'])
    expect(TARGET_KINDS).toEqual(['fixed', 'amrap'])
  })
})

describe('normalizePhase', () => {
  it('keeps an explicit phase identity', () => {
    expect(normalizePhase('warmup')).toBe('warmup')
    expect(normalizePhase('work')).toBe('work')
  })

  it('uses work as the safe legacy default and never infers warm-up from position', () => {
    expect(normalizePhase(undefined)).toBe('work')
    expect(normalizePhase(null)).toBe('work')
    expect(normalizePhase('warm-up')).toBe('warmup')
    expect(normalizePhase('not-a-phase')).toBe('work')
  })

  it('resolves phase-tagged and legacy boolean warm-ups without letting a stale flag win', () => {
    expect(isWarmupRow({ warmup: true })).toBe(true)
    expect(isWarmupRow({ phase: 'warmup' })).toBe(true)
    expect(isWarmupRow({ phase: 'warm-up' })).toBe(true)
    expect(isWarmupRow({ phase: 'work', warmup: true })).toBe(false)
  })
})

describe('normalizeTarget', () => {
  it('normalizes a legacy fixed repetition target with serializable defaults', () => {
    expect(normalizeTarget({ sets: 3, reps: 5, weight: 60 })).toEqual({
      phase: 'work', mode: 'reps', kind: 'fixed', sets: 3,
      reps: 5, sec: null, weight: 60
    })
  })

  it('normalizes a fixed time target without inventing a rep target', () => {
    expect(normalizeTarget({ phase: 'warmup', mode: 'time', sets: 2, sec: 30, weight: 10 })).toEqual({
      phase: 'warmup', mode: 'time', kind: 'fixed', sets: 2,
      reps: null, sec: 30, weight: 10
    })
  })

  it('represents a repetition AMRAP target with a minimum and never a rep cap', () => {
    const target = normalizeTarget({ mode: 'reps', kind: 'amrap', sets: 1, reps: 5, cap: 12, weight: 40 })
    expect(target).toMatchObject({
      phase: 'work', mode: 'reps', kind: 'amrap', sets: 1,
      reps: 5, amrapMinReps: 5, sec: null, weight: 40
    })
    expect(target).not.toHaveProperty('cap')
    expect(target).not.toHaveProperty('amrapMaxSec')
  })

  it('represents a timed AMRAP target with an optional duration cap, not a rep cap', () => {
    expect(normalizeTarget({ phase: 'work', mode: 'time', amrap: true, sec: 30, cap: 90 })).toEqual({
      phase: 'work', mode: 'time', kind: 'amrap', sets: 1,
      reps: null, sec: 30, weight: 0, amrapMaxSec: 90
    })
  })

  it('rejects invalid or missing values while retaining safe JSON values', () => {
    const target = normalizeTarget({ phase: '???', mode: '???', kind: '???', sets: -2, reps: 'nope', sec: Infinity, weight: NaN, cap: -1 })
    expect(target).toEqual({
      phase: 'work', mode: 'reps', kind: 'fixed', sets: 1,
      reps: null, sec: null, weight: 0
    })
    expect(JSON.parse(JSON.stringify(target))).toEqual(target)
  })

  it('does not turn an explicit warm-up into work because it is legacy-shaped', () => {
    expect(normalizeTarget({ phase: 'warmup', reps: 10, sets: 1 })).toMatchObject({ phase: 'warmup' })
  })

  it('accepts an explicit AMRAP minimum field as the canonical target', () => {
    expect(normalizeTarget({ mode: 'reps', kind: 'amrap', amrapMinReps: 6 })).toMatchObject({
      mode: 'reps', kind: 'amrap', reps: 6, amrapMinReps: 6
    })
  })
})

describe('normalizePlannedSet and normalizeLoggedSet', () => {
  it('normalizes planned phase and target fields without position-based inference', () => {
    expect(normalizePlannedSet({ phase: 'warmup', target: { mode: 'reps', reps: 8, sets: 1, weight: 20 } })).toEqual({
      phase: 'warmup', target: {
        phase: 'warmup', mode: 'reps', kind: 'fixed', sets: 1,
        reps: 8, sec: null, weight: 20
      }
    })
    expect(normalizePlannedSet({ target: { mode: 'reps', reps: 8 } }).phase).toBe('work')
  })

  it('preserves actual repetition results without restoring a rep cap', () => {
    expect(normalizeLoggedSet({ phase: 'work', done: true, w: 40, r: 9 }, { mode: 'reps', kind: 'amrap', reps: 5, cap: 12 })).toEqual({
      phase: 'work', done: true, w: 40, r: 9, sec: null, cap: null
    })
  })

  it('preserves actual time results and keeps timed duration separate from reps', () => {
    expect(normalizeLoggedSet({ done: true, sec: 38, w: 0 }, { mode: 'time', kind: 'amrap', sec: 30, cap: 90 })).toEqual({
      phase: 'work', done: true, w: 0, r: null, sec: 38, cap: null
    })
  })

  it('normalizes a legacy boolean warm-up without letting the target default erase it', () => {
    expect(normalizeLoggedSet({ warmup: true, done: true, w: 20, r: 8 }, { mode: 'reps', reps: 8 }))
      .toMatchObject({ phase: 'warmup', done: true, w: 20, r: 8 })
  })

  it('normalizes a legacy entry without synthesizing a target from actual results', () => {
    const entry = normalizeEntry({ id: 'squat', sets: [{ w: 60, r: 5, done: true }] })
    expect(entry).not.toHaveProperty('target')
    expect(entry).toMatchObject({
      id: 'squat', phase: 'work',
      sets: [{ phase: 'work', done: true, w: 60, r: 5, sec: null, cap: null }]
    })
  })

  it('does not infer a planned set count from legacy result rows', () => {
    const entry = normalizeEntry({ id: 'squat', sets: [
      { w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 4, done: true }
    ] })
    expect(entry).not.toHaveProperty('target')
    expect(entry.sets).toHaveLength(3)
  })
})

describe('mode inference for logged sets', () => {
  it('lets an explicit set mode preserve warm-up reps beside a timed work target', () => {
    const target = { mode: 'time', sec: 45 }
    expect(modeForSet({ phase: 'warmup', mode: 'reps', w: 20, r: 10, done: true }, target)).toBe('reps')
    expect(setVolume({ phase: 'warmup', mode: 'reps', w: 20, r: 10, done: true }, target)).toBe(200)
    expect(setVolume({ phase: 'work', mode: 'time', w: 20, sec: 45, done: true }, target)).toBe(0)
  })

  it('normalizes explicit row modes before stale result fields or the parent target', () => {
    expect(modeForSet({ mode: 'TIME', w: 20, r: 10, sec: 45, done: true }, { mode: 'reps', reps: 5 })).toBe('time')
    expect(modeForSet({ mode: 'RePs', w: 20, r: 10, sec: 45, done: true }, { mode: 'time', sec: 45 })).toBe('reps')
    expect(modeForSet({ result: { mode: 'TIME' }, w: 20, r: 10, done: true }, { mode: 'reps', reps: 5 })).toBe('time')
  })

  it('keeps an unannotated warm-up legacy fallback when no parent mode exists', () => {
    expect(modeForSet({ phase: 'warmup', w: 20, r: 10, done: true }, {})).toBe('reps')
    expect(setVolume({ phase: 'warmup', w: 20, r: 10, done: true }, {})).toBe(200)
  })

  it('does not let an unannotated row override an explicit or inferred timed parent', () => {
    const row = { phase: 'work', w: 200, r: 12, done: true }
    expect(modeForSet(row, { mode: 'time', sec: 60 })).toBe('time')
    expect(modeForSet(row, { sec: 60 })).toBe('time')
    expect(setVolume(row, { mode: 'time', sec: 60 })).toBe(0)
    expect(normalizeLoggedSet(row, { mode: 'time', sec: 60 })).toMatchObject({ w: 200, r: null, sec: 0 })
  })

  it('uses an inferred reps parent for an unannotated row instead of a stale duration field', () => {
    expect(modeForSet({ phase: 'work', w: 60, r: 5, sec: 45, done: true }, { reps: 5 })).toBe('reps')
  })

  it('prefers a work-set signal when inferring a mixed legacy entry mode', () => {
    expect(modeForEntry({ sets: [
      { phase: 'warmup', mode: 'reps', w: 20, r: 8, done: true },
      { phase: 'work', sec: 45, w: 0, done: true }
    ] })).toBe('time')
  })

  it('uses legacy set fields to identify a timed result when no target was stored', () => {
    expect(modeForSet({ sec: 60, w: 20, r: 5, done: true }, {})).toBe('time')
    expect(is1RMEligible({ sec: 60, w: 20, r: 5, done: true }, {})).toBe(false)
  })

  it('rejects an explicit reps target when the resolved work set is timed', () => {
    expect(modeForEntry({ target: { mode: 'reps' }, sets: [{ mode: 'time', sec: 60, done: true }] })).toBe('time')
  })

  it('rejects an explicit timed target when the resolved work set is reps', () => {
    expect(modeForEntry({ target: { mode: 'time' }, sets: [{ mode: 'reps', r: 5, done: true }] })).toBe('reps')
  })
})

describe('phase eligibility and volume', () => {
  it('counts completed warm-up reps toward volume but excludes them from progression and 1RM', () => {
    const warmup = { phase: 'warmup', done: true, w: 20, r: 10 }
    const work = { phase: 'work', done: true, w: 60, r: 5 }
    expect(setVolume(warmup, { mode: 'reps' })).toBe(200)
    expect(setVolume(work, { mode: 'reps' })).toBe(300)
    expect(isProgressionEligible(warmup)).toBe(false)
    expect(isProgressionEligible(work)).toBe(true)
    expect(is1RMEligible(warmup, { mode: 'reps' })).toBe(false)
    expect(is1RMEligible(work, { mode: 'reps' })).toBe(true)
  })

  it('uses the legacy work default while rejecting time results and incomplete sets', () => {
    expect(is1RMEligible({ phase: 'work', done: true, w: 60, r: 5 }, { mode: 'time' })).toBe(false)
    expect(is1RMEligible({ done: true, w: 60, r: 5 }, { mode: 'reps' })).toBe(true)
    expect(is1RMEligible({ phase: 'work', done: true, w: 60, sec: 45 })).toBe(false)
    expect(isProgressionEligible({ phase: 'work', done: false, w: 60, r: 5 })).toBe(false)
  })

  it('excludes a legacy boolean warm-up from progression and 1RM eligibility', () => {
    const warmup = { warmup: true, done: true, w: 60, r: 5 }
    expect(isProgressionEligible(warmup, { mode: 'reps' })).toBe(false)
    expect(is1RMEligible(warmup, { mode: 'reps' })).toBe(false)
  })

  it('accepts actual reps above an AMRAP minimum without capping the result or 1RM eligibility', () => {
    const target = { mode: 'reps', kind: 'amrap', amrapMinReps: 5 }
    const set = { phase: 'work', done: true, w: 60, r: 12 }
    expect(isProgressionEligible(set, target)).toBe(true)
    expect(is1RMEligible(set, target)).toBe(true)
    expect(setVolume(set, target)).toBe(720)
  })
})

describe('weight-unit compatibility and caches', () => {
  it('classifies legacy, explicit, and mixed-unit records without silently choosing a unit', () => {
    expect(historyUnitFor({ sets: [{ w: 60, r: 5 }] })).toBe('legacy')
    expect(historyUnitFor({ unit: 'kg', sets: [{ w: 60, r: 5 }] })).toBeNull()
    expect(historyUnitFor({ sets: [{ unit: 'kg', w: 60 }, { unit: 'lb', w: 130 }] })).toBeNull()
    expect(historyUnitCompatible({ sets: [{ w: 60, r: 5 }] }, 'kg')).toBe(true)
    expect(historyUnitCompatible({ sets: [{ unit: 'lb', w: 130 }] }, 'kg')).toBe(false)
  })

  it('keeps untagged legacy history visible in the active profile unit', () => {
    const legacy = {
      d: '2026-01-01',
      entries: [{ id: 'squat', sets: [{ done: true, w: 60, r: 5 }] }],
    }
    expect(historyUnitCompatible(legacy, 'kg')).toBe(true)
  })

  it('uses confirmed cache values only when their unit exactly matches', () => {
    expect(cachedWeightFor({ w: 60, unit: 'kg' }, 'kg')).toBe(60)
    expect(cachedWeightFor({ w: 132, unit: 'lb' }, 'kg')).toBe(0)
    expect(cachedWeightFor({ w: 60 }, 'kg')).toBe(0)
    expect(weightCacheEntry(60, '2026-01-01', 'kg')).toEqual({ w: 60, d: '2026-01-01', unit: 'kg' })
  })

  it('rejects unknown units instead of classifying them as a current profile unit', () => {
    expect(historyUnitFor({ unit: 'stones', sets: [{ w: 10, r: 5 }] })).toBeNull()
    expect(historyUnitCompatible({ unit: 'stones', sets: [{ w: 10, r: 5 }] }, 'kg')).toBe(false)
  })
})

describe('ambiguous results and completed volume', () => {
  it('preserves raw reps and seconds when a legacy row contains both', () => {
    const out = normalizeLoggedSet({ phase: 'work', done: true, w: 40, r: 5, sec: 45 }, {})
    expect(out).toMatchObject({ phase: 'work', done: true, w: 40, r: null, sec: 45 })
    expect(out.rawResult).toEqual({ r: 5, sec: 45 })
  })

  it('counts warm-up and work reps in volume while excluding timed rows', () => {
    const entry = {
      unit: 'kg',
      target: { mode: 'reps' },
      sets: [
        { phase: 'warmup', mode: 'reps', unit: 'kg', done: true, w: 20, r: 10 },
        { phase: 'work', mode: 'reps', unit: 'kg', done: true, w: 60, r: 5 },
        { phase: 'work', mode: 'time', done: true, w: 0, sec: 45 }
      ]
    }
    expect(entryVolume(entry, 'kg')).toBe(500)
    expect(workoutVolumeFromEntries({ unit: 'kg', entries: [entry] }, 'kg')).toBe(500)
  })

  it('stamps completed workouts with the unit in force without changing their entries', () => {
    const workout = { entries: [{ id: 'squat', sets: [{ w: 60, r: 5, done: true }] }] }
    expect(stampCompletedWorkout(workout, 'lb')).toEqual({
      unit: 'lb',
      entries: [{ id: 'squat', unit: 'lb', sets: [{ w: 60, r: 5, done: true, unit: 'lb' }] }]
    })
    expect(workout.unit).toBeUndefined()
  })

  it('preserves an explicit nested target while normalizing its logged rows', () => {
    const entry = normalizeEntry({
      id: 'squat',
      target: { phase: 'work', mode: 'reps', kind: 'amrap', amrapMinReps: 5, weight: 60 },
      sets: [{ phase: 'work', mode: 'reps', w: 60, r: 8, done: true }]
    })
    expect(entry.target).toMatchObject({ kind: 'amrap', amrapMinReps: 5, weight: 60 })
    expect(entry.sets[0]).toMatchObject({ phase: 'work', w: 60, r: 8, done: true })
  })

  it('rejects a mixed-unit entry from completed volume', () => {
    expect(entryVolume({
      target: { mode: 'reps' },
      sets: [
        { unit: 'kg', phase: 'work', w: 60, r: 5, done: true },
        { unit: 'lb', phase: 'work', w: 130, r: 5, done: true }
      ]
    }, 'kg')).toBe(0)
  })
})

describe('partial weight-unit isolation', () => {
  it('does not let an entry unit legitimize positive unitless child sets', () => {
    const entry = {
      unit: 'kg',
      sets: [{ phase: 'work', w: 60, r: 5, done: true }]
    }
    const raw = JSON.parse(JSON.stringify(entry))

    expect(historyUnitFor(entry)).toBeNull()
    expect(historyUnitCompatible(entry, 'kg')).toBe(false)
    expect(entryVolume(entry, 'kg')).toBe(0)
    expect(entry).toEqual(raw)
  })

  it('does not let a workout unit legitimize positive unitless child entries', () => {
    const workout = {
      unit: 'kg',
      entries: [{ id: 'squat', sets: [{ phase: 'work', w: 60, r: 5, done: true }] }]
    }
    const raw = JSON.parse(JSON.stringify(workout))

    expect(historyUnitFor(workout)).toBeNull()
    expect(historyUnitCompatible(workout, 'kg')).toBe(false)
    expect(workoutVolumeFromEntries(workout, 'kg')).toBe(0)
    expect(workout).toEqual(raw)
  })

  it('rejects a positive unitless set even when its entry has an explicit unit', () => {
    const entry = {
      unit: 'kg',
      target: { mode: 'reps', unit: 'kg' },
      sets: [
        { unit: 'kg', phase: 'work', w: 60, r: 5, done: true },
        { phase: 'work', w: 65, r: 5, done: true }
      ]
    }
    expect(historyUnitFor(entry)).toBeNull()
    expect(historyUnitCompatible(entry, 'kg')).toBe(false)
    expect(entryVolume(entry, 'kg')).toBe(0)
    expect(entry.sets[1]).not.toHaveProperty('unit')
  })

  it('rejects a positive unitless entry even when its workout has an explicit unit', () => {
    const workout = {
      unit: 'kg',
      entries: [
        { unit: 'kg', sets: [{ unit: 'kg', phase: 'work', w: 60, r: 5, done: true }] },
        { sets: [{ phase: 'work', w: 65, r: 5, done: true }] }
      ]
    }
    expect(historyUnitFor(workout)).toBeNull()
    expect(historyUnitCompatible(workout, 'kg')).toBe(false)
    expect(workoutVolumeFromEntries(workout, 'kg')).toBe(0)
    expect(historyUnitCompatible({ unit: 'kg', entries: [
      { unit: 'kg', sets: [{ w: 60, r: 5, done: true }] },
      { sets: [{ w: 40, r: 5, done: true }] }
    ] }, 'kg')).toBe(false)
  })

  it('keeps zero-load and timed rows compatible without inventing a unit', () => {
    expect(historyUnitCompatible({ w: 0, r: 10, done: true }, 'kg')).toBe(true)
    expect(historyUnitCompatible({ mode: 'time', sec: 45, w: 0, done: true }, 'kg')).toBe(true)
    expect(historyUnitCompatible({ w: 60, r: 5, done: true }, 'kg')).toBe(true)
    expect(historyUnitCompatible({ unit: 'kg', w: 60, r: 5, done: true }, 'kg')).toBe(true)
  })

  it('passes the expected unit through direct progression and 1RM eligibility checks', () => {
    const set = { phase: 'work', w: 60, r: 5, done: true }
    expect(isProgressionEligible(set, { mode: 'reps' }, 'kg')).toBe(true)
    expect(is1RMEligible(set, { mode: 'reps' }, 'kg')).toBe(true)
    expect(isProgressionEligible({ ...set, unit: 'kg' }, { mode: 'reps' }, 'kg')).toBe(true)
    expect(is1RMEligible({ ...set, unit: 'kg' }, { mode: 'reps' }, 'kg')).toBe(true)
  })
})
