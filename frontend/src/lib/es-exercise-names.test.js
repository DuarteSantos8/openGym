import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import esNames from '../exercise-names/es.js'
import { EXDB } from './exercises-data.js'
import {
  EXERCISE_NAME_LANGS, _setLangState, exerciseNameFor, exerciseNameSearchText
} from './i18n-core.js'

describe('Spanish exercise names', () => {
  const source = JSON.parse(readFileSync(new URL('../../../scripts/exercise-name-sources/es.json', import.meta.url), 'utf8'))
  afterEach(() => _setLangState('en', {}, null, null))

  test('matches the curated source and covers the complete built-in catalogue', () => {
    expect(Object.keys(esNames)).toHaveLength(EXDB.length)
    expect(esNames).toEqual(source)
    expect(EXERCISE_NAME_LANGS).toContain('es')
  })

  test('contains a non-empty translation for every known exercise with no untranslated qualifiers', () => {
    for (const exercise of EXDB) {
      expect(esNames[exercise.id]?.trim(), exercise.id).toBeTruthy()
      expect(esNames[exercise.id], exercise.id).not.toMatch(
        /(?:^|[^\p{L}])(?:barbell|dumbbell|cable|stability ball|medicine ball|assisted|weighted)(?=$|[^\p{L}])/iu
      )
    }
  })

  test('preserves identity-changing qualifiers and equipment', () => {
    const rules = [
      [/assisted/iu, /asistid/iu],
      [/weighted/iu, /con peso/iu],
      [/(?:^|[^\p{L}])male(?=$|[^\p{L}])/iu, /masculin/iu],
      [/(?:^|[^\p{L}])female(?=$|[^\p{L}])/iu, /femenin/iu],
      [/barbell/iu, /barra/iu],
      [/dumbbell/iu, /mancuerna/iu],
      [/kettlebell/iu, /kettlebell/iu],
      [/smith/iu, /multipower/iu],
      [/stability ball/iu, /fitball/iu],
      [/exercise ball/iu, /fitball/iu],
      [/medicine ball/iu, /balón medicinal/iu],
      [/cable/iu, /polea/iu],
      [/band/iu, /banda elástica/iu],
    ]
    for (const exercise of EXDB) {
      for (const [english, spanish] of rules) {
        if (english.test(exercise.n)) expect(esNames[exercise.id], `${exercise.id}: ${english}`).toMatch(spanish)
      }
    }
  })

  test('shows Spanish first, keeps English in parentheses by default, and can hide it', () => {
    const exercise = EXDB[0]
    _setLangState('es', {}, null, esNames)
    expect(exerciseNameFor(exercise)).toBe(`${esNames[exercise.id]} (${exercise.n})`)
    expect(exerciseNameSearchText(exercise)).toContain(esNames[exercise.id])
    expect(exerciseNameSearchText(exercise)).toContain(exercise.n)
    _setLangState('es', {}, null, esNames, false)
    expect(exerciseNameFor(exercise)).toBe(esNames[exercise.id])
  })

  test('never translates custom exercises or changes other languages', () => {
    const custom = { id: 'custom-1', n: 'Mi ejercicio' }
    _setLangState('es', {}, null, esNames)
    expect(exerciseNameFor(custom)).toBe('Mi ejercicio')
    _setLangState('en', {}, null, null)
    expect(exerciseNameFor(EXDB[0])).toBe(EXDB[0].n)
  })

  test('keeps loanword names without duplicating the English title', () => {
    const burpee = EXDB.find(e => e.id === '1160')
    _setLangState('es', {}, null, esNames)
    expect(exerciseNameFor(burpee)).toBe('burpee')
  })
})