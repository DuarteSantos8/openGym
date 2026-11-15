// #903: an exercise shown by one of its other names ("Pec deck" for "lever seated fly"),
// everywhere it is named, while ids, exports and the catalogue title stay what they were.
import { afterEach, expect, it } from 'vitest'
import { registerExerciseAliases, shownNameOf } from './exercise-aliases.js'
import { exerciseNameFor, exerciseNameClass, exerciseOwnName } from './i18n-core.js'
import { exerciseNameText } from './format.js'
import { CATALOGUE } from './exercises.js'
import { stampEdits, mergeStates, sinceReset } from './sync-merge.js'

afterEach(() => registerExerciseAliases({}))
const ex = CATALOGUE.find(e => e.id === '1162')

it('shows the picked other name as typed, and the own name again once it leaves the list', () => {
  registerExerciseAliases({ [ex.id]: ['Pec deck', 'Fly'] }, { [ex.id]: 'pec DECK' })
  expect(shownNameOf(ex)).toBe('Pec deck')
  expect(exerciseNameFor(ex)).toBe('Pec deck')
  expect(exerciseNameText(ex)).toBe('Pec deck')
  expect(exerciseNameClass(ex)).toBe('')
  expect(exerciseOwnName(ex)).toBe(ex.n)
  registerExerciseAliases({ [ex.id]: ['Fly'] }, { [ex.id]: 'Pec deck' })
  expect(exerciseNameFor(ex)).toBe(ex.n)
  expect(exerciseNameClass(ex)).toBe('capitalize')
  registerExerciseAliases({ [ex.id]: ['Fly'] }, { [ex.id]: null })
  expect(shownNameOf(ex)).toBeNull()
})

it('works for a custom exercise’s own other names too', () => {
  const c = { id: 'c1', n: 'My press', aliases: ['Viking'], custom: true }
  registerExerciseAliases({}, { c1: 'Viking' })
  expect(exerciseNameFor(c)).toBe('Viking')
})

it('syncs one exercise at a time, keeps a pick put back, and a reset clears it', () => {
  const before = { _ts: 1, exShownName: { a: 'A1' } }
  const phone = { _ts: 2, exShownName: { a: null } }
  const laptop = { _ts: 3, exShownName: { a: 'A1', b: 'B1' } }
  stampEdits(before, phone, 20)
  stampEdits(before, laptop, 30)
  for (const [l, r] of [[phone, laptop], [laptop, phone]]) expect(mergeStates(l, r).exShownName).toEqual({ a: null, b: 'B1' })
  expect(sinceReset(phone, 100).exShownName).toEqual({})
})
