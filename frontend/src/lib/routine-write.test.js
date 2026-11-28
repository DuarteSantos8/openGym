import { describe, test, expect } from 'vitest'
import { createRoutine, updateRoutine, removeRoutine, weekdaysOf, routineWeekdays } from './routine-write.js'

const base = () => ({
  unit: 'kg',
  routines: [{ id: 'r1', name: 'Push', emoji: 'figureStrength', ex: [
    { id: '0025', sets: 4, reps: 6, weight: 80, mode: 'reps', restSec: 180, prog: 'double', warmups: [{ pct: 50, r: 8 }] },
    { id: '0025', sets: 2, reps: 12, weight: 60, mode: 'reps', note: 'back-off' },
  ] }],
  week: { 1: 'r1', 4: ['r1', 'x2'] },
  dayPlan: { '2026-11-10': 'r1', '2026-11-11': 'x2' },
})

describe('createRoutine', () => {
  test('what the editor would build, plus what was said', () => {
    const S = base()
    const r = createRoutine(S, { name: 'Legs', exercises: [{ exercise: 'squat', sets: 5, reps: 5, weight: 100, rest_sec: 150 }, { exercise: 'plank', seconds: 60 }], weekdays: ['tuesday', 5] }, { id: 'n1' })
    expect(r.problems).toBeUndefined()
    expect(r.routine).toEqual({ id: 'n1', name: 'Legs', emoji: 'figureStrength', ex: [
      { id: '0043', sets: 5, reps: 5, weight: 100, mode: 'reps', restSec: 150 },
      { id: '0463', sets: 3, sec: 60, weight: 0, mode: 'time', bodyweight: true },
    ] })
    expect(S.routines).toHaveLength(2)
    expect(S.week).toEqual({ 1: 'r1', 2: ['n1'], 4: ['r1', 'x2'], 5: ['n1'] })
  })
  test('weights in the other unit are stored in the profile\'s', () => {
    const S = { ...base(), unit: 'kg' }
    const r = createRoutine(S, { name: 'X', unit: 'lb', exercises: [{ exercise: 'squat', weight: 225 }] })
    expect(r.routine.ex[0].weight).toBe(102.1)
  })
  test('every problem at once, and nothing changed', () => {
    const S = base()
    const before = JSON.stringify(S)
    const r = createRoutine(S, { name: 'Push', exercises: [{ exercise: 'ez barbell spider curl' }, { exercise: 'squat', reps: 5, seconds: 30 }, { exercise: 'squat', sets: 99 }], weekdays: ['someday'] })
    expect(r.routine).toBeUndefined()
    expect(r.problems.map(p => p.field)).toEqual(['name', 'exercises[0].exercise', 'exercises[1]', 'exercises[2].sets', 'weekdays'])
    expect(r.problems[1].candidates.length).toBeGreaterThan(1)
    expect(JSON.stringify(S)).toBe(before)
  })
  test('cardio takes no reps or seconds', () => {
    expect(createRoutine(base(), { name: 'C', exercises: [{ exercise: 'treadmill', reps: 10 }] }).problems[0].problem).toMatch(/minutes/)
    expect(createRoutine(base(), { name: 'C', exercises: [{ exercise: 'treadmill' }] }).routine.ex[0]).toMatchObject({ id: '3666', min: 20 })
  })
  test('sets explicit cardio minutes, speed in the requested unit, and incline', () => {
    const r = createRoutine(base(), { name: 'Warm-up', speed_unit: 'mph', exercises: [{ exercise: 'treadmill', minutes: 10, speed: 3.5, incline: 7 }] })
    expect(r.problems).toBeUndefined()
    expect(r.routine.ex[0]).toMatchObject({ id: '3666', min: 10, speed: 5.63, incline: 7 })
  })
  test('edits cardio targets while preserving omitted values and accepts zero incline as clear', () => {
    const S = base()
    S.routines[0].ex.push({ id: '3666', mode: 'cardio', sets: 1, min: 20, speed: 8, incline: 5 })
    const r = updateRoutine(S, 'r1', { speed_unit: 'mph', exercises: [
      { exercise: '0025' }, { exercise: '0025' },
      { exercise: '3666', minutes: 10, speed: 4, incline: 0 },
    ] })
    expect(r.problems).toBeUndefined()
    expect(r.routine.ex[2]).toMatchObject({ id: '3666', min: 10, speed: 6.44 })
    expect(r.routine.ex[2]).not.toHaveProperty('incline')
  })
  test('rejects cardio targets on non-cardio and incline on flat cardio', () => {
    expect(createRoutine(base(), { name: 'Bad', exercises: [{ exercise: 'squat', minutes: 10 }] }).problems.map(p => p.field)).toContain('exercises[0].minutes')
    expect(createRoutine(base(), { name: 'Bad', exercises: [{ exercise: 'stationary bike', incline: 5 }] }).problems.map(p => p.field)).toContain('exercises[0].incline')
  })
  test('rejects cardio targets on distance-mode slots without changing the distance plan', () => {
    const S = base()
    S.routines[0].ex.push({ id: '3666', mode: 'distance', distance: 5000 })
    const before = JSON.stringify(S)
    const r = updateRoutine(S, 'r1', { exercises: [
      { exercise: '0025' }, { exercise: '0025' },
      { exercise: '3666', minutes: 10, speed: 5 },
    ] })
    expect(r.problems.map(p => p.field)).toEqual(['exercises[2]'])
    expect(JSON.stringify(S)).toBe(before)
  })
  test('rejects zero speed because the app treats it as its default speed', () => {
    const r = createRoutine(base(), { name: 'Zero speed', exercises: [{ exercise: 'treadmill', minutes: 10, speed: 0 }] })
    expect(r.problems.map(p => p.field)).toContain('exercises[0].speed')
  })
})

