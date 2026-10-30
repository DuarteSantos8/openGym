import { describe, it, expect } from 'vitest'
import { OWN, matchKey, aliasMatches, importMatches, pickFor, reviewList, rememberPicks } from './import-matches.js'
import { parseWorkoutCSV } from './import-csv.js'
import { parseImportFile } from './import-apps.js'
import { parseHevyWorkouts, parseHevyRoutines } from './import-hevy.js'
import { EXIDX } from './exercises.js'

const DB_PRESS = '0289'   // Dumbbell Bench Press
const CSV = ['Date,Exercise,Weight,Reps',
  '2026-01-02,Bench Press,60,5',
  '2026-01-02,Grip Trainer Thing,20,10',
  '2026-01-03,bench press,62.5,5'].join('\n')
const parse = (S = {}, picks) => parseWorkoutCSV(CSV, { unit: 'kg', customEx: S.customEx || [], matches: importMatches(S, picks) })
const byName = (p, name) => p.names.find(n => n.key === matchKey(name))

describe('the names a parse reports', () => {
  it('lists each name once, what it became, and whether it is added as your own', () => {
    const p = parse()
    expect(p.names).toHaveLength(2)                         // "bench press" twice is one name
    expect(byName(p, 'Bench Press')).toMatchObject({ name: 'Bench Press', own: false })
    expect(EXIDX[byName(p, 'Bench Press').id]).toBeTruthy()
    expect(byName(p, 'Grip Trainer Thing')).toMatchObject({ own: true })
    expect(reviewList(p).map(n => n.name)).toEqual(['Grip Trainer Thing', 'Bench Press'])   // your own first
  })

  it('lists nothing for an openGym export, which names each exercise by its id', () => {
    const own = ['Date,Workout,Exercise,Exercise ID,Set Type,Weight (kg),Reps', '2026-01-02,Push,Bench Press,0025,normal,60,5'].join('\n')
    expect(parseWorkoutCSV(own, { unit: 'kg' }).names || []).toEqual([])
  })
})

describe('a pick', () => {
  it('moves a name onto the exercise picked, for every row with that name', () => {
    const p = parse({}, { [matchKey('Bench Press')]: DB_PRESS })
    expect(p.workouts.flatMap(w => w.entries.map(e => e.id))).toContain(DB_PRESS)
    expect(p.workouts.every(w => w.entries.filter(e => e.id === DB_PRESS).length <= 1)).toBe(true)
    expect(byName(p, 'Bench Press')).toMatchObject({ id: DB_PRESS, own: false })
  })

  it('keeps a name the library matched as your own exercise', () => {
    const p = parse({}, { [matchKey('Bench Press')]: OWN })
    expect(byName(p, 'Bench Press').own).toBe(true)
    expect(p.unmatchedNames).toContain('Bench Press')
    expect(p.customEx.map(c => c.n)).toContain('bench press')
  })

  it('can point a name at one of your own exercises', () => {
    const mine = { id: 'cx1', n: 'Gripper', custom: true }
    const p = parse({ customEx: [mine] }, { [matchKey('Grip Trainer Thing')]: 'cx1' })
    expect(byName(p, 'Grip Trainer Thing')).toMatchObject({ id: 'cx1', own: false })
    expect(p.customEx).toEqual([])
  })

  it('is no pick when its exercise is gone', () => {
    expect(pickFor(new Map([['bench press', 'nope']]), 'Bench Press', [])).toBe(null)
    expect(pickFor(new Map([['bench press', 'cx9']]), 'Bench Press', [{ id: 'cx1' }])).toBe(null)
    expect(pickFor(new Map([['bench press', DB_PRESS]]), '  BENCH   press ', [])).toBe(DB_PRESS)
  })

  it('works the same in a plan file and in the Hevy API import', () => {
    const presets = JSON.stringify({ folders: [], presetsWithoutFolder: [{ id: 'r1', name: 'Push A', exerciseData: [
      { exerciseName: 'Dumbbell Bench Press', exerciseTypes: 'WR', superset: null, exerciseNotes: '', setsData: [{ setType: 'normal', inputOne: 30, inputTwo: 8 }] }] }] })
    const plans = parseImportFile(presets, { unit: 'kg', matches: new Map([[matchKey('Dumbbell Bench Press'), OWN]]) }).routines
    expect(plans.names).toEqual([expect.objectContaining({ name: 'Dumbbell Bench Press', own: true })])
    expect(plans.routines[0].ex[0].id).not.toBe(DB_PRESS)

    const templates = [{ id: 'T1', title: 'Mystery Press', type: 'weight_reps' }]
    const workouts = [{ id: 'w1', title: 'Push', start_time: '2026-01-02T10:00:00Z', end_time: '2026-01-02T11:00:00Z',
      exercises: [{ exercise_template_id: 'T1', title: 'Mystery Press', sets: [{ type: 'normal', weight_kg: 50, reps: 5 }] }] }]
    const auto = parseHevyWorkouts(workouts, templates, { unit: 'kg' })
    expect(auto.names).toEqual([expect.objectContaining({ name: 'Mystery Press', own: true })])
    const picked = parseHevyWorkouts(workouts, templates, { unit: 'kg', matches: new Map([['mystery press', DB_PRESS]]) })
    expect(picked.workouts[0].entries[0].id).toBe(DB_PRESS)
    expect(picked.names).toEqual([expect.objectContaining({ id: DB_PRESS, own: false })])
    expect(picked.customEx).toEqual([])
    const routines = [{ id: 'r', title: 'R', exercises: [{ exercise_template_id: 'T1', title: 'Mystery Press', sets: [{ type: 'normal', weight_kg: 50, reps: 5 }] }] }]
    expect(parseHevyRoutines(routines, templates, { unit: 'kg', matches: new Map([['mystery press', DB_PRESS]]) }).routines[0].ex[0].id).toBe(DB_PRESS)
  })
})

