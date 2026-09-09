import { describe, it, expect } from 'vitest'
import { EXIDX, EXDB, smOf } from './exercises.js'
import {
  MUSCLE_NAME, exerciseMuscleSnapshot, hasExplicitMuscleMetadata, levelsOf, loadOf,
  loadOfWorkouts, matchesMuscleGroups, muscleBalanceWindow, muscleGroupsOf, musclesOf, rankOf
} from './muscles.js'

describe('multi-muscle exercise metadata', () => {
  it('normalizes legacy primary/secondary fields and removes duplicate groups', () => {
    const ex = { tg: 'pectorals', mg: 'triceps', sm: ['triceps', 'chest'] }
    expect(muscleGroupsOf(ex)).toEqual(['chest', 'triceps'])
    expect(musclesOf(ex)).toEqual({ chest: 1, triceps: 0.4 })
  })

  it('uses explicit multi-group metadata when present and supports legacy single groups', () => {
    expect(muscleGroupsOf({ muscleGroups: ['chest', 'pectorals', 'triceps'] })).toEqual(['chest', 'triceps'])
    expect(muscleGroupsOf({ tg: 'chest' })).toEqual(['chest'])
    expect(MUSCLE_NAME.chest).toBe('Chest')
  })

  it('falls back to the legacy body-part map when an optional multi-group field is empty', () => {
    expect(muscleGroupsOf({ bp: 'back', muscleGroups: [] })).toEqual(['upper-back', 'lower-back'])
    expect(matchesMuscleGroups({ bp: 'back', muscleGroups: [] }, ['lower-back'])).toBe(true)
  })

  it('falls back consistently when explicit groups contain only unknown names', () => {
    const ex = { bp: 'back', muscleGroups: ['not-a-drawable-name'] }
    expect(muscleGroupsOf(ex)).toEqual(['upper-back', 'lower-back'])
    expect(musclesOf(ex)).toEqual({ 'upper-back': 0.75, 'lower-back': 0.25 })
  })

  it('matches an exercise when any requested muscle group matches', () => {
    const ex = { muscleGroups: ['chest', 'triceps'] }
    expect(matchesMuscleGroups(ex, ['hamstring', 'triceps'])).toBe(true)
    expect(matchesMuscleGroups(ex, ['hamstring', 'gluteal'])).toBe(false)
    expect(matchesMuscleGroups(ex, [])).toBe(true)
  })

  it('counts one effective set per unique group instead of double counting duplicates', () => {
    expect(loadOf([{ id: 'inline', ex: { tg: 'chest', sm: ['chest', 'triceps'] }, sets: 2 }]))
      .toEqual({ chest: 2, triceps: 0.8 })
  })

  it('uses multi-muscle metadata carried by a history entry when its catalogue id is unavailable', () => {
    expect(loadOfWorkouts([{ entries: [{
      id: 'deleted-custom', muscleGroups: ['chest', 'chest', 'triceps'],
      sets: [{ done: true }]
    }] }])).toEqual({ chest: 1, triceps: 1 })
  })
})

describe('catalogue secondary muscles', () => {
  it('maps a bench press to chest, triceps and deltoids', () => {
    expect(musclesOf(EXIDX['0025'])).toMatchObject({
      chest: 1,
      triceps: 0.4,
      deltoids: 0.4,
    })
  })

  it('maps a squat to glutes, quads and hamstrings', () => {
    expect(musclesOf(EXIDX['0043'])).toMatchObject({
      gluteal: 1,
      quadriceps: 1,
      hamstring: 0.4,
    })
  })

  it('maps common row variations to the upper back, biceps and rear deltoids', () => {
    for (const id of ['0027', '0293', '0499', '0861']) {
      expect(musclesOf(EXIDX[id])).toMatchObject({
        'upper-back': 1,
        biceps: 0.4,
        deltoids: 0.4,
      })
    }
  })
})


describe('catalogue secondary additions', () => {
  it('enriches the muscle map without mutating the raw dataset', () => {
    const raw = EXDB.find(e => e.id === '0027')
    expect(raw.sm).not.toContain('rear deltoids')
    expect(smOf(raw)).toContain('rear deltoids')
    // the alias collapses onto the deltoids slug in the canonical muscle map
    expect(musclesOf(raw)).toHaveProperty('deltoids')
  })
})


describe('explicit multi-primary metadata', () => {
  it('gives every primary full weight and secondaries supporting weight', () => {
    const ex = {
      bp: 'chest', tg: 'abs', mg: 'triceps', sm: ['lower back'],
      primaries: ['chest', 'triceps', 'chest'], secondaries: ['deltoids', 'triceps']
    }
    expect(muscleGroupsOf(ex)).toEqual(['chest', 'triceps', 'deltoids'])
    expect(musclesOf(ex)).toEqual({ chest: 1, triceps: 1, deltoids: 0.4 })
  })

  it('keeps the body-part fallback when primaries are absent or explicitly empty', () => {
    const expected = { 'upper-back': 0.75, 'lower-back': 0.25 }
    expect(musclesOf({ bp: 'back' })).toEqual(expected)
    expect(musclesOf({ bp: 'back', primaries: [] })).toEqual(expected)
  })

  it('keeps legacy metadata when a new array field is present but empty', () => {
    expect(exerciseMuscleSnapshot({ bp: 'chest', tg: 'abs', primaries: [] })).toMatchObject({
      muscleGroups: ['abs']
    })
  })

  it('provides a conservative Full body fallback for legacy custom exercises', () => {
    expect(muscleGroupsOf({ bp: 'full body' })).toEqual(['chest', 'upper-back', 'gluteal', 'quadriceps', 'hamstring', 'abs'])
    expect(musclesOf({ bp: 'full body' })).toEqual({
      chest: 0.2, 'upper-back': 0.2, gluteal: 0.2, quadriceps: 0.2, hamstring: 0.1, abs: 0.1
    })
  })

  it('preserves explicit primary and secondary arrays in history snapshots', () => {
    expect(exerciseMuscleSnapshot({
      n: 'Deadlift', bp: 'full body', primaries: ['gluteal', 'lower-back'], secondaries: ['hamstring']
    })).toMatchObject({
      n: 'Deadlift', bp: 'full body', primaries: ['gluteal', 'lower-back'], secondaries: ['hamstring'],
      muscleGroups: ['gluteal', 'lower-back', 'hamstring']
    })
  })
})


