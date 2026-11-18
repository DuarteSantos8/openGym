import { describe, expect, it } from 'vitest'
import { parseWorkoutCSV, mergeImport, matchExercise } from './import-csv.js'
import { parseImportFile } from './import-apps.js'
import { parseHevyWorkouts, parseHevyRoutines, parseHevyAccount } from './import-hevy.js'
import { aliasMatches, choiceOpts, combineNames, nameKey, pickFor, rememberPicks } from './import-choices.js'
import { EXIDX } from './exercises.js'

// #931 (check each exercise's match before importing, remember the pick) and #849 (choose what
// comes along: exercises, dates, notes, effort). Every parser reads the same options.
const HEAD = 'Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Seconds,Notes,Workout Notes,RPE'
const CSV = [HEAD,
  '2026-01-02 10:00:00,Push,Bench Press (Barbell),1,60,5,0,felt heavy,good day,8',
  '2026-01-02 10:00:00,Push,Bench Press (Barbell),2,60,5,0,,good day,8.5',
  '2026-01-02 10:00:00,Push,Grip Crusher Thing,1,20,10,0,,good day,',
  '2026-01-09 10:00:00,Push,Bench Press (Barbell),1,62.5,5,0,,,',
  '2026-01-16 10:00:00,Legs,Squat (Barbell),1,100,5,0,,,',
].join('\n')
const bench = matchExercise('Bench Press (Barbell)')
const squat = matchExercise('Squat (Barbell)')
const S0 = () => ({ unit: 'kg', workouts: [], customEx: [], exWeights: {}, exAliases: {} })

describe('the names a parse reports', () => {
  it('lists every exercise once with its sets, workouts and match', () => {
    const p = parseWorkoutCSV(CSV, { unit: 'kg' })
    const by = Object.fromEntries(p.names.map(n => [n.key, n]))
    expect(by['bench press (barbell)']).toMatchObject({ id: bench, auto: bench, sets: 3, workouts: 2 })
    expect(by['grip crusher thing'].id).toMatch(/^im/)
    expect(p.excluded).toBe(0)
    expect(p.notesSeen).toBeGreaterThan(0)
    expect(p.effortSeen).toBe(2)
  })

  it('combines history and plan names, most sets first', () => {
    const list = combineNames(
      [{ key: 'a', name: 'A', id: '1', sets: 2, workouts: 1 }, { key: 'b', name: 'B', id: '2', sets: 5, workouts: 2 }],
      [{ key: 'a', name: 'A', id: '1', sets: 0, workouts: 0 }, { key: 'c', name: 'C', id: '3', sets: 0, workouts: 0 }])
    expect(list.map(x => x.key)).toEqual(['b', 'a', 'c'])
  })
})

