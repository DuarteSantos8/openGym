import { describe, expect, it } from 'vitest'
import {
  parseHevyWorkouts, parseHevyRoutines, mergeHevyRoutines, importHevyData, parseHevyMeasurements,
  mergeHevyMeasurements, freshHevyMeasurements, fillHevyCustoms, hevyTemplateInfo, linkHevyRoutines, linkableHevyWorkouts,
} from './import-hevy.js'
import { mergeImport, importId } from './import-csv.js'

// What the Hevy API import brings beyond workouts, routines and weigh-ins: notes, a routine's
// rest and rep range, body measurements, custom exercises' muscles, routine links, the unit.
const T = [
  { id: 't1', title: 'Squat (Barbell)', type: 'weight_reps', primary_muscle_group: 'quadriceps' },
  { id: 'c1', title: 'Grip Crusher (Cable)', type: 'weight_reps', is_custom: true, equipment: 'machine', primary_muscle_group: 'forearms', secondary_muscle_groups: ['biceps', 'other', 'forearms'] },
]
const hevyWorkout = (over = {}) => ({
  id: 'w1', title: 'Lower', routine_id: 'r1', description: '  Felt strong\nslept well ',
  start_time: '2026-10-14T16:27:30Z', end_time: '2026-10-14T17:40:00Z',
  exercises: [
    { exercise_template_id: 't1', title: 'Squat (Barbell)', notes: 'belt on', sets: [{ type: 'normal', weight_kg: 100, reps: 5 }] },
    { exercise_template_id: 't1', title: 'Squat (Barbell)', notes: 'paused', sets: [{ type: 'normal', weight_kg: 90, reps: 5 }] },
  ],
  ...over,
})
const hevyRoutine = (sets, over = {}) => ({
  id: 'r1', title: 'Lower', folder_id: null,
  exercises: [{ exercise_template_id: 't1', title: 'Squat (Barbell)', rest_seconds: 150, sets }],
  ...over,
})
const empty = () => ({ workouts: [], routines: [], customEx: [], bodyweight: [], exWeights: {} })

