// The rest of what the Hevy API import brings: the body measurements besides the weight, a custom
// exercise's muscles and equipment from its Hevy template, and the unit the Hevy account shows.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseHevyMeasurements, newHevyMeasurements, mergeHevyMeasurements, hevyTemplateInfo,
  fillHevyCustomExercises, fetchHevyWeightUnit, parseHevyWorkouts, parseHevyRoutines,
  mergeHevyRoutines, importHevyData, parseHevyAccount,
} from './import-hevy.js'
import { mergeImport, importId } from './import-csv.js'
import { DEFAULT_MEASUREMENT_KEYS } from './measurements.js'
import { MUSCLE_MODEL } from './muscles.js'

const kg = { unit: 'kg' }
const reply = body => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body })
const empty = () => ({ workouts: [], routines: [], customEx: [], bodyweight: [], exWeights: {} })

describe('body measurements', () => {
  it('reads the circumferences and body fat into the app’s fields, the unsuffixed ones as cm too', () => {
    const p = parseHevyMeasurements([{
      date: '2026-10-01', weight_kg: 80, lean_mass_kg: 65,
      neck_cm: 38, shoulder_cm: 120, chest_cm: 101.04, abdomen: 85, waist: 80, hips: 98,
      left_bicep_cm: 35, right_bicep_cm: 35.5, left_forearm_cm: 30, right_forearm_cm: 30.2,
      left_thigh: 58, right_thigh: 58.5, left_calf: 38, right_calf: 38.4, fat_percent: 18.5,
    }])
    expect(p.kind).toBe('measurements')
    expect(p.measurements).toEqual([{
      d: '2026-10-01', other: [],
      values: {
        neck: 38, shoulders: 120, chest: 101, abdomen: 85, waist: 80, hips: 98,
        upperArmLeft: 35, upperArmRight: 35.5, forearmLeft: 30, forearmRight: 30.2,
        thighLeft: 58, thighRight: 58.5, calfLeft: 38, calfRight: 38.4, bodyFat: 18.5,
      },
    }])
  })

  it('makes one check-in a day, leaves out a weigh-in alone, and reads no value that is not one', () => {
    const p = parseHevyMeasurements([
      { date: '2026-10-02T08:00:00Z', neck_cm: 38, waist: 80 },
      { date: '2026-10-02', neck_cm: 39, fat_percent: 140 },        // the later row first; over 100 % is no reading
      { date: '2026-10-03', weight_kg: 80 },                         // a weigh-in only: parseHevyBodyweight's
      { date: '2026-10-04', neck_cm: true, waist: -3, hips: 'abc', chest_cm: { v: 1 }, left_calf: '37.5' },
      { date: 'nope', neck_cm: 40 }, { date: 20261005, neck_cm: 40 }, null,
    ])
    expect(p.measurements).toEqual([
      { d: '2026-10-02', values: { neck: 39, waist: 80 }, other: [] },
      { d: '2026-10-04', values: { calfLeft: 37.5 }, other: [] },
    ])
    expect(parseHevyMeasurements('x').measurements).toEqual([])
  })

  it('adds the days not here yet, keeps a day that has measurements, and switches on the fields that got values', () => {
    const S = { measurements: [{ d: '2026-10-01', t: 1, neck: 40 }], measurementEnabled: ['neck', 'waist'], customMeasurements: [] }
    const p = parseHevyMeasurements([
      { date: '2026-10-01', neck_cm: 38, chest_cm: 99 },
      { date: '2026-10-05', neck_cm: 39, abdomen: 84, fat_percent: 18 },
    ])
    expect(newHevyMeasurements(S, p).map(m => m.d)).toEqual(['2026-10-05'])
    expect(mergeHevyMeasurements(S, p)).toBe(1)
    expect(S.measurements.map(e => [e.d, e.neck, e.chest])).toEqual([['2026-10-01', 40, null], ['2026-10-05', 39, null]])
    expect(S.measurements[1]).toMatchObject({ abdomen: 84, bodyFat: 18 })
    expect(S.measurementEnabled).toEqual(['neck', 'waist', 'abdomen', 'bodyFat'])
    // Imported again: nothing new, nothing changed.
    expect(mergeHevyMeasurements(S, p)).toBe(0)
    expect(S.measurements).toHaveLength(2)
  })

  it('starts from the default fields when the list was never changed', () => {
    const S = { measurements: [], measurementEnabled: null, customMeasurements: [] }
    expect(mergeHevyMeasurements(S, parseHevyMeasurements([{ date: '2026-10-05', waist: 80, fat_percent: 20 }]))).toBe(1)
    expect(S.measurementEnabled).toEqual([...DEFAULT_MEASUREMENT_KEYS, 'bodyFat'])
    const none = { measurements: [], measurementEnabled: ['waist'], customMeasurements: [] }
    expect(mergeHevyMeasurements(none, parseHevyMeasurements([]))).toBe(0)
    expect(none).toEqual({ measurements: [], measurementEnabled: ['waist'], customMeasurements: [] })
  })
})

