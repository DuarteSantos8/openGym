import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import deNames from '../exercise-names/de.js'
import { EXDB } from './exercises-data.js'
import {
  EXERCISE_NAME_LANGS, _setLangState, exerciseNameFor, exerciseNameSearchText
} from './i18n-core.js'

describe('German exercise names', () => {
  const source = JSON.parse(readFileSync(new URL('../../../scripts/exercise-name-sources/de.json', import.meta.url), 'utf8'))
  afterEach(() => _setLangState('en', {}, null, null))

  test('matches the curated source and covers the complete built-in catalogue', () => {
    expect(Object.keys(deNames)).toHaveLength(EXDB.length)
    expect(deNames).toEqual(source)
    expect(EXERCISE_NAME_LANGS).toContain('de')
  })

  test('contains a non-empty translation for every known exercise with no untranslated qualifiers', () => {
    for (const exercise of EXDB) {
      expect(deNames[exercise.id]?.trim(), exercise.id).toBeTruthy()
      expect(deNames[exercise.id], exercise.id).not.toMatch(
        /(?:^|[^\p{L}])(?:barbell|dumbbell|cable|stability ball|medicine ball|assisted|weighted)(?=$|[^\p{L}])/iu
      )
    }
  })

  test('preserves identity-changing qualifiers and equipment', () => {
    const rules = [
      [/assisted/iu, /assistiert/iu],
      [/weighted/iu, /beschwert/iu],
      [/(?:^|[^\p{L}])male(?=$|[^\p{L}])/iu, /männlich/iu],
      [/(?:^|[^\p{L}])female(?=$|[^\p{L}])/iu, /weiblich/iu],
      [/barbell/iu, /Langhantel/iu],
      [/dumbbell/iu, /Kurzhantel/iu],
      [/kettlebell/iu, /Kettlebell/iu],
      [/smith/iu, /Multipower/iu],
      [/stability ball/iu, /Gymnastikball/iu],
      [/exercise ball/iu, /Gymnastikball/iu],
      [/medicine ball/iu, /Medizinball/iu],
      [/cable/iu, /Kabelzug/iu],
      [/band/iu, /Band/iu],
    ]
    for (const exercise of EXDB) {
      for (const [english, german] of rules) {
        if (english.test(exercise.n)) expect(deNames[exercise.id], `${exercise.id}: ${english}`).toMatch(german)
      }
    }
  })

  test('shows German first, keeps English in parentheses by default, and can hide it', () => {
    const exercise = EXDB[0]
    _setLangState('de', {}, null, deNames)
    expect(exerciseNameFor(exercise)).toBe(`${deNames[exercise.id]} (${exercise.n})`)
    expect(exerciseNameSearchText(exercise)).toContain(deNames[exercise.id])
    expect(exerciseNameSearchText(exercise)).toContain(exercise.n)
    _setLangState('de', {}, null, deNames, false)
    expect(exerciseNameFor(exercise)).toBe(deNames[exercise.id])
  })

  test('never translates custom exercises or changes other languages', () => {
    const custom = { id: 'custom-1', n: 'Meine Übung' }
    _setLangState('de', {}, null, deNames)
    expect(exerciseNameFor(custom)).toBe('Meine Übung')
    _setLangState('en', {}, null, null)
    expect(exerciseNameFor(EXDB[0])).toBe(EXDB[0].n)
  })

  test('keeps loanword names without duplicating the English title', () => {
    const burpee = EXDB.find(e => e.id === '1160')
    _setLangState('de', {}, null, deNames)
    expect(exerciseNameFor(burpee)).toBe('burpee')
  })
})