describe('remembering picks as other names', () => {
  it('adds the name to the exercise picked, and the next import reads it from there', () => {
    const S = { exAliases: {}, customEx: [] }
    const names = new Map([[matchKey('Bench Press'), 'Bench Press']])
    rememberPicks(S, { [matchKey('Bench Press')]: DB_PRESS }, names)
    expect(S.exAliases[DB_PRESS]).toContain('Bench Press')
    expect(byName(parse(S), 'Bench Press').id).toBe(DB_PRESS)
  })

  it('moves a name from one exercise to another, and OWN or undo takes it off', () => {
    const S = { exAliases: { [DB_PRESS]: ['Bench Press', 'DB bench'] }, customEx: [{ id: 'cx1', n: 'Gripper', aliases: ['bench press'] }] }
    const names = new Map([[matchKey('Bench Press'), 'Bench Press']])
    rememberPicks(S, { [matchKey('Bench Press')]: 'cx1' }, names)
    expect(S.exAliases[DB_PRESS]).toEqual(['DB bench'])
    expect(S.customEx[0].aliases).toEqual(['Bench Press'])
    rememberPicks(S, { [matchKey('Bench Press')]: OWN }, names)
    expect(S.customEx[0].aliases).toEqual([])
    expect(aliasMatches(S).has('bench press')).toBe(false)
  })

  it('leaves the other names alone when nothing was picked', () => {
    const S = { exAliases: { [DB_PRESS]: ['DB bench'] } }
    rememberPicks(S, {}, new Map())
    expect(S).toEqual({ exAliases: { [DB_PRESS]: ['DB bench'] } })
  })

  it('ignores a name two exercises share, and lets this import’s undo drop a remembered one', () => {
    const S = { exAliases: { [DB_PRESS]: ['Press'], '0025': ['press'] } }
    expect(aliasMatches(S).has('press')).toBe(false)
    const one = { exAliases: { [DB_PRESS]: ['Bench Press'] } }
    expect(importMatches(one).get('bench press')).toBe(DB_PRESS)
    expect(importMatches(one, { 'bench press': null }).has('bench press')).toBe(false)
  })
})
