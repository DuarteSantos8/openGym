/* A name the 1,324-exercise catalogue did not know was imported as a custom exercise (an `im…`
   id). The new catalogue may know it, and the next import of the same account matched it afresh:
   new days on the catalogue id, old ones on the custom one, one exercise's history in two. An
   exercise the user already has keeps its id. */
import { describe, expect, it } from 'vitest'
import { importId, matchExercise, mergeImport, parseWorkoutCSV } from './import-csv.js'
import { HEVY_ID_MAP, mergeHevyRoutines, parseHevyRoutines, parseHevyWorkouts } from './import-hevy.js'
import { EXIDX } from './exercises.js'

const base = customEx => ({ _ts: 1, workouts: [], customEx, bodyweight: [], exWeights: {}, routines: [] })
const custom = (id, n) => ({ id, n, custom: true, eq: 'custom', tg: '', desc: '', bp: 'chest' })
const ids = S => new Set(S.workouts.flatMap(w => (w.exposures || w.entries).map(e => e.exerciseId || e.id)))

const CSV = day => [
  'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE',
  `${day} 18:00:00,Push,1h,Bench Press (Barbell),1,80,5,0,0,,,`,
].join('\n')

describe('re-importing an exercise an earlier import made a custom one', () => {
  it('the catalogue knows the name now; the custom one keeps the history', () => {
    expect(EXIDX[matchExercise('Bench Press (Barbell)')]).toBeTruthy()
    const own = custom(importId('im', 'Strong|bench press (barbell)'), 'bench press (barbell)')
    const S = base([own])
    S.workouts = [{ id: 'w0', d: '2026-08-01', entries: [{ id: own.id, sets: [{ w: 75, r: 5 }] }] }]
    const parsed = parseWorkoutCSV(CSV('2026-09-01'), { unit: 'kg', customEx: S.customEx })
    expect(parsed.customEx).toEqual([])
    mergeImport(S, parsed)
    expect(ids(S)).toEqual(new Set([own.id]))
    expect(S.customEx).toEqual([own])
  })

  it('found by its name too, renamed only in case and spacing, whatever id it got', () => {
    const own = custom('k3x9old', 'Bench  Press (barbell)')
    const S = base([own])
    mergeImport(S, parseWorkoutCSV(CSV('2026-09-01'), { unit: 'kg', customEx: S.customEx }))
    expect(ids(S)).toEqual(new Set(['k3x9old']))
  })

  it('without a custom one of that name it is matched as before', () => {
    const S = base([])
    mergeImport(S, parseWorkoutCSV(CSV('2026-09-01'), { unit: 'kg', customEx: S.customEx }))
    expect(ids(S)).toEqual(new Set([matchExercise('Bench Press (Barbell)')]))
  })

  it('Hevy: a template the id map has learnt since stays on the custom exercise it was imported as', () => {
    const hid = Object.keys(HEVY_ID_MAP).find(k => EXIDX[HEVY_ID_MAP[k]])
    const templates = [{ id: hid, title: 'Some Lift', type: 'weight_reps', primary_muscle_group: 'chest' }]
    const own = custom(importId('im', 'Hevy|' + hid), 'renamed by the user')
    const S = base([own])
    const workout = {
      id: 'w1', title: 'Push', start_time: '2026-09-01T10:00:00+00:00', end_time: '2026-09-01T11:00:00+00:00',
      exercises: [{ title: 'Some Lift', exercise_template_id: hid, sets: [{ type: 'normal', weight_kg: 50, reps: 8 }] }],
    }
    const parsed = parseHevyWorkouts([workout], templates, { customEx: S.customEx })
    mergeImport(S, parsed)
    expect(ids(S)).toEqual(new Set([own.id]))
    const routines = parseHevyRoutines([{ id: 'r1', title: 'Push', exercises: [{ exercise_template_id: hid, title: 'Some Lift', sets: [{ type: 'normal', reps: 8 }] }] }], templates, { customEx: S.customEx })
    mergeHevyRoutines(S, routines)
    expect(S.routines[0].ex.map(e => e.exerciseId)).toEqual([own.id])
    expect(S.customEx).toEqual([own])
  })
})
