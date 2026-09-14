import { expect, it } from 'vitest'
import { matchExercise } from './exercises.js'

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
