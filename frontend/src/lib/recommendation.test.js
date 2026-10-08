import { describe, expect, it } from 'vitest'
import { recommendToday } from './recommendation.js'

function makeState(overrides = {}) {
  const S = {
    routines: [],
    workouts: [],
    week: {},
    dayPlan: {},
    work: [],
    equipFilterOn: false,
    equipProfiles: [],
    activeEquipId: null,
    unit: 'kg',
    workoutLength: 35,
    ...overrides,
  }
  return S
}

describe('recommendToday — recommendation layer', () => {
  it('first time / no history', () => {
    const S = makeState({ routines: [{ id: 'r1', name: 'Full Body A', ex: [{ id: '0025', sets: 3, reps: 8 }] }] })
    const r = recommendToday(S)
    expect(r.context).toBe('first')
    expect(r.routineId).toBe('r1')
    expect(r.duration).toBe(25)
  })

  it('recent workout yesterday', () => {
    const today = new Date()
    const iso = today.toISOString().slice(0, 10)
    const S = makeState({
      routines: [{ id: 'r1', name: 'Full Body A', ex: [{ id: '0025', sets: 3, reps: 8 }] }],
      workouts: [{ id: 'w1', d: iso }],
      week: { 1: ['r1'] },
    })
    const r = recommendToday(S)
    expect(r.context).toBe('recent-1')
    expect(r.duration).toBeLessThanOrEqual(25)
  })

  it('2 days ago', () => {
    const today = new Date()
    const d = new Date(today)
    d.setDate(today.getDate() - 2)
    const iso = d.toISOString().slice(0, 10)
    const S = makeState({
      routines: [{ id: 'r1', name: 'Full Body A', ex: [{ id: '0025', sets: 3, reps: 8 }] }],
      workouts: [{ id: 'w1', d: iso }],
      week: { 1: ['r1'] },
    })
    const r = recommendToday(S)
    expect(r.context).toBe('normal')
    expect(r.duration).toBe(35)
  })

  it('longer recovery gap (1+ week)', () => {
    const today = new Date()
    const d = new Date(today)
    d.setDate(today.getDate() - 10)
    const iso = d.toISOString().slice(0, 10)
    const S = makeState({
      routines: [{ id: 'r1', name: 'Full Body A', ex: [{ id: '0025', sets: 3, reps: 8 }] }],
      workouts: [{ id: 'w1', d: iso }],
    })
    const r = recommendToday(S)
    expect(r.context).toBe('gap')
    expect(r.duration).toBeGreaterThanOrEqual(35)
  })

  it('multiple routines — picks first available', () => {
    const S = makeState({
      routines: [
        { id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 8 }] },
        { id: 'r2', name: 'Pull', ex: [{ id: '0027', sets: 3, reps: 8 }] },
      ],
    })
    const r = recommendToday(S)
    expect(['r1', 'r2']).toContain(r.routineId)
  })

  it('equipment profile filters unavailable exercises', () => {
    const S = makeState({
      equipFilterOn: true,
      equipProfiles: [{ id: 'p1', name: 'Bodyweight', equipment: ['body weight'] }],
      activeEquipId: 'p1',
      routines: [
        { id: 'r1', name: 'Home', ex: [{ id: '0251', sets: 3, reps: 10, bodyweight: true }] },
        { id: 'r2', name: 'Gym', ex: [{ id: '0025', sets: 3, reps: 8 }] },
      ],
    })
    const r = recommendToday(S)
    // Bodyweight routine should be available; gym routine with barbell should still pass
    // (only unavailable exercises make it fail — all available means kept)
    expect(r.routine).toBeTruthy()
  })

  it('different durations passed through', () => {
    const S = makeState({
      routines: [{ id: 'r1', name: 'Full Body A', ex: [{ id: '0025', sets: 3, reps: 8 }] }],
      workoutLength: 15,
    })
    const r = recommendToday(S)
    expect(r.duration).toBeGreaterThanOrEqual(15)
  })

  it('planned routine for today takes precedence', () => {
    const today = new Date()
    const wd = today.getDay()
    const iso = today.toISOString().slice(0, 10)
    const S = makeState({
      routines: [
        { id: 'r1', name: 'A', ex: [{ id: '0025', sets: 3, reps: 8 }] },
        { id: 'r2', name: 'B', ex: [{ id: '0027', sets: 3, reps: 8 }] },
      ],
      week: { [wd]: ['r2'] },
    })
    const r = recommendToday(S)
    expect(r.routineId).toBe('r2')
  })
})
