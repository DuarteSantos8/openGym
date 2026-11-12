import { describe, expect, it } from 'vitest'
import { buildSessionEntries } from './session-start.js'
import { setKnownBands } from './bands.js'

// Night QA 146: every set at the top with Red, and the next session handed out Green AND 13 reps.
const BANDS = [
  { id: 'y', name: 'Yellow', color: '#f2c94c', kg: 5 },
  { id: 'r', name: 'Red', color: '#eb5757', kg: 10 },
  { id: 'g', name: 'Green', color: '#27ae60', kg: 15 },
]
const routine = { id: 'r1', name: 'Bands', ex: [{ id: '0005', sets: 2, reps: 12, weight: 0, mode: 'reps', bands: ['r'] }] }
const stateAfter = reps => ({
  unit: 'kg', bands: BANDS, routines: [routine], week: {},
  workouts: [{ id: 'w1', d: '2026-11-01', start: 1, end: 2, routineId: 'r1', name: 'Bands',
    entries: [{ id: '0005', target: { reps: 12, weight: 0, mode: 'reps' }, sets: reps.map(r => ({ w: 0, r, bands: ['r'], done: true })) }] }],
})

describe('bands that go up start the reps again', () => {
  it('the heavier band at the plan reps, not one rep more as well', () => {
    setKnownBands(BANDS)
    const [entry] = buildSessionEntries(stateAfter([12, 12]), routine)
    const work = entry.sets.filter(s => s.phase !== 'warmup')
    expect(work.map(s => s.bands)).toEqual([['g'], ['g']])
    expect(work.map(s => s.r)).toEqual([12, 12])
    // No "go for 13 this time" over rows that say 12.
    expect(entry.plan?.why).toBeUndefined()
  })
  it('a routine that repeats its last workout keeps the band it was done with', () => {
    setKnownBands(BANDS)
    const repeat = { ...routine, startFromLast: true }
    const [entry] = buildSessionEntries({ ...stateAfter([12, 12]), routines: [repeat] }, repeat)
    const work = entry.sets.filter(s => s.phase !== 'warmup')
    expect(work.map(s => s.bands)).toEqual([['r'], ['r']])
    expect(work.map(s => s.r)).toEqual([12, 12])
  })
  it('a session that fell short keeps the band and the prescription as before', () => {
    setKnownBands(BANDS)
    const [entry] = buildSessionEntries(stateAfter([12, 10]), routine)
    expect(entry.sets.map(s => s.bands)).toEqual([['r'], ['r']])
  })
})
