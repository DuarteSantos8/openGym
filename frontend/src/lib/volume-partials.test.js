// "Count partials in volume": off is the app's own rule, full reps only; on, every number that
// says "volume" adds each lengthened partial at a fifth of a rep at the set's weight. The saved
// `vol` never changes, so the switch can go back and forth without touching history.
import { describe, expect, it } from 'vitest'
import { workoutVolume, sessionVolume, lifetimeVolume, countsPartials } from './history.js'
import { completedVolumeOf, partialVolumeOf, PARTIAL_REP_WEIGHT } from './workout-model.js'
import { workoutText } from './workout-text.js'
import { workoutCardModel } from './workout-card.js'

const BENCH = '0025'
// 10 x 100 kg = 1000; the second set, 8 x 100 = 800, is a failure set with 3 partials, worth
// 3 x 100 x PARTIAL_REP_WEIGHT on top when the profile counts them.
const EXTRA = 3 * 100 * PARTIAL_REP_WEIGHT
const session = (d, extra = {}) => ({
  id: d, d, name: 'Push', start: Date.parse(d + 'T10:00:00'), end: Date.parse(d + 'T11:00:00'),
  entries: [{ id: BENCH, sets: [{ w: 100, r: 10, done: true }, { w: 100, r: 8, done: true, failure: true, lp: 3 }] }],
  vol: 1800, prs: [], ...extra,
})
const profile = (on, workouts = [session('2026-10-01'), session('2026-10-08')]) =>
  ({ unit: 'kg', volumePartials: on, workouts, bodyweight: [], routines: [], exWeights: {} })

describe('the partials in a set\'s volume', () => {
  it('PARTIAL_REP_WEIGHT of a rep at the set\'s weight, only when asked', () => {
    const set = { w: 100, r: 8, done: true, failure: true, lp: 3 }
    expect(partialVolumeOf(set)).toBeCloseTo(EXTRA, 10)
    expect(completedVolumeOf(set)).toBe(800)
    expect(completedVolumeOf(set, { partials: true })).toBeCloseTo(800 + EXTRA, 10)
  })

  it('nothing for a set that is not done, not a failure set, rated short of it, a warm-up or per side', () => {
    expect(partialVolumeOf({ w: 100, r: 8, failure: true, lp: 3 })).toBe(0)
    expect(partialVolumeOf({ w: 100, r: 8, done: true, lp: 3 })).toBe(0)
    expect(partialVolumeOf({ w: 100, r: 8, done: true, failure: true, rir: 2, lp: 3 })).toBe(0)
    expect(partialVolumeOf({ w: 100, r: 8, done: true, failure: true, phase: 'warmup', lp: 3 })).toBe(0)
    expect(completedVolumeOf({ done: true, sides: { L: { w: 10, r: 5, done: true }, R: { w: 10, r: 5, done: true } } }, { partials: true })).toBe(100)
  })

  it('RIR 0 holds the failure the same way the F mark does', () => {
    expect(partialVolumeOf({ w: 50, r: 10, done: true, rir: 0, lp: 5 })).toBeCloseTo(5 * 50 * PARTIAL_REP_WEIGHT, 10)
  })
})

describe('workoutVolume and the partials switch', () => {
  it('leaves partials out unless asked', () => {
    const w = session('2026-10-01')
    expect(workoutVolume(w)).toBe(1800)
    expect(workoutVolume(w, { partials: true })).toBeCloseTo(1800 + EXTRA, 10)
  })

  it('reads the profile: off unless switched on, and the saved vol never changes', () => {
    expect(countsPartials({})).toBe(false)
    expect(countsPartials({ volumePartials: true })).toBe(true)
    expect(sessionVolume(session('2026-10-01'), profile(false))).toBe(1800)
    expect(sessionVolume(session('2026-10-01'), profile(true))).toBeCloseTo(1800 + EXTRA, 10)
    expect(session('2026-10-01').vol).toBe(1800)
  })

  it('counts both bells of a dumbbell entry, like the full reps', () => {
    const w = { entries: [{ id: BENCH, dbLoad: 'each', sets: [{ w: 20, r: 10, done: true, failure: true, lp: 5 }] }] }
    expect(workoutVolume(w, { partials: true })).toBeGreaterThanOrEqual(workoutVolume(w) + 5 * 20 * PARTIAL_REP_WEIGHT)
  })

  it('adds up a lifetime the same way', () => {
    expect(lifetimeVolume(profile(false))).toBe(3600)
    expect(lifetimeVolume(profile(true))).toBeCloseTo(3600 + 2 * EXTRA, 10)
  })
})

describe('every reader follows it', () => {
  it('"Copy as text" and the share card', () => {
    const w = session('2026-10-01')
    const text = (partials) => workoutText(w, { unit: 'kg', nameOf: () => 'Bench', partials })
    expect(text(false)).not.toBe(text(true))
    const volume = partials => workoutCardModel(w, { unit: 'kg', nameOf: () => 'Bench', partials }).stats.find(s => s.label.toLowerCase().includes('vol')).value
    expect(volume(false)).not.toBe(volume(true))
  })
})