describe('custom exercises’ muscles and equipment', () => {
  // Not in HEVY_ID_MAP, so each becomes an exercise of your own.
  const GRIP = { id: 'C0FFEE01', title: 'Grip Crusher (Cable)', type: 'weight_reps', is_custom: true, equipment: 'machine', primary_muscle_group: 'forearms', secondary_muscle_groups: ['biceps', 'other', 'forearms', 'lats'] }
  const ROW = { id: 'C0FFEE02', title: 'Odd Row', type: 'weight_reps', is_custom: true, equipment: 'other', primary_muscle_group: 'upper_back', secondary_muscle_groups: [] }
  const workout = (...tpl) => ({
    id: 'w1', title: 'Pull', start_time: '2026-10-14T16:27:30Z', end_time: '2026-10-14T17:40:00Z',
    exercises: tpl.map(t => ({ exercise_template_id: t.id, title: t.title, sets: [{ type: 'normal', weight_kg: 20, reps: 10 }] })),
  })

  it('maps Hevy’s muscle groups and equipment onto the app’s', () => {
    expect(hevyTemplateInfo(GRIP)).toEqual({ eq: 'cable', primaries: ['forearm'], secondaries: ['lats', 'biceps'] })
    expect(hevyTemplateInfo({ equipment: 'machine', title: 'Smith Squat', primary_muscle_group: 'quadriceps', secondary_muscle_groups: ['glutes', 'abductors'] }))
      .toEqual({ eq: 'smith machine', primaries: ['quadriceps'], secondaries: ['gluteal'] })
    expect(hevyTemplateInfo({ equipment: 'machine', title: 'Leg Press' }).eq).toBe('leverage machine')
    expect(hevyTemplateInfo({ equipment: 'none', primary_muscle_group: 'cardio' })).toEqual({ eq: 'body weight', primaries: [], secondaries: [] })
    expect(hevyTemplateInfo({ equipment: 'plate', primary_muscle_group: 'shoulders' })).toEqual({ eq: 'weight plate', primaries: ['deltoids'], secondaries: [] })
    for (const [equipment, eq] of [['barbell', 'barbell'], ['dumbbell', 'dumbbell'], ['kettlebell', 'kettlebell'], ['resistance_band', 'resistance band'], ['suspension', 'suspension trainer'], ['other', null]]) {
      expect(hevyTemplateInfo({ equipment }).eq, equipment).toBe(eq)
    }
    // Text from the API never reaches Object's own machinery.
    expect(hevyTemplateInfo({ equipment: 'constructor', primary_muscle_group: '__proto__', secondary_muscle_groups: 'chest' }))
      .toEqual({ eq: null, primaries: [], secondaries: [] })
    expect(hevyTemplateInfo(null)).toEqual({ eq: null, primaries: [], secondaries: [] })
  })

  it('gives a custom exercise the import makes its template’s muscles and equipment', () => {
    const S = empty()
    mergeImport(S, parseHevyWorkouts([workout(GRIP, ROW)], [GRIP, ROW], kg))
    const grip = S.customEx.find(c => c.id === importId('im', 'Hevy|C0FFEE01'))
    expect(grip).toMatchObject({
      custom: true, eq: 'cable', tg: 'forearm', primaries: ['forearm'], secondaries: ['lats', 'biceps'],
      sm: ['lats', 'biceps'], muscleGroups: ['forearm', 'lats', 'biceps'], mv: MUSCLE_MODEL, bp: 'lower arms',
    })
    // "other" equipment: the import's own kind stays.
    expect(S.customEx.find(c => c.id === importId('im', 'Hevy|C0FFEE02'))).toMatchObject({ eq: 'custom', tg: 'upper-back', primaries: ['upper-back'] })
    // and the same through the routines
    const R = { routines: [], customEx: [] }
    mergeHevyRoutines(R, parseHevyRoutines([{ id: 'r1', title: 'Pull', exercises: [{ exercise_template_id: GRIP.id, sets: [{ type: 'normal', weight_kg: 20, reps: 10 }] }] }], [GRIP], kg))
    expect(R.customEx[0]).toMatchObject({ eq: 'cable', tg: 'forearm' })
  })

  it('fills in what an earlier import left empty, and never what is set on the exercise', () => {
    const bare = { id: importId('im', 'Hevy|C0FFEE01'), n: 'grip crusher (cable)', custom: true, eq: 'custom', tg: '', desc: '', bp: 'lower arms' }
    const mine = { id: importId('im', 'Hevy|C0FFEE02'), n: 'odd row', custom: true, eq: 'barbell', tg: 'lats', sm: [], primaries: ['lats'], secondaries: [], muscleGroups: ['lats'] }
    const SQUAT = { id: 'C0FFEE03', title: 'My Squat', equipment: 'barbell', primary_muscle_group: 'quadriceps' }
    const eqOnly = { id: importId('im', 'Hevy|C0FFEE03'), n: 'my squat', custom: true, eq: 'kettlebell', tg: '' }
    const byHand = { id: 'c123', n: 'grip crusher (cable)', custom: true, eq: 'custom', tg: '' }
    const S = { customEx: [bare, mine, eqOnly, byHand] }
    expect(fillHevyCustomExercises(S, [GRIP, ROW, SQUAT, null, { id: {} }])).toBe(2)
    expect(bare).toMatchObject({ eq: 'cable', tg: 'forearm', primaries: ['forearm'], secondaries: ['lats', 'biceps'], mv: MUSCLE_MODEL })
    expect(mine).toEqual({ id: mine.id, n: 'odd row', custom: true, eq: 'barbell', tg: 'lats', sm: [], primaries: ['lats'], secondaries: [], muscleGroups: ['lats'] })
    expect(eqOnly).toMatchObject({ eq: 'kettlebell', tg: 'quadriceps', primaries: ['quadriceps'] })
    expect(byHand).toEqual({ id: 'c123', n: 'grip crusher (cable)', custom: true, eq: 'custom', tg: '' })
    // Once filled, nothing more to do.
    expect(fillHevyCustomExercises(S, [GRIP, ROW, SQUAT])).toBe(0)
    expect(fillHevyCustomExercises({}, [GRIP])).toBe(0)
  })
})

