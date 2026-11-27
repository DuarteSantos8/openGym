import { afterEach, describe, expect, it } from 'vitest'
import { _setLangState } from './i18n-core.js'
import { readTypedLine, readTypedWorkout, splitTypedLine, matchTypedName, typedWorkoutInput } from './typed-workout.js'
import { buildLoggedWorkout, appendLoggedWorkout, findDuplicate, LOG_LIMITS } from './log-workout.js'

const profile = (over = {}) => ({ unit: 'kg', workouts: [], routines: [], customEx: [], exAliases: {}, exWeights: {}, deleted: {}, edited: {}, ...over })
// The sets a line was read as, without the line itself.
const sets = line => readTypedLine(line).sets
const one = (S, line) => typedWorkoutInput(S, readTypedWorkout(line)).rows[0]
const rep = (n, set) => Array.from({ length: n }, () => set)

describe('reading a line: name and sets', () => {
  it('the name is everything before the first number, list markers and colons off', () => {
    expect(splitTypedLine('Bench press 60x8')).toEqual({ name: 'Bench press', rest: '60x8' })
    expect(splitTypedLine('- Squat: 100kg 5x5')).toEqual({ name: 'Squat', rest: '100kg 5x5' })
    expect(splitTypedLine('2. Pull-ups 3x8')).toEqual({ name: 'Pull-ups', rest: '3x8' })
    expect(splitTypedLine('Dips bw x 12')).toEqual({ name: 'Dips', rest: 'bw x 12' })
    expect(splitTypedLine('Squat – 5x5').name).toBe('Squat')
  })

  it('weight x reps, a list of them', () => {
    expect(sets('Bench press 60x8, 60x8, 62.5x6')).toEqual([{ w: 60, u: null, reps: 8 }, { w: 60, u: null, reps: 8 }, { w: 62.5, u: null, reps: 6 }])
    expect(sets('Bench 60kg x 8 / 70kg x 5')).toEqual([{ w: 60, u: 'kg', reps: 8 }, { w: 70, u: 'kg', reps: 5 }])
    expect(sets('Bench 60kgx8')).toEqual([{ w: 60, u: 'kg', reps: 8 }])
    expect(sets('Bench 60×8 + 70*5')).toEqual([{ w: 60, u: null, reps: 8 }, { w: 70, u: null, reps: 5 }])
  })

  it('a weight and then sets x reps, in either order', () => {
    expect(sets('Squat 100kg 5x5')).toEqual(rep(5, { w: 100, u: 'kg', reps: 5 }))
    expect(sets('Squat 100 5x5')).toEqual(rep(5, { w: 100, u: null, reps: 5 }))
    expect(sets('Squat 5x5 100kg')).toEqual(rep(5, { w: 100, u: 'kg', reps: 5 }))
    expect(sets('Squat 5x5 100')).toEqual(rep(5, { w: 100, u: null, reps: 5 }))
    expect(sets('Squat 5x5 @ 100')).toEqual(rep(5, { w: 100, u: null, reps: 5 }))
    expect(sets('Squat 3x5 at 100 kg')).toEqual(rep(3, { w: 100, u: 'kg', reps: 5 }))
  })

  it('three numbers: weight x reps x sets, or sets x reps x a weight', () => {
    expect(sets('Bench 60x8x3')).toEqual(rep(3, { w: 60, u: null, reps: 8 }))
    expect(sets('Bench 50kg x 12 x 3')).toEqual(rep(3, { w: 50, u: 'kg', reps: 12 }))
    expect(sets('Bench 3x8x60kg')).toEqual(rep(3, { w: 60, u: 'kg', reps: 8 }))
    expect(sets('Bench 3x8x60')).toEqual(rep(3, { w: 60, u: null, reps: 8 }))
  })

  it('a weight said once covers the reps after it', () => {
    expect(sets('Dumbbell curl 12 kg: 12, 12, 10')).toEqual([{ w: 12, u: 'kg', reps: 12 }, { w: 12, u: 'kg', reps: 12 }, { w: 12, u: 'kg', reps: 10 }])
    expect(sets('Curl 12kg 3x10')).toEqual(rep(3, { w: 12, u: 'kg', reps: 10 }))
    expect(sets('Curl 8, 8, 6 @ 20')).toEqual([{ w: 20, u: null, reps: 8 }, { w: 20, u: null, reps: 8 }, { w: 20, u: null, reps: 6 }])
    // a weight that no reps took is a set still missing its reps, not a weight that vanished
    expect(sets('Bench 60kg x 8, 80kg')).toEqual([{ w: 60, u: 'kg', reps: 8 }, { w: 80, u: 'kg', reps: null }])
    expect(sets('Squat 100kg')).toEqual([{ w: 100, u: 'kg', reps: null }])
  })

  it('bare sets x reps is a body-weight lift; a bigger first number is a weight', () => {
    expect(sets('Pull-ups 3x8')).toEqual(rep(3, { reps: 8 }))
    expect(sets('Push-ups 10x10')).toEqual(rep(10, { reps: 10 }))
    expect(sets('Curl 12x10')).toEqual([{ w: 12, u: null, reps: 10 }])
    expect(sets('Curl 12.5x10')).toEqual([{ w: 12.5, u: null, reps: 10 }])
    expect(sets('Pull-ups 3 sets x 8')).toEqual(rep(3, { reps: 8 }))
    expect(sets('Pull-ups 8 reps x 3')).toEqual(rep(3, { reps: 8 }))
    expect(sets('Lat pulldown 3 sets of 10 @ 50')).toEqual(rep(3, { w: 50, u: null, reps: 10 }))
    expect(sets('Curl 15 12')).toEqual([{ w: 15, u: null, reps: 12 }])
  })

  it('body weight, spelt out or short', () => {
    expect(sets('Dips bw x 12')).toEqual([{ w: 0, bw: true, reps: 12 }])
    expect(sets('Dips bodyweight 3x10')).toEqual(rep(3, { w: 0, bw: true, reps: 10 }))
    expect(sets('Dips body weight: 12, 10')).toEqual([{ w: 0, bw: true, reps: 12 }, { w: 0, bw: true, reps: 10 }])
    expect(sets('Dips 3x10 bw')).toEqual(rep(3, { w: 0, bw: true, reps: 10 }))
  })

  it('pounds and kilos, words and all', () => {
    expect(sets('Bench 135 lbs 3x5')).toEqual(rep(3, { w: 135, u: 'lb', reps: 5 }))
    expect(sets('Bench 135lb x 5')).toEqual([{ w: 135, u: 'lb', reps: 5 }])
    expect(sets('Bench 60 kilos x 5')).toEqual([{ w: 60, u: 'kg', reps: 5 }])
    expect(sets('Bench 225 pounds x 3')).toEqual([{ w: 225, u: 'lb', reps: 3 }])
  })

  it('decimal commas, as most of Europe types them, and groups split by commas', () => {
    expect(sets('Bankdrücken 62,5x6')).toEqual([{ w: 62.5, u: null, reps: 6 }])
    expect(sets('Bankdrücken 60x8, 62,5x6')).toEqual([{ w: 60, u: null, reps: 8 }, { w: 62.5, u: null, reps: 6 }])
    expect(sets('Curl 22,5 kg: 10, 10')).toEqual([{ w: 22.5, u: 'kg', reps: 10 }, { w: 22.5, u: 'kg', reps: 10 }])
    expect(sets('Développé 3x8 @ 42,5')).toEqual(rep(3, { w: 42.5, u: null, reps: 8 }))
    expect(sets('Curl 12 kg: 12,12,10')).toEqual([{ w: 12, u: 'kg', reps: 12 }, { w: 12, u: 'kg', reps: 12 }, { w: 12, u: 'kg', reps: 10 }])
  })

  it('timed sets: seconds, minutes and clock times', () => {
    expect(sets('Plank 3x60s')).toEqual(rep(3, { sec: 60 }))
    expect(sets('Plank 60s x 3')).toEqual(rep(3, { sec: 60 }))
    expect(sets('Plank 2 x 1:30')).toEqual(rep(2, { sec: 90 }))
    expect(sets('Plank 45 sec, 40 sec')).toEqual([{ sec: 45 }, { sec: 40 }])
    expect(sets('Dead hang 2x1 min')).toEqual(rep(2, { min: 1 }))
  })

  it('cardio: minutes, a distance, in either order', () => {
    expect(sets('Treadmill 20 min 3 km')).toEqual([{ min: 20, dist: 3, du: 'km' }])
    expect(sets('Run 5 km 25:00')).toEqual([{ sec: 1500, dist: 5, du: 'km' }])
    expect(sets('Run 3 miles 30 mins')).toEqual([{ min: 30, dist: 3, du: 'mi' }])
    expect(sets('Rower 2000 meters 8 min')).toEqual([{ dist: 2, du: 'km', min: 8 }])
    expect(sets('Bike 1 h')).toEqual([{ min: 60 }])
    expect(sets('Treadmill 1,5 km')).toEqual([{ dist: 1.5, du: 'km' }])
  })

  it('effort after a group goes on that group', () => {
    expect(sets('Bench 100x5 rpe 8, 100x5 rpe 9')).toEqual([{ w: 100, u: null, reps: 5, rpe: 8 }, { w: 100, u: null, reps: 5, rpe: 9 }])
    expect(sets('Row 60x8, 70x6 rir 2')).toEqual([{ w: 60, u: null, reps: 8 }, { w: 70, u: null, reps: 6, rir: 2 }])
  })

  it('leftover words are a note, leftover numbers and signs are unread', () => {
    expect(readTypedLine('Squat 3x5 100 felt heavy')).toMatchObject({ sets: rep(3, { w: 100, u: null, reps: 5 }), words: ['felt', 'heavy'], unread: [] })
    expect(readTypedLine('Row 60x8-10').unread).toEqual(['-'])
    expect(readTypedLine('Row 60x8 ~').unread).toEqual(['~'])
    expect(readTypedLine('Row 3rd set').unread.length).toBeGreaterThan(0)
  })

  it('a workout: lines on new lines or ";", blank lines skipped, one past the limit kept', () => {
    const lines = readTypedWorkout('Bench 60x8\n\n  \nSquat 5x5 100; Plank 3x60s\n')
    expect(lines.map(l => l.name)).toEqual(['Bench', 'Squat', 'Plank'])
    const many = readTypedWorkout(Array.from({ length: 60 }, (_, i) => `Curl ${i + 1}x10`).join('\n'))
    expect(many).toHaveLength(LOG_LIMITS.maxExercises + 1)
    expect(readTypedLine('Push-ups 99x10').sets.length).toBeLessThanOrEqual(LOG_LIMITS.maxSets + 1)
  })
})