describe('the Hevy API import, beyond the sets', () => {
  it('brings a workout’s description, its exercises’ notes and its Hevy routine', () => {
    const [w] = parseHevyWorkouts([hevyWorkout()], T, { unit: 'kg' }).workouts
    expect(w).toMatchObject({ note: 'Felt strong\nslept well', hevyRoutineId: 'r1', routineId: null })
    expect(w.entries[0].note).toBe('belt on · paused')
    const [bare] = parseHevyWorkouts([hevyWorkout({ description: null, routine_id: null })], T, { unit: 'kg' }).workouts
    expect('note' in bare || 'hevyRoutineId' in bare).toBe(false)
  })

  it('reads a routine exercise’s rest and rep range; a range of one number is a rep count', () => {
    const ranged = parseHevyRoutines([hevyRoutine([
      { type: 'warmup', weight_kg: 60, reps: 5 },
      { type: 'normal', weight_kg: 100, reps: null, rep_range: { start: 8, end: 12 } },
    ])], T, { unit: 'kg' }).routines[0].ex[0]
    expect(ranged).toMatchObject({ restSec: 150, reps: 12, repsMin: 8, prog: 'double', weight: 100, warmupSets: 1 })
    const flat = parseHevyRoutines([hevyRoutine([{ type: 'normal', weight_kg: 100, reps: null, rep_range: { start: 6, end: 6 } }])], T, { unit: 'kg' }).routines[0].ex[0]
    expect(flat.reps).toBe(6)
    expect(flat.prog).toBeUndefined()
    const none = parseHevyRoutines([hevyRoutine([], { exercises: [{ exercise_template_id: 't1', sets: [{ type: 'normal', weight_kg: 100, reps: 5 }] }] })], T, { unit: 'kg' }).routines[0].ex[0]
    expect(none.restSec).toBeUndefined()
    expect(none.repsMin).toBeUndefined()
  })

  it('reads body measurements into the app’s fields, in cm', () => {
    const m = parseHevyMeasurements([
      { date: '2026-10-01', weight_kg: 80, neck_cm: 38, left_bicep_cm: 35, right_bicep_cm: 35.5, waist: 80.04, fat_percent: 18.5, lean_mass_kg: 65 },
      { date: '2026-10-02', weight_kg: 80.2 },                  // a weigh-in only: parseHevyBodyweight's
      { date: '2026-10-01', chest_cm: 95, fat_percent: 140 },  // the same day again; a percent over 100 is no reading
      { date: 'nope', neck_cm: 40 },
    ])
    expect(m).toEqual([{ d: '2026-10-01', t: new Date('2026-10-01T12:00:00').getTime(), neck: 38, upperArmLeft: 35, upperArmRight: 35.5, waist: 80, bodyFat: 18.5, chest: 95 }])
  })

  it('merges new measurement days only, and switches on the fields that got values', () => {
    const S = { measurements: [{ d: '2026-10-01', t: 1, neck: 40 }], measurementEnabled: ['neck', 'waist'], customMeasurements: [] }
    const m = parseHevyMeasurements([{ date: '2026-10-01', neck_cm: 38 }, { date: '2026-10-05', neck_cm: 39, fat_percent: 18 }])
    expect(freshHevyMeasurements(S, m).map(e => e.d)).toEqual(['2026-10-05'])
    expect(mergeHevyMeasurements(S, m)).toBe(1)
    expect(S.measurements.map(e => [e.d, e.neck])).toEqual([['2026-10-01', 40], ['2026-10-05', 39]])
    expect(S.measurements[1].bodyFat).toBe(18)
    expect(S.measurementEnabled).toEqual(['neck', 'waist', 'bodyFat'])
    expect(mergeHevyMeasurements(S, m)).toBe(0)
  })

  it('links imported workouts to their routine once the routine is here', () => {
    const p = parseHevyWorkouts([hevyWorkout()], T, { unit: 'kg' })
    const S = empty()
    mergeImport(S, p)
    expect(mergeHevyRoutines(S, parseHevyRoutines([hevyRoutine([{ type: 'normal', weight_kg: 100, reps: 5 }])], T, { unit: 'kg' })).added).toBe(1)
    expect(linkableHevyWorkouts(S, p.workouts)).toBe(1)
    expect(S.workouts[0].routineId).toBe(null)               // counting changes nothing
    expect(linkHevyRoutines(S, p.workouts, 5000)).toBe(1)
    expect(S.workouts[0]).toMatchObject({ routineId: S.routines[0].id, _ts: 5000 })
  })

  it('gives an earlier import’s workout of the same session its routine, and leaves a routine set in the app alone', () => {
    const p = parseHevyWorkouts([hevyWorkout()], T, { unit: 'kg' })
    const api = p.workouts[0]
    const csv = { id: 'iwcsv', d: api.d, start: api.start - 30000, routineId: null, name: 'Lower', entries: [] }   // the CSV has minutes only
    const other = { id: 'iwlate', d: api.d, start: api.start + 3 * 3600000, routineId: null, name: 'Evening', entries: [] }
    const mine = { id: 'mine', d: api.d, start: api.start + 60000, routineId: 'picked', name: 'Lower', entries: [] }
    const S = { workouts: [csv, other, mine], routines: [{ id: 'R', hevyId: 'r1', name: 'Lower', ex: [] }] }
    expect(linkHevyRoutines(S, p.workouts, 7)).toBe(1)
    expect(csv).toMatchObject({ routineId: 'R', hevyRoutineId: 'r1', _ts: 7 })
    expect(other.routineId).toBe(null)
    expect(mine.routineId).toBe('picked')
    // a routine imported later links it then
    const later = { workouts: [{ ...csv, routineId: null }], routines: [] }
    expect(linkHevyRoutines(later, p.workouts)).toBe(0)
    later.routines.push({ id: 'R2', hevyId: 'r1', ex: [] })
    expect(linkHevyRoutines(later, [])).toBe(1)
    expect(later.workouts[0].routineId).toBe('R2')
  })

  it('makes a custom exercise with its template’s muscles and equipment, and fills an earlier import’s, not one edited since', () => {
    const p = parseHevyWorkouts([hevyWorkout({ exercises: [{ exercise_template_id: 'c1', title: 'Grip Crusher (Cable)', sets: [{ type: 'normal', weight_kg: 20, reps: 10 }] }] })], T, { unit: 'kg' })
    const muscles = { eq: 'cable', tg: 'forearm', primaries: ['forearm'], secondaries: ['biceps'], sm: ['biceps'], muscleGroups: ['forearm', 'biceps'] }
    expect(p.customEx[0]).toMatchObject({ id: importId('im', 'Hevy|c1'), ...muscles })
    const old = { id: importId('im', 'Hevy|c1'), n: 'grip crusher (cable)', custom: true, eq: 'custom', tg: '', bp: 'lower arms' }
    const edited = { id: importId('im', 'Hevy|t1'), n: 'squat', custom: true, eq: 'barbell', tg: 'quadriceps', primaries: ['quadriceps'] }
    const S = { customEx: [old, edited] }
    expect(fillHevyCustoms(S, T)).toBe(1)
    expect(old).toMatchObject(muscles)
    expect(edited).toMatchObject({ eq: 'barbell', tg: 'quadriceps' })
    expect(hevyTemplateInfo({ equipment: 'none', primary_muscle_group: 'cardio' })).toEqual({ eq: 'body weight' })
    expect(hevyTemplateInfo({ equipment: 'other', primary_muscle_group: 'lats', title: 'Smith thing' })).toMatchObject({ tg: 'upper-back' })
    expect(hevyTemplateInfo({ equipment: 'constructor', primary_muscle_group: '__proto__' })).toEqual({})
  })

  it('reads the account’s weight unit, and imports without it when it can’t', async () => {
    const realFetch = globalThis.fetch
    const pages = { exercise_templates: T, workouts: [hevyWorkout()], routines: [], body_measurements: [{ date: '2026-10-01', weight_kg: 80, neck_cm: 38 }] }
    let info = () => ({ ok: true, status: 200, json: async () => ({ data: { weight_unit: 'lbs' } }) })
    globalThis.fetch = async url => {
      const key = new URL(url).pathname.split('/').pop()
      if (key === 'info') return info()
      return { ok: true, status: 200, json: async () => ({ page_count: 1, [key]: pages[key] }) }
    }
    try {
      const data = await importHevyData('k', { unit: 'kg' })
      expect(data.accountUnit).toBe('lb')
      expect(data.measurements).toMatchObject([{ d: '2026-10-01', neck: 38 }])
      expect(data.bodyweight.bodyweight).toHaveLength(1)
      expect(data.templates.map(t => t.id)).toEqual(['t1', 'c1'])
      info = () => ({ ok: false, status: 404 })
      expect((await importHevyData('k', { unit: 'kg' })).accountUnit).toBe(null)
    } finally { globalThis.fetch = realFetch }
  })
})