describe('the Hevy account’s weight unit', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('reads it with the key, and anything that goes wrong is no unit', async () => {
    const seen = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => { seen.push([String(url), opts.headers['api-key']]); return reply({ data: { weight_unit: 'lbs' } }) }))
    expect(await fetchHevyWeightUnit('k')).toBe('lb')
    expect(seen).toEqual([['https://api.hevyapp.com/v1/user/info', 'k']])
    for (const [res, want] of [
      [async () => reply({ data: { weight_unit: 'kg' } }), 'kg'],
      [async () => reply({ data: { weight_unit: 'stone' } }), null],
      [async () => reply({ data: { id: 'u1', name: 'me' } }), null],
      [async () => reply(null), null],
      [async () => ({ ok: false, status: 404, json: async () => ({}) }), null],
      [async () => { throw new TypeError('offline') }, null],
      [async () => ({ ok: true, json: async () => { throw new SyntaxError('html') } }), null],
    ]) {
      vi.stubGlobal('fetch', vi.fn(res))
      expect(await fetchHevyWeightUnit('k')).toBe(want)
    }
  })

  it('gives up after a while rather than holding the import', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const unit = fetchHevyWeightUnit('k')
    await vi.advanceTimersByTimeAsync(20e3)
    expect(await unit).toBe(null)
  })

  it('comes with the import, survives the summary’s re-read, and a failure leaves the import as it was', async () => {
    const T = [{ id: '4E5257DE', title: 'Lat Pulldown - Close Grip (Cable)', type: 'weight_reps', primary_muscle_group: 'lats' }]
    const W = { id: 'w1', title: 'Pull', start_time: '2026-10-14T16:27:30Z', end_time: '2026-10-14T17:40:00Z', exercises: [{ exercise_template_id: '4E5257DE', sets: [{ type: 'normal', weight_kg: 50, reps: 8 }] }] }
    const stub = info => vi.stubGlobal('fetch', vi.fn(async url => {
      const path = new URL(String(url)).pathname
      if (path === '/v1/user/info') return info()
      const key = path.split('/').pop()
      const pages = { exercise_templates: T, workouts: [W], routines: [], body_measurements: [{ date: '2026-10-01', weight_kg: 80, waist: 80 }] }
      return reply({ page_count: 1, [key]: pages[key] })
    }))
    stub(async () => reply({ data: { weight_unit: 'lbs' } }))
    const data = await importHevyData('k', kg)
    expect(data.weightUnit).toBe('lb')
    expect(data.measurements.measurements).toEqual([{ d: '2026-10-01', values: { waist: 80 }, other: [] }])
    expect(data.bodyweight.bodyweight).toHaveLength(1)
    const again = parseHevyAccount(data.raw, { ...kg, from: '2026-10-01' })
    expect(again.weightUnit).toBe('lb')
    expect(again.measurements.measurements).toHaveLength(1)
    expect(parseHevyAccount({ ...data.raw, weightUnit: 'stone' }, kg).weightUnit).toBe(null)

    stub(async () => { throw new TypeError('offline') })
    const plain = await importHevyData('k', kg)
    expect(plain.weightUnit).toBe(null)
    expect(plain.workouts.workouts).toHaveLength(1)
  })
})
