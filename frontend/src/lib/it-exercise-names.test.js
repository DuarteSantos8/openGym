import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import itNames from '../exercise-names/it.js'
import { EXDB } from './exercises-data.js'
import {
  EXERCISE_NAME_LANGS, _setLangState, exerciseNameFor, exerciseNameSearchText
} from './i18n-core.js'

describe('Italian exercise names', () => {
  const source = JSON.parse(readFileSync(new URL('../../../scripts/exercise-name-sources/it.json', import.meta.url), 'utf8'))
  afterEach(() => _setLangState('en', {}, null, null))

  test('matches the curated source and covers the complete built-in catalogue', () => {
    expect(Object.keys(itNames)).toHaveLength(EXDB.length)
    expect(itNames).toEqual(source)
    expect(EXERCISE_NAME_LANGS).toContain('it')
  })

  test('contains a non-empty translation for every known exercise with no untranslated qualifiers', () => {
    for (const exercise of EXDB) {
      expect(itNames[exercise.id]?.trim(), exercise.id).toBeTruthy()
      expect(itNames[exercise.id], exercise.id).not.toMatch(
        /(?:^|[^\p{L}])(?:barbell|dumbbell|cable|stability ball|medicine ball|assisted|weighted)(?=$|[^\p{L}])/iu
      )
    }
  })

  test('preserves identity-changing qualifiers and equipment', () => {
    const rules = [
      [/assisted/iu, /assistit/iu],
      [/weighted/iu, /con peso/iu],
      [/(?:^|[^\p{L}])male(?=$|[^\p{L}])/iu, /maschil/iu],
      [/(?:^|[^\p{L}])female(?=$|[^\p{L}])/iu, /femminil/iu],
      [/barbell/iu, /bilancier/iu],
      [/dumbbell/iu, /manubri/iu],
      [/kettlebell/iu, /kettlebell/iu],
      [/smith/iu, /multipower/iu],
      [/stability ball/iu, /fitball/iu],
      [/exercise ball/iu, /fitball/iu],
      [/medicine ball/iu, /palla medica/iu],
      [/band/iu, /fascia elastica/iu],
    ]
    for (const exercise of EXDB) {
      for (const [english, italian] of rules) {
        if (english.test(exercise.n)) expect(itNames[exercise.id], `${exercise.id}: ${english}`).toMatch(italian)
      }
    }
  })

  test('shows Italian first and preserves the canonical English title', () => {
    const exercise = EXDB[0]
    _setLangState('it', {}, null, itNames)
    expect(exerciseNameFor(exercise)).toBe(`${itNames[exercise.id]} (${exercise.n})`)
    expect(exerciseNameSearchText(exercise)).toContain(itNames[exercise.id])
    expect(exerciseNameSearchText(exercise)).toContain(exercise.n)
  })

  test('never translates custom exercises or changes other languages', () => {
    const custom = { id: 'custom-1', n: 'Il mio esercizio' }
    _setLangState('it', {}, null, itNames)
    expect(exerciseNameFor(custom)).toBe('Il mio esercizio')
    _setLangState('en', {}, null, null)
    expect(exerciseNameFor(EXDB[0])).toBe(EXDB[0].n)
  })

  test('keeps loanword names without duplicating the English title', () => {
    const burpee = EXDB.find(e => e.id === '1160')
    _setLangState('it', {}, null, itNames)
    expect(exerciseNameFor(burpee)).toBe('burpee')
  })

  test('can hide the English name in parentheses per language', () => {
    const exercise = EXDB[0]
    _setLangState('it', {}, null, itNames, false)
    expect(exerciseNameFor(exercise)).toBe(itNames[exercise.id])
  })

  test('can replace the translation with the English name only, per language', () => {
    const exercise = EXDB[0]
    _setLangState('it', {}, null, itNames, true, true)
    expect(exerciseNameFor(exercise)).toBe(exercise.n)
  })
})