describe('map load with warm-up phases', () => {
  it('excludes warm-up sets from the by-sets-worked map', () => {
    const w = {
      id: 'w1', d: '2026-08-01', start: Date.UTC(2026, 7, 1, 10), unit: 'kg',
      entries: [{
        id: '0025',
        sets: [
          { done: true, phase: 'warmup', w: 20, r: 8 },
          { done: true, phase: 'work', w: 60, r: 8 },
        ],
      }],
    }
    const load = loadOfWorkouts([w], null)
    expect(load.chest).toBe(1)
  })
})

// A custom exercise that was deleted from the catalogue survives in history only as the
// muscleSnapshot finish-workout wrote. Reading it back is what keeps those sessions in the
// body map and in Stats instead of silently contributing nothing.
describe('deleted custom exercises', () => {
  const snapshotEntry = {
    id: 'gone-custom-1',
    sets: [{ w: 60, r: 8, done: true }],
    muscleSnapshot: { n: 'Deleted custom', bp: 'chest', muscleGroups: ['chest'], muscleWeights: { chest: 1 } },
  }

  it('reads muscle load back out of the snapshot', () => {
    expect(loadOfWorkouts([{ d: '2026-08-01', entries: [snapshotEntry] }])).toEqual({ chest: 1 })
  })

  it('reports the snapshot groups as explicit metadata', () => {
    expect(hasExplicitMuscleMetadata(snapshotEntry)).toBe(true)
    expect(muscleGroupsOf(snapshotEntry)).toEqual(['chest'])
  })

  it('still prefers the entry\'s own metadata when it has any', () => {
    const withOwn = { ...snapshotEntry, tg: 'quadriceps' }
    expect(muscleGroupsOf(withOwn)).toEqual(['quadriceps'])
  })
})

// muscles.js counts completed work, so its warm-up boundary has to agree with the one the
// session runtime uses — including the legacy spellings phaseForSet normalises.
describe('warm-up boundary', () => {
  it('excludes every phase spelling the workout model treats as a warm-up', () => {
    const entries = spelling => [{ id: '0025', sets: [{ w: 100, r: 5, done: true, phase: spelling }] }]
    for (const spelling of ['warmup', 'warm-up', 'warm_up', 'Warmup', ' warmup ']) {
      expect(loadOfWorkouts([{ d: '2026-08-01', entries: entries(spelling) }]), spelling).toEqual({})
    }
  })
})

describe('muscle balance windows and ranking', () => {
  const now = new Date('2026-08-27T12:00:00').getTime()
  const workouts = [
    { id: 'monday', d: '2026-08-24', start: new Date('2026-08-24T12:00:00').getTime() },
    { id: 'sunday', d: '2026-08-23', start: new Date('2026-08-23T12:00:00').getTime() },
    { id: 'boundary', d: '2026-07-28', start: now - 30 * 86400000 },
    { id: 'inside', d: '2026-07-29', start: now - 29 * 86400000 },
  ]

  it('preserves calendar-week, strict trailing-day, and all-history semantics', () => {
    expect(muscleBalanceWindow(workouts, 7, now, '2026-08-27').map(w => w.id)).toEqual(['monday'])
    expect(muscleBalanceWindow(workouts, 30, now, '2026-08-27').map(w => w.id)).toEqual(['monday', 'sunday', 'inside'])
    expect(muscleBalanceWindow(workouts, 0, now, '2026-08-27')).toEqual(workouts)
  })

  it('uses relative levels and canonical order to break load ties', () => {
    const load = { chest: 2, deltoids: 2, biceps: 1 }
    expect(rankOf(load).worked).toEqual(['deltoids', 'chest', 'biceps'])
    expect(levelsOf(load)).toMatchObject({ deltoids: 4, chest: 4, biceps: 2, abs: 0 })
  })

  it('keeps catalogue precedence and deleted-custom snapshot weights', () => {
    const known = { id: '0025', muscleGroups: ['quadriceps'], sets: [{ done: true }] }
    const deleted = { id: 'deleted', muscleSnapshot: { muscleWeights: { chest: 1 } }, sets: [{ done: true }] }
    expect(loadOfWorkouts([{ entries: [known] }])).toEqual({ chest: 1, triceps: 0.4, deltoids: 0.4, biceps: 0.4 })
    expect(loadOfWorkouts([{ entries: [deleted] }])).toEqual({ chest: 1 })
  })
})