describe('picking a match (#931)', () => {
  it('puts a name on the exercise you picked, ahead of the automatic match', () => {
    const p = parseWorkoutCSV(CSV, { unit: 'kg', matches: new Map([['bench press (barbell)', squat]]) })
    expect(p.workouts[0].entries.map(e => e.id)).toContain(squat)
    expect(p.workouts.flatMap(w => w.entries.map(e => e.id))).not.toContain(bench)
    const n = p.names.find(x => x.key === 'bench press (barbell)')
    expect(n).toMatchObject({ id: squat, auto: bench })
  })

  it('keeps a matched name as your own exercise when asked', () => {
    const p = parseWorkoutCSV(CSV, { unit: 'kg', matches: new Map([['squat (barbell)', null]]) })
    const id = p.workouts.at(-1).entries[0].id
    expect(id).toMatch(/^im/)
    expect(p.customEx.map(c => c.id)).toContain(id)
    expect(p.unmatchedNames).toContain('Squat (Barbell)')
  })

  it('ignores a pick of an exercise that no longer exists', () => {
    expect(pickFor(new Map([['x', 'gone-id']]), 'X', [])).toBeUndefined()
    expect(pickFor(new Map([['x', 'c1']]), 'X', [{ id: 'c1', n: 'mine' }])).toBe('c1')
    expect(pickFor(new Map([['x', null]]), ' x ', [])).toBeNull()
  })

  it('remembers a pick as another name, and the next import follows it', () => {
    const S = S0()
    rememberPicks(S, new Map([['bench press (barbell)', { name: 'Bench Press (Barbell)', id: squat }]]))
    expect(S.exAliases[squat]).toEqual(['Bench Press (Barbell)'])
    expect(aliasMatches(S).get('bench press (barbell)')).toBe(squat)
    const again = parseWorkoutCSV(CSV, choiceOpts(S, {}))
    expect(again.workouts[0].entries[0].id).toBe(squat)
  })

  it('takes the name back off on "keep as your own" or "automatic"', () => {
    const S = S0()
    S.exAliases = { [squat]: ['Bench Press (Barbell)', 'Back squat'] }
    S.customEx = [{ id: 'c1', n: 'grip', aliases: ['Bench Press (Barbell)'] }]
    rememberPicks(S, new Map([['bench press (barbell)', { name: 'Bench Press (Barbell)', id: 'auto' }]]))
    expect(S.exAliases[squat]).toEqual(['Back squat'])
    expect(S.customEx[0].aliases).toEqual([])
    // and "automatic" overrides a remembered pick for this parse already
    S.exAliases = { [squat]: ['Bench Press (Barbell)'] }
    const p = parseWorkoutCSV(CSV, choiceOpts(S, { picks: new Map([['bench press (barbell)', { name: 'x', id: 'auto' }]]) }))
    expect(p.workouts[0].entries[0].id).toBe(bench)
  })

  it('remembers a pick of your own exercise on that exercise', () => {
    const S = S0()
    S.customEx = [{ id: 'c1', n: 'grip', custom: true }]
    rememberPicks(S, new Map([['grip crusher thing', { name: 'Grip Crusher Thing', id: 'c1' }]]))
    expect(S.customEx[0].aliases).toEqual(['Grip Crusher Thing'])
    expect(aliasMatches(S).get(nameKey('Grip Crusher Thing'))).toBe('c1')
  })
})

describe('choosing what comes along (#849)', () => {
  it('leaves an unticked exercise out, and the exercise of your own it would have made', () => {
    const p = parseWorkoutCSV(CSV, { unit: 'kg', skip: new Set(['grip crusher thing']) })
    expect(p.customEx).toEqual([])
    expect(p.created).toBe(0)
    expect(p.sets).toBe(4)
    expect(p.excluded).toBe(1)
    // still listed, so it can be ticked again
    expect(p.names.find(n => n.key === 'grip crusher thing').sets).toBe(1)
  })

  it('drops a workout left with nothing, and the matched count follows', () => {
    const p = parseWorkoutCSV(CSV, { unit: 'kg', skip: new Set(['squat (barbell)']) })
    expect(p.workouts).toHaveLength(2)
    expect(p.matchedIds).not.toContain(squat)
    expect(p.to).toBe('2026-01-09')
  })

  it('keeps only the chosen dates', () => {
    const p = parseWorkoutCSV(CSV, { unit: 'kg', from: '2026-01-05', to: '2026-01-10' })
    expect(p.workouts.map(w => w.d)).toEqual(['2026-01-09'])
    expect(p.excluded).toBe(4)
  })

  it('leaves notes and effort ratings behind when switched off', () => {
    const p = parseWorkoutCSV(CSV, { unit: 'kg', notes: false, effort: false })
    expect(p.workouts[0].note).toBeUndefined()
    expect(p.workouts[0].entries.some(e => e.note)).toBe(false)
    expect(p.workouts[0].entries[0].sets.some(s => s.rpe != null)).toBe(false)
    expect(p.rpeSets).toBe(0)
    // the switches stay on screen: the file still has them
    expect(p.notesSeen).toBeGreaterThan(0)
    expect(p.effortSeen).toBe(2)
    const on = parseWorkoutCSV(CSV, { unit: 'kg' })
    expect(on.workouts[0].note).toBe('good day')
  })

  it('merges only what was chosen', () => {
    const S = S0()
    const p = parseWorkoutCSV(CSV, { unit: 'kg', skip: new Set(['grip crusher thing']) })
    mergeImport(S, p)
    expect(S.customEx).toEqual([])
    expect(S.workouts).toHaveLength(3)
  })

  it('goes through the other apps’ readers too', () => {
    // A Liftoff preset file: plans only, resolved with the picks.
    const presets = [{ id: 'p1', name: 'Day A', exerciseData: [{ exerciseName: 'Bench Press', exerciseTypes: 'WR', setsData: [{ setType: 'normal', inputOne: 50, inputTwo: 8 }] }] }]
    const p = parseImportFile(JSON.stringify(presets), { unit: 'kg', matches: new Map([['bench press', squat]]) })
    expect(p.routines.routines[0].ex[0].id).toBe(squat)
    expect(p.routines.names[0]).toMatchObject({ key: 'bench press', id: squat })
  })
})

