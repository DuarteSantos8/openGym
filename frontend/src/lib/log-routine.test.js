import { describe, expect, it } from 'vitest'
import { buildRoutine, appendRoutine, weekdayOf, findRoutine, editRoutine, applyRoutineEdit } from './log-routine.js'

const profile = (over = {}) => ({ unit: 'kg', routines: [], week: {}, customEx: [], ...over })
const ids = () => 'r-new'
const plan = (over = {}) => ({
  name: 'Forza corpo libero',
  days: ['tuesday', 5],
  exercises: [
    { exercise: '1197', sets: 3, reps: 12 },
    { exercise: '0463', sets: 3, seconds: 25 },
  ],
  ...over,
})

describe('weekdayOf', () => {
  it('reads getDay() numbers and English names, nothing else', () => {
    expect(weekdayOf(0)).toBe(0)
    expect(weekdayOf('Tuesday')).toBe(2)
    expect(weekdayOf(7)).toBeNull()
    expect(weekdayOf('funday')).toBeNull()
    expect(weekdayOf('constructor')).toBeNull()
  })
})

describe('a described routine becomes the routine the Plan screen would save', () => {
  it('reps and holds as the app stores them, on the named days', () => {
    const r = buildRoutine(profile(), plan(), { newId: ids })
    expect(r.problems).toBeUndefined()
    expect(r.routine).toEqual({
      id: 'r-new',
      name: 'Forza corpo libero',
      ex: [{ id: '1197', sets: 3, reps: 12 }, { id: '0463', sets: 3, mode: 'time', sec: 25 }],
    })
    expect(r.week).toEqual({ 2: ['r-new'], 5: ['r-new'] })
  })

  it('does not touch the profile it reads; appendRoutine does', () => {
    const S = profile()
    const r = buildRoutine(S, plan(), { newId: ids })
    expect(S.routines).toEqual([])
    appendRoutine(S, r)
    expect(S.routines.map(x => x.id)).toEqual(['r-new'])
    expect(S.week[2]).toEqual(['r-new'])
  })

  it('a day that already holds a routine keeps it, and days not named stay as they are', () => {
    const S = profile({ routines: [{ id: 'old', name: 'Push', ex: [] }], week: { 2: ['old'], 3: ['old'] } })
    const r = buildRoutine(S, plan(), { newId: ids })
    expect(r.week).toEqual({ 2: ['old', 'r-new'], 3: ['old'], 5: ['r-new'] })
  })

  it('a routine with no days is left off the week', () => {
    const r = buildRoutine(profile(), plan({ days: undefined }), { newId: ids })
    expect(r.week).toEqual({})
  })

  it('weight and rest ride along only when given', () => {
    const r = buildRoutine(profile(), plan({ exercises: [{ exercise: '1197', sets: 3, reps: 8, weight: 20, rest_sec: 90 }] }), { newId: ids })
    expect(r.routine.ex[0]).toEqual({ id: '1197', sets: 3, reps: 8, weight: 20, restSec: 90 })
  })

  it('the same name twice is a duplicate, not a second routine', () => {
    const S = profile({ routines: [{ id: 'old', name: ' forza  CORPO libero ', ex: [] }] })
    expect(buildRoutine(S, plan(), { newId: ids })).toEqual({ duplicate: { id: 'old', name: ' forza  CORPO libero ' } })
  })
})

describe('every problem comes back at once, and nothing is built', () => {
  it('names, days, exercises and numbers', () => {
    const r = buildRoutine(profile(), {
      name: ' ',
      days: ['funday'],
      exercises: [
        { exercise: 'zzzz no such thing', sets: 3, reps: 10 },
        { exercise: '1197', sets: 0, reps: 10 },
        { exercise: '1197', sets: 3 },
        { exercise: '1197', sets: 3, reps: 10, seconds: 20 },
        { exercise: '1197', sets: 3, reps: 1.5 },
      ],
    }, { newId: ids })
    expect(r.routine).toBeUndefined()
    expect(r.problems.map(p => p.field || p.index)).toEqual(['name', 'days', 0, 1, 2, 3, 4])
  })

  it('an empty exercise list is a problem', () => {
    expect(buildRoutine(profile(), plan({ exercises: [] }), { newId: ids }).problems[0].field).toBe('exercises')
  })
})