describe('updateRoutine', () => {
  test('keeps what a slot had that the edit does not mention, slot by slot', () => {
    const S = base()
    const r = updateRoutine(S, 'r1', { exercises: [{ exercise: '0025', sets: 5 }, { exercise: 'bench press', reps: 15 }, { exercise: 'dumbbell curl' }] })
    expect(r.problems).toBeUndefined()
    expect(r.routine.ex[0]).toEqual({ id: '0025', sets: 5, reps: 6, weight: 80, mode: 'reps', restSec: 180, prog: 'double', warmups: [{ pct: 50, r: 8 }] })
    expect(r.routine.ex[1]).toEqual({ id: '0025', sets: 2, reps: 15, weight: 60, mode: 'reps', note: 'back-off' })
    expect(r.routine.ex[2]).toMatchObject({ id: '0294', sets: 3, reps: 10 })
    expect(r.routine.emoji).toBe('figureStrength')
    expect(S.week).toEqual(base().week, 'weekdays untouched without weekdays')
  })
  test('rename, append, and move to other weekdays', () => {
    const S = base()
    const r = updateRoutine(S, 'r1', { name: 'Push heavy', add_exercises: [{ exercise: 'plank' }], weekdays: ['wednesday'] })
    expect(r.routine.name).toBe('Push heavy')
    expect(r.routine.ex.map(e => e.id)).toEqual(['0025', '0025', '0463'])
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

describe('rep range and progression rule (#1258)', () => {
  test('a routine rule and a slot rule, with the editor\'s range shape', () => {
    const S = base()
    const r = createRoutine(S, { name: 'Bands', policy: 'double', exercises: [
      { exercise: 'bench press', reps: 12, reps_min: 8 },
      { exercise: 'squat', reps: 5, policy: 'linear' },
      { exercise: 'plank', seconds: 30, policy: 'time' },
    ] }, { id: 'n2' })
    expect(r.problems).toBeUndefined()
    expect(r.routine.prog).toBe('double')
    expect(r.routine.ex[0]).toMatchObject({ reps: 12, repsMin: 8 })
    expect(r.routine.ex[0].prog).toBeUndefined()
    expect(r.routine.ex[1]).toMatchObject({ reps: 5, prog: 'linear' })
    expect(r.routine.ex[1].repsMin).toBeUndefined()
    expect(r.routine.ex[2].prog).toBe('time')
  })
  test('a range needs a rule that climbs one, and has to sit below reps', () => {
    const S = base()
    let r = createRoutine(S, { name: 'X', exercises: [{ exercise: 'squat', reps: 12, reps_min: 8 }] })
    expect(r.problems[0]).toMatchObject({ field: 'exercises[0].reps_min' })
    expect(r.problems[0].problem).toMatch(/follows linear/)
    r = createRoutine(S, { name: 'X', exercises: [{ exercise: 'squat', reps: 8, reps_min: 8, policy: 'triple' }] })
    expect(r.problems[0].problem).toMatch(/below reps/)
    r = createRoutine(S, { name: 'X', exercises: [{ exercise: 'plank', seconds: 30, policy: 'double' }] })
    expect(r.problems[0]).toMatchObject({ field: 'exercises[0].policy' })
    expect(createRoutine(S, { name: 'X', policy: 'sometimes', exercises: [{ exercise: 'squat' }] }).problems[0].field).toBe('policy')
  })
  test('update: the routine rule changes or goes back to the profile\'s, a slot rule goes with default', () => {
    const S = base()
    let r = updateRoutine(S, 'r1', { policy: 'steady', exercises: [{ exercise: '0025', reps: 10, reps_min: 6 }, { exercise: '0025', policy: 'off' }] })
    expect(r.problems).toBeUndefined()
    expect(r.routine.prog).toBe('steady')
    // The first slot carried double on its own; its range is written under that rule.
    expect(r.routine.ex[0]).toMatchObject({ reps: 10, repsMin: 6, prog: 'double', restSec: 180 })
    expect(r.routine.ex[1]).toMatchObject({ prog: 'off', note: 'back-off' })
    r = updateRoutine(S, 'r1', { policy: 'default', exercises: [{ exercise: '0025', policy: 'default' }, { exercise: '0025' }] })
    expect(r.routine.prog).toBeUndefined()
    expect(r.routine.ex[0].prog).toBeUndefined()
    expect(r.routine.ex[1].prog).toBe('off')
  })
})

describe('superset groups (#1257)', () => {
  const ids = r => r.routine.ex.map(e => e.sg || null)
  test('consecutive labels are one group: a pair, a tri-set, and a loner outside', () => {
    const S = base()
    const r = createRoutine(S, { name: 'Circuit', exercises: [
      { exercise: 'squat', superset: 'A' }, { exercise: 'bench press', superset: 'a' },
      { exercise: 'plank', superset: 'B' }, { exercise: 'dumbbell curl', superset: 'B' }, { exercise: '0025', superset: 'B' },
      { exercise: 'squat' },
    ] })
    expect(r.problems).toBeUndefined()
    const g = ids(r)
    expect(g[0]).toBeTruthy()
    expect(g[1]).toBe(g[0])
    expect(g[2]).toBeTruthy()
    expect(g[3]).toBe(g[2]); expect(g[4]).toBe(g[2])
    expect(g[2]).not.toBe(g[0])
    expect(g[5]).toBeNull()
  })
  test('a label alone is no superset, and one split by another exercise is a problem', () => {
    const S = base()
    expect(ids(createRoutine(S, { name: 'Solo', exercises: [{ exercise: 'squat', superset: 'A' }, { exercise: 'plank' }] }))).toEqual([null, null])
    const r = createRoutine(S, { name: 'Split', exercises: [{ exercise: 'squat', superset: 'A' }, { exercise: 'plank' }, { exercise: 'bench press', superset: 'A' }] })
    expect(r.problems[0]).toMatchObject({ field: 'exercises[2].superset' })
  })
  test('update keeps a group it is not told about, keeps its name when relabelled as it was, and "" leaves it', () => {
    const S = base()
    S.routines[0].ex[0].sg = 'g1'; S.routines[0].ex[0].sgName = 'Press pair'
    S.routines[0].ex[1].sg = 'g1'; S.routines[0].ex[1].sgName = 'Press pair'
    let r = updateRoutine(S, 'r1', { exercises: [{ exercise: '0025', sets: 5 }, { exercise: '0025' }] })
    expect(ids(r)).toEqual(['g1', 'g1'])
    r = updateRoutine(S, 'r1', { exercises: [{ exercise: '0025', superset: 'A' }, { exercise: '0025', superset: 'A' }] })
    expect(ids(r)).toEqual(['g1', 'g1'])
    expect(r.routine.ex[1].sgName).toBe('Press pair')
    r = updateRoutine(S, 'r1', { exercises: [{ exercise: '0025' }, { exercise: '0025', superset: '' }, { exercise: 'plank', superset: 'B' }, { exercise: 'squat', superset: 'B' }] })
    expect(r.problems).toBeUndefined()
    expect(r.routine.ex[0].sg).toBeUndefined()
    expect(r.routine.ex[0].sgName).toBeUndefined()
    expect(r.routine.ex[2].sg).toBeTruthy()
    expect(r.routine.ex[3].sg).toBe(r.routine.ex[2].sg)
    expect(r.routine.ex[2].sg).not.toBe('g1')
  })
})

describe('bands on a slot (#1371)', () => {
  const banded = () => ({ ...base(), bands: [{ id: 'b-red', name: 'Red', color: '#eb5757', kg: 10 }, { id: 'b-green', name: 'Green', color: '#27ae60', kg: 15 }] })
  test('bands by name or id on a band exercise, each once', () => {
    const S = banded()
    const r = createRoutine(S, { name: 'Home', exercises: [{ exercise: '0784', reps: 15, reps_min: 10, policy: 'double', bands: ['red', 'b-green', 'Red'] }] })
    expect(r.problems).toBeUndefined()
    expect(r.routine.ex[0]).toMatchObject({ id: '0784', bands: ['b-red', 'b-green'], reps: 15, repsMin: 10, prog: 'double' })
  })
  test('an unknown band, a profile without bands', () => {
    let r = createRoutine(banded(), { name: 'Home', exercises: [{ exercise: '0784', bands: ['purple'] }] })
    expect(r.problems[0]).toMatchObject({ field: 'exercises[0].bands[0]', input: 'purple' })
    expect(r.problems[0].candidates.map(c => c.name)).toEqual(['Red', 'Green'])
    r = createRoutine(base(), { name: 'Home', exercises: [{ exercise: '0784', bands: ['red'] }] })
    expect(r.problems[0].problem).toMatch(/no bands yet/)
  })
  test('a weight on a band exercise is refused instead of quietly stopping the band climb', () => {
    const S = banded()
    let r = createRoutine(S, { name: 'Home', exercises: [{ exercise: '0784', weight: 15 }] })
    expect(r.problems[0]).toMatchObject({ field: 'exercises[0].weight' })
    expect(r.problems[0].problem).toMatch(/bands/)
    // Bands named on any exercise make it band-loaded, so the same holds there.
    r = createRoutine(S, { name: 'Home', exercises: [{ exercise: 'squat', bands: ['red'], weight: 40 }] })
    expect(r.problems.map(p => p.field)).toEqual(['exercises[0].weight'])
    // 0 is not a load: it is how you say "none".
    expect(createRoutine(S, { name: 'Home', exercises: [{ exercise: '0784', weight: 0, bands: ['red'] }] }).problems).toBeUndefined()
    // A plain barbell squat still takes its weight.
    expect(createRoutine(S, { name: 'Bar', exercises: [{ exercise: 'squat', weight: 100 }] }).routine.ex[0].weight).toBe(100)
  })
  test('update: bands replace the slot\'s, an empty list takes them away', () => {
    const S = banded()
    S.routines[0].ex.push({ id: '0784', sets: 3, reps: 12, mode: 'reps', weight: 0, bands: ['b-red'] })
    let r = updateRoutine(S, 'r1', { exercises: [{ exercise: '0025' }, { exercise: '0025' }, { exercise: '0784', bands: ['green'] }] })
    expect(r.routine.ex[2].bands).toEqual(['b-green'])
    r = updateRoutine(S, 'r1', { exercises: [{ exercise: '0025' }, { exercise: '0025' }, { exercise: '0784', bands: [] }] })
    expect(r.routine.ex[2].bands).toBeUndefined()
  })
})