describe('matching the name', () => {
  it('gym names land on the everyday lift', () => {
    const S = profile()
    expect(matchTypedName(S, 'Bench press').id).toBe('0025')
    expect(matchTypedName(S, 'bench').id).toBe('0025')
    expect(matchTypedName(S, 'Squat').id).toBe('0043')
    expect(matchTypedName(S, 'Pull-ups').id).toBe('0652')
    expect(matchTypedName(S, 'Plank').id).toBe('0463')
    expect(matchTypedName(S, 'Dumbbell curl').id).toBe('0294')
    expect(matchTypedName(S, 'RDL').id).toBe('0085')
  })

  it('one you have trained beats the catalogue’s first pick', () => {
    const S = profile({ workouts: [{ id: 'w1', d: '2026-11-01', entries: [{ id: '0289', sets: [{ w: 20, r: 10, done: true }] }] }] })
    expect(matchTypedName(S, 'bench').id).toBe('0289')
  })

  it('your own names come first: an other name, an own exercise', () => {
    const S = profile({ exAliases: { '0032': ['the big pull'] }, customEx: [{ id: 'c1', n: 'Hotel gym press', custom: true, bp: 'chest', eq: 'custom' }] })
    expect(matchTypedName(S, 'The big pull').id).toBe('0032')
    expect(matchTypedName(S, 'hotel gym press').id).toBe('c1')
  })

  it('the name as the app shows it in your language: a German line, decimal comma and all', () => {
    _setLangState('de', {}, null, { '0025': 'Bankdrücken mit der Langhantel' })
    const q = typedWorkoutInput(profile(), readTypedWorkout('Bankdrücken 60x8, 62,5x6'))
    expect(q.rows[0]).toMatchObject({ id: '0025', problem: null, sets: [{ reps: 8, weight: 60 }, { reps: 6, weight: 62.5 }] })
  })
  afterEach(() => _setLangState('en', null, null, null))

  it('nothing found is no match, not a guess', () => {
    expect(matchTypedName(profile(), 'qwzxv').id).toBe(null)
    expect(matchTypedName(profile(), '').id).toBe(null)
  })
})