const saved = () => profile({
  routines: [
    { id: 'a', name: 'Forza A', emoji: '💪', ex: [{ id: '1197', sets: 3, reps: 12, prog: { type: 'linear' }, restSec: 60 }, { id: '0463', sets: 3, mode: 'time', sec: 25 }] },
    { id: 'b', name: 'Push', ex: [{ id: '0493', sets: 3, reps: 8 }] },
  ],
  week: { 2: ['a', 'b'], 5: ['a'] },
})

describe('findRoutine', () => {
  it('by id, or by name when only one has it', () => {
    expect(findRoutine(saved(), 'b').routine.name).toBe('Push')
    expect(findRoutine(saved(), ' forza  a ').routine.id).toBe('a')
  })
  it('says what it could not find, with the routines to pick from', () => {
    const r = findRoutine(saved(), 'nope')
    expect(r.problem).toMatch(/no routine/)
    expect(r.candidates.map(c => c.id)).toEqual(['a', 'b'])
  })
})

describe('editRoutine changes a routine without touching the profile', () => {
  it('renames, re-icons and clears the emoji', () => {
    const S = saved()
    const e = editRoutine(S, { routine: 'a', name: 'Forza B', emoji: '' })
    expect(e.routine.name).toBe('Forza B')
    expect(e.routine.emoji).toBeUndefined()
    expect(e.changed).toEqual(['name', 'emoji'])
    expect(S.routines[0].name).toBe('Forza A')
  })

  it('a name another routine has is refused; the routine\'s own is not a change', () => {
    expect(editRoutine(saved(), { routine: 'a', name: 'push' }).problems[0].field).toBe('name')
    expect(editRoutine(saved(), { routine: 'a', name: 'Forza A' }).changed).toEqual([])
  })

  it('days replace the routine\'s own and leave other routines on those days', () => {
    const e = editRoutine(saved(), { routine: 'a', days: ['monday', 2] })
    expect(e.week).toEqual({ 1: ['a'], 2: ['b', 'a'] })
    expect(editRoutine(saved(), { routine: 'a', days: [] }).week).toEqual({ 2: ['b'] })
  })

  it('exercises replace the list, an exercise it had keeps what is not mentioned, the mode follows the description', () => {
    const e = editRoutine(saved(), { routine: 'a', exercises: [{ exercise: '1197', sets: 4, reps: 10 }, { exercise: '0463', sets: 3, reps: 15 }] })
    expect(e.routine.ex).toEqual([
      { id: '1197', sets: 4, reps: 10, prog: { type: 'linear' }, restSec: 60 },
      { id: '0463', sets: 3, reps: 15 },
    ])
  })

  it('add_exercises appends, remove_exercises drops by name or id', () => {
    const e = editRoutine(saved(), { routine: 'a', add_exercises: [{ exercise: '1241', sets: 3, reps: 8 }], remove_exercises: ['1197'] })
    expect(e.routine.ex.map(x => x.id)).toEqual(['0463', '1241'])
  })

  it('refuses what cannot be done, all at once', () => {
    const e = editRoutine(saved(), {
      routine: 'a',
      remove_exercises: ['bird dog', 'zzzz no such thing'],
      add_exercises: [{ exercise: '1197', sets: 3, reps: 8 }],
      days: ['funday'],
    })
    expect(e.routine).toBeUndefined()
    expect(e.problems.map(p => p.field)).toEqual(['remove_exercises', 'remove_exercises', 'add_exercises', 'days'])
  })

  it('exercises cannot come with add_exercises or remove_exercises, and a routine is never emptied', () => {
    expect(editRoutine(saved(), { routine: 'a', exercises: [{ exercise: '1197', sets: 1, reps: 1 }], remove_exercises: ['1197'] }).problems[0].field).toBe('exercises')
    expect(editRoutine(saved(), { routine: 'b', remove_exercises: ['incline push-up'] }).problems[0].problem).toMatch(/at least one exercise/)
  })

  it('applyRoutineEdit puts the edit into the draft profile', () => {
    const S = saved()
    applyRoutineEdit(S, editRoutine(S, { routine: 'a', name: 'Forza B', days: [3] }))
    expect(S.routines[0].name).toBe('Forza B')
    expect(S.week).toEqual({ 2: ['b'], 3: ['a'] })
  })
})