/* -------------------------------------------------------------- Hevy API -- */
const TEMPLATES = [
  { id: 'T1', title: 'Mystery Press', type: 'weight_reps', primary_muscle_group: 'chest' },
  { id: 'T2', title: 'Odd Row', type: 'weight_reps', primary_muscle_group: 'lats' },
]
const W = (id, day, ex) => ({ id, title: 'Push', description: 'Slept badly, still fine.', start_time: `${day}T10:00:00`, end_time: `${day}T11:00:00`, exercises: ex })
const E = (tid, title, notes, sets) => ({ exercise_template_id: tid, title, notes, sets })
const WORKOUTS = [
  W('w1', '2026-02-01', [E('T1', 'Mystery Press', 'Elbows in', [{ type: 'normal', weight_kg: 40, reps: 8, rpe: 8 }]), E('T2', 'Odd Row', null, [{ type: 'normal', weight_kg: 30, reps: 10 }])]),
  W('w2', '2026-02-08', [E('T1', 'Mystery Press', '', [{ type: 'normal', weight_kg: 42, reps: 8 }])]),
]

describe('the Hevy API import (#815)', () => {
  it('keeps the workout description and the exercise notes', () => {
    const p = parseHevyWorkouts(WORKOUTS, TEMPLATES)
    expect(p.workouts[0].note).toBe('Slept badly, still fine.')
    expect(p.workouts[0].entries[0].note).toBe('Elbows in')
    expect(p.workouts[0].entries[1].note).toBeUndefined()
    expect(parseHevyWorkouts(WORKOUTS, TEMPLATES, { notes: false }).workouts[0].note).toBeUndefined()
  })

  it('reads a routine’s rest and rep range', () => {
    const routines = [{ id: 'r1', title: 'Push', exercises: [
      E('T1', 'Mystery Press', null, [{ type: 'normal', weight_kg: 40, reps: null, rep_range: { start: 8, end: 12 } }]),
      E('T2', 'Odd Row', null, [{ type: 'normal', weight_kg: 30, reps: null, rep_range: { start: 10, end: 10 } }]),
    ].map((e, i) => ({ ...e, rest_seconds: i ? 0 : 120 })) }]
    const [a, b] = parseHevyRoutines(routines, TEMPLATES).routines[0].ex
    expect(a).toMatchObject({ reps: 12, repsMin: 8, prog: 'double', restSec: 120 })
    expect(b.reps).toBe(10)
    expect(b.repsMin).toBeUndefined()
    expect(b.restSec).toBeUndefined()
  })

  it('takes the picks, the ticks and the dates', () => {
    const p = parseHevyWorkouts(WORKOUTS, TEMPLATES, { matches: new Map([['mystery press', bench]]), skip: new Set(['odd row']), from: '2026-02-05' })
    expect(p.workouts).toHaveLength(1)
    expect(p.workouts[0].entries.map(e => e.id)).toEqual([bench])
    expect(p.customEx).toEqual([])
    expect(p.names.find(n => n.key === 'mystery press')).toMatchObject({ id: bench, sets: 1 })
  })

  it('reads the fetched account again without asking Hevy', () => {
    const raw = { templates: TEMPLATES, workouts: WORKOUTS, routines: [], bodyMeasurements: [] }
    const v = parseHevyAccount(raw, { unit: 'kg', effort: false })
    expect(v.raw).toBe(raw)
    expect(v.workouts.rpeSets).toBe(0)
    expect(v.workouts.effortSeen).toBe(1)
    expect(EXIDX[bench]).toBeTruthy()
  })
})

// Found on the way: Strong's "Lat Pulldown (Cable)" missed the 'lat pulldown' alias (the bag has
// "cable" in it) and fell to five near ties, so the most common pulldown became a custom exercise.
describe('Strong’s bracketed pulldowns', () => {
  it('match the lat pulldown', () => {
    expect(matchExercise('Lat Pulldown (Cable)')).toBe('2330')
    expect(EXIDX[matchExercise('Lat Pulldown (Machine)')].n).toMatch(/pulldown/)
  })
})