describe('the rows the sheet shows and the input it saves', () => {
  const S = profile()

  it('every line read cleanly is ready, in the profile’s unit', () => {
    const q = typedWorkoutInput(S, readTypedWorkout('Bench press 60x8, 60x8, 62.5x6\nSquat 100kg 5x5\nPlank 3x60s\nTreadmill 20 min 3 km'))
    expect(q.ready).toBe(true)
    expect(q.rows.map(r => r.problem)).toEqual([null, null, null, null])
    expect(q.input.unit).toBe('kg')
    expect(q.input.exercises[0]).toEqual({ exercise: '0025', sets: [{ reps: 8, weight: 60 }, { reps: 8, weight: 60 }, { reps: 6, weight: 62.5 }] })
    expect(q.input.exercises[2].sets).toEqual(rep(3, { seconds: 60 }))
    expect(q.input.exercises[3].sets).toEqual([{ minutes: 20, distance: 3 }])
  })

  it('pounds on a kilo profile and kilos on a pound profile are converted', () => {
    expect(one(S, 'Bench 135 lbs x 5').sets).toEqual([{ reps: 5, weight: 61.2 }])
    expect(one(profile({ unit: 'lb' }), 'Bench 100 kg x 5').sets).toEqual([{ reps: 5, weight: 220.5 }])
    expect(one(profile({ unit: 'lb' }), 'Bench 185x5').sets).toEqual([{ reps: 5, weight: 185 }])
  })

  it('a hold counts seconds even without the "s"', () => {
    expect(one(S, 'Plank 3x45')).toMatchObject({ problem: null, mode: 'time', sets: rep(3, { seconds: 45 }) })
  })

  it('miles on a km profile become km', () => {
    expect(one(S, 'Run 30 min 3 mi').sets).toEqual([{ minutes: 30, distance: 4.83 }])
  })

  it('says what is wrong with a line', () => {
    expect(one(S, 'Squat 100kg').problem).toBe('reps')
    expect(one(S, 'qwzxv 3x10').problem).toBe('match')
    expect(one(S, 'Row 60x8-10').problem).toBe('unread')
    expect(one(S, 'Bench press').problem).toBe('sets')
    // no number at all: the whole line is the name, and no exercise is called that
    expect(one(S, 'Bench press felt great').problem).toBe('match')
    expect(one(S, '60x8').problem).toBe('name')
    expect(one(S, 'Treadmill 3x10').problem).toBe('cardio')
    expect(one(S, 'Treadmill 3 km').problem).toBe('time')
    expect(one(S, 'Bench 60x8, 30s').problem).toBe('mixed')
    expect(one(S, 'Bench 3 km').problem).toBe('mixed')
    expect(one(S, 'Bench 3000kg x 1').problem).toBe('limit')
    expect(one(S, 'Bench 60x2000').problem).toBe('limit')
    expect(one(S, 'Push-ups 60x10, ' + Array.from({ length: 55 }, () => '10x10').join(', ')).problem).toBe('limit')
    const q = typedWorkoutInput(S, readTypedWorkout('Bench 60x8\nSquat 100kg'))
    expect(q.ready).toBe(false)
    expect(q.input.exercises).toHaveLength(1)
  })

  it('a pick in the sheet beats the match, kept by the typed name', () => {
    const lines = readTypedWorkout('bench 60x8\nSquat 5x5 100')
    const q = typedWorkoutInput(S, lines, { picks: { bench: '0289' } })
    expect(q.rows[0].id).toBe('0289')
    // a pick of an exercise that no longer exists is no pick
    expect(typedWorkoutInput(S, lines, { picks: { bench: 'gone' } }).rows[0].id).toBe('0025')
  })

  it('words besides the sets become the exercise’s note', () => {
    const q = typedWorkoutInput(S, readTypedWorkout('Squat 5x5 100 felt heavy'))
    expect(q.input.exercises[0].note).toBe('felt heavy')
  })

  it('no lines, nothing to save', () => {
    expect(typedWorkoutInput(S, readTypedWorkout('')).ready).toBe(false)
    expect(typedWorkoutInput(S, readTypedWorkout('\n \n')).rows).toEqual([])
  })
})

