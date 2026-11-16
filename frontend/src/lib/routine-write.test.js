import { describe, test, expect } from 'vitest'
import { createRoutine, updateRoutine, removeRoutine, weekdaysOf, routineWeekdays } from './routine-write.js'
import { migratedFixture } from './test-fixtures.js'
import { planPhase } from './prescription/index.js'

// A v2 slot read back as the numbers the description talks in.
const view = o => {
  const p = planPhase(o.rule).parameters
  return {
    id: o.exerciseId, sets: p.sets.min,
    ...(p.durationSeconds ? { sec: p.durationSeconds.min } : { reps: p.reps.max, ...(p.reps.min !== p.reps.max ? { repsMin: p.reps.min } : {}) }),
    weight: p.load.mode === 'absolute' ? p.load.value : 0, ...(o.restFromProfile ? {} : { restSec: p.restSeconds }), ...(o.note ? { note: o.note } : {}), preset: o.rule.preset,
  }
}
const base = () => ({ ...migratedFixture(v1()), week: { 1: 'r1', 4: ['r1', 'x2'] }, dayPlan: { '2026-11-10': 'r1', '2026-11-11': 'x2' } })
const v1 = () => ({
  unit: 'kg', restSec: 90, workouts: [],
  routines: [{ id: 'r1', name: 'Push', emoji: 'figureStrength', ex: [
    { id: '0025', sets: 4, reps: 6, weight: 80, mode: 'reps', restSec: 180, prog: 'double', warmups: [{ pct: 50, r: 8 }] },
    { id: '0025', sets: 2, reps: 12, weight: 60, mode: 'reps', note: 'back-off' },
  ] }],
})

describe('createRoutine', () => {
  test('what the editor would build, plus what was said', () => {
    const S = base()
    const r = createRoutine(S, { name: 'Legs', exercises: [{ exercise: 'squat', sets: 5, reps: 5, weight: 100, rest_sec: 150 }, { exercise: 'plank', seconds: 60 }], weekdays: ['tuesday', 5] }, { id: 'n1' })
    expect(r.problems).toBeUndefined()
    expect({ ...r.routine, ex: undefined }).toEqual({ id: 'n1', name: 'Legs', emoji: 'figureStrength', ex: undefined })
    expect(r.routine.ex.map(view)).toEqual([
      { id: '0043', sets: 5, reps: 5, weight: 100, restSec: 150, preset: 'linear' },
      { id: '0463', sets: 3, sec: 60, weight: 0, preset: 'manual' },
    ])
    expect(r.routine.ex.every(o => o.rule.routineId === 'n1')).toBe(true)
    expect(S.routines).toHaveLength(2)
    expect(S.week).toEqual({ 1: 'r1', 2: ['n1'], 4: ['r1', 'x2'], 5: ['n1'] })
  })
  test('weights in the other unit are stored in the profile\'s', () => {
    const S = { ...base(), unit: 'kg' }
    const r = createRoutine(S, { name: 'X', unit: 'lb', exercises: [{ exercise: 'squat', weight: 225 }] })
    expect(view(r.routine.ex[0]).weight).toBe(102.1)
  })
  test('every problem at once, and nothing changed', () => {
    const S = base()
    const before = JSON.stringify(S)
    const r = createRoutine(S, { name: 'Push', exercises: [{ exercise: 'lever chest press' }, { exercise: 'squat', reps: 5, seconds: 30 }, { exercise: 'squat', sets: 99 }], weekdays: ['someday'] })
    expect(r.routine).toBeUndefined()
    expect(r.problems.map(p => p.field)).toEqual(['name', 'exercises[0].exercise', 'exercises[1]', 'exercises[2].sets', 'weekdays'])
    expect(r.problems[1].candidates.length).toBeGreaterThan(1)
    expect(JSON.stringify(S)).toBe(before)
  })
  test('cardio takes no reps or seconds', () => {
    expect(createRoutine(base(), { name: 'C', exercises: [{ exercise: 'treadmill', reps: 10 }] }).problems[0].problem).toMatch(/minutes/)
    const run = createRoutine(base(), { name: 'C', exercises: [{ exercise: 'treadmill' }] }).routine.ex[0]
    expect(run).toMatchObject({ exerciseId: '3666', mode: 'cardio', cardio: { min: 20 } })
  })
})

describe('updateRoutine', () => {
  test('keeps what a slot had that the edit does not mention, slot by slot', () => {
    const S = base()
    const r = updateRoutine(S, 'r1', { exercises: [{ exercise: '0025', sets: 5 }, { exercise: 'bench press', reps: 15 }, { exercise: 'dumbbell curl' }] })
    expect(r.problems).toBeUndefined()
    const before = base().routines[0].ex
    expect(view(r.routine.ex[0])).toEqual({ ...view(before[0]), sets: 5 })
    expect(r.routine.ex[0].warmup).toEqual(before[0].warmup)
    expect(r.routine.ex[0].occurrenceId).toBe(before[0].occurrenceId)
    expect(view(r.routine.ex[1])).toEqual({ ...view(before[1]), reps: 15, note: 'back-off' })
    expect(view(r.routine.ex[2])).toMatchObject({ id: '0294', sets: 3, reps: 10 })
    expect(r.routine.emoji).toBe('figureStrength')
    expect(S.week).toEqual(base().week, 'weekdays untouched without weekdays')
  })
  test('rename, append, and move to other weekdays', () => {
    const S = base()
    const r = updateRoutine(S, 'r1', { name: 'Push heavy', add_exercises: [{ exercise: 'plank' }], weekdays: ['wednesday'] })
    expect(r.routine.name).toBe('Push heavy')
    expect(r.routine.ex.map(e => e.exerciseId)).toEqual(['0025', '0025', '0463'])
    expect(S.week).toEqual({ 3: ['r1'], 4: ['x2'] })
    expect(routineWeekdays(S, 'r1')).toEqual(['wednesday'])
  })
  test('an unknown routine, a taken name', () => {
    expect(updateRoutine(base(), 'nope', { name: 'A' }).problems[0].field).toBe('routine_id')
    const S = base(); S.routines.push({ id: 'r2', name: 'Pull', ex: [] })
    expect(updateRoutine(S, 'r1', { name: 'pull' }).problems[0].problem).toMatch(/another routine/)
  })
})

describe('removeRoutine', () => {
  test('off every weekday and date, the other routines stay', () => {
    const S = base()
    const r = removeRoutine(S, 'r1')
    expect(r.routine.name).toBe('Push')
    expect(S.routines).toEqual([])
    expect(S.week).toEqual({ 4: ['x2'] })
    expect(S.dayPlan).toEqual({ '2026-11-11': 'x2' })
    expect(removeRoutine(S, 'r1').problems).toBeTruthy()
  })
})

test('weekdaysOf', () => {
  expect(weekdaysOf(['Monday', 0, 'monday'])).toEqual({ days: [0, 1] })
  expect(weekdaysOf([7]).problem).toBeTruthy()
  expect(weekdaysOf('monday').problem).toBeTruthy()
})
