// Cardio effort (Discord thehypetrainhobo): a treadmill walk counted as a full hard set for its
// muscles, because a cardio row had no way to carry a rating. The set menu now stores an RPE on
// the row as `rpe`, and the fatigue model reads it through rirOf like any rated set. No new
// weighting for walking: a rated row follows the same curve a rated lift does, an unrated one
// stays exactly where it was.
import { describe, expect, it } from 'vitest'
import { fatigueOf } from './recovery.js'

const HOUR = 3600000
const NOW = Date.UTC(2026, 9, 25, 12)
const TREADMILL = '2259'   // walking on treadmill
const walk = extra => [{
  id: 'w1', d: '2026-10-25', start: NOW - 2 * HOUR,
  entries: [{ id: TREADMILL, target: { mode: 'cardio', min: 30, speed: 5 }, sets: [{ min: 30, speed: 5, incline: 8, done: true, ...extra }] }],
}]
// The muscle the walk loads most, read off the model itself.
const slug = Object.entries(fatigueOf(walk({}), NOW)).sort((a, b) => b[1] - a[1])[0][0]

describe('a rated cardio row in the fatigue model', () => {
  it('an easy walk (RPE 6) loads less than an unrated one, a hard one the same', () => {
    const unrated = fatigueOf(walk({}), NOW)[slug]
    expect(unrated).toBeGreaterThan(0)
    expect(fatigueOf(walk({ rpe: 6 }), NOW)[slug]).toBeLessThan(unrated)
    // RPE 9 is RIR 1, inside the hard range, which counts full like an unrated set.
    expect(fatigueOf(walk({ rpe: 9 }), NOW)[slug]).toBeCloseTo(unrated, 12)
  })

  it('unrated cardio keeps its weight (no walking discount)', () => {
    const run = walk({})
    run[0].entries[0].sets[0].speed = 10
    expect(fatigueOf(walk({}), NOW)[slug]).toBeCloseTo(fatigueOf(run, NOW)[slug], 12)
  })
})