describe('saved the way log_workout saves', () => {
  const NOW = new Date('2026-10-20T19:30:00').getTime()
  const input = (S, text) => ({ ...typedWorkoutInput(S, readTypedWorkout(text)).input, date: '2026-10-18', start: '18:00', durationMin: 60, name: 'Freestyle' })

  it('a past day: filed in order, body weight as 0, the hold timed', () => {
    const S = profile()
    const built = buildLoggedWorkout(S, input(S, 'Bench press 60x8, 62.5x6\nDips bw x 12\nPlank 2x60s'), { now: NOW })
    expect(built.problems).toBeUndefined()
    expect(built.past).toBe(true)
    expect(built.workout.entries.map(e => e.id)).toEqual(['0025', '0814', '0463'])
    expect(built.workout.entries[0].sets).toEqual([{ w: 60, r: 8, done: true }, { w: 62.5, r: 6, done: true }])
    expect(built.workout.entries[1].sets).toEqual([{ w: 0, r: 12, done: true }])
    expect(built.workout.entries[2].sets.map(s => s.sec)).toEqual([60, 60])
    expect(appendLoggedWorkout(S, built, { now: NOW }).added).toBe(true)
    expect(S.workouts).toHaveLength(1)
    expect(S.workouts[0].d).toBe('2026-10-18')
  })

  it('the same text twice is a duplicate, not a second workout', () => {
    const S = profile()
    const first = buildLoggedWorkout(S, input(S, 'Squat 100kg 5x5'), { now: NOW })
    appendLoggedWorkout(S, first, { now: NOW })
    const again = buildLoggedWorkout(S, input(S, 'Squat 100kg 5x5'), { now: NOW })
    expect(findDuplicate(S, again.workout)).toBeTruthy()
    expect(appendLoggedWorkout(S, again, { now: NOW }).added).toBe(false)
    expect(S.workouts).toHaveLength(1)
  })
})
