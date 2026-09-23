import { expect, it } from 'vitest'
import { EXDB, matchExercise, normalizeStr, searchExercises } from './exercises.js'

const benchPress = {
  n: 'dumbbell bench press', bp: 'chest', tg: 'pectorals', eq: 'dumbbell',
  sm: ['triceps', 'deltoids'], desc: 'Classic chest exercise using a barbell on a flat bench.',
}

it('allows one edit or adjacent transposition in long query tokens', () => {
  for (const query of ['dumbell bench', 'dumbbel bench', 'dummbell bench', 'bnech press', 'presss bench']) {
    expect(matchExercise(benchPress, query), query).toBe(true)
  }
})

it('keeps short tokens and multiple edits out of fuzzy matching', () => {
  const squat = { n: 'barbell squat', bp: 'legs', eq: 'barbell' }
  for (const [exercise, query] of [[squat, 'sqat'], [squat, 'roww'], [benchPress, 'dunbell'], [benchPress, 'dumbell unrelated'], [benchPress, 'bn ech']]) {
    expect(matchExercise(exercise, query), query).toBe(false)
  }
})

it('keeps existing exact substring and all-token behavior', () => {
  expect(matchExercise(benchPress, 'bench pres')).toBe(true)
  expect(matchExercise(benchPress, 'press bench')).toBe(true)
  expect(matchExercise(benchPress, 'bench squat')).toBe(false)
})

// QA C26: a correctly spelled word one edit away from a body part / target / equipment word
// used to pull in that whole body part ("wrist" ~ "waist" listed every abs exercise first).
it('never fuzzy-matches body part, target, equipment or description words', () => {
  const sitUp = { n: '3/4 sit-up', bp: 'waist', tg: 'abs', eq: 'body weight', sm: [], desc: 'Keep the lower back flat.' }
  for (const query of ['wrist', 'power', 'bodz weight']) {
    expect(matchExercise(sitUp, query), query).toBe(false)
  }
  // The exact substring path still covers those fields.
  expect(matchExercise(sitUp, 'waist')).toBe(true)
  expect(matchExercise(sitUp, 'lower')).toBe(true)
})

it('searchExercises takes a word literally when it hits anything exactly, and only then falls back to typos', () => {
  const list = [
    { n: 'band wrist curl', bp: 'lower arms', eq: 'band' },
    { n: 'waist twist', bp: 'waist', eq: 'body weight' },
    { n: 'all fours squad stretch', bp: 'upper legs', eq: 'body weight' },
    { n: 'barbell squat', bp: 'upper legs', eq: 'barbell' },
    { n: 'side plank', bp: 'waist', eq: 'body weight' },
    { n: 'slide lunge', bp: 'upper legs', eq: 'body weight' },
    benchPress,
  ]
  const names = q => searchExercises(list, q).map(e => e.n)
  expect(names('wrist')).toEqual(['band wrist curl'])
  expect(names('squat')).toEqual(['barbell squat'])
  expect(names('slide')).toEqual(['slide lunge'])
  // No exact hit anywhere: the typo-tolerant path finds the exercise, name words only.
  expect(names('wirst')).toEqual(['band wrist curl'])
  expect(names('bnech press')).toEqual(['dumbbell bench press'])
  expect(names('dumbell bench')).toEqual(['dumbbell bench press'])
  expect(names('sqat')).toEqual([])
  expect(searchExercises(list, '  ')).toBe(list)
})

it('searchExercises over the real catalogue returns only exact hits for correctly spelled words', () => {
  const plain = (e, q) => normalizeStr([e.n, e.tg, e.eq, e.bp, ...(e.sm || [])].join(' ')).includes(q)
  for (const q of ['wrist', 'power', 'slide', 'thigh', 'squat', 'clean']) {
    const got = searchExercises(EXDB, q)
    expect(got.length, q).toBe(EXDB.filter(e => plain(e, q)).length)
    expect(got.every(e => plain(e, q)), q).toBe(true)
  }
  expect(searchExercises(EXDB, 'wrist')[0].n).toBe('band reverse wrist curl')
})
