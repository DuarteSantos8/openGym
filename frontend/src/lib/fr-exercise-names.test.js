import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import frNames from '../exercise-names/fr.js'
import { EXDB } from './exercises-data.js'
import {
  EXERCISE_NAME_LANGS, _setLangState, exerciseNameFor, exerciseNameSearchText
} from './i18n-core.js'

describe('French exercise names', () => {
  const source = JSON.parse(readFileSync(new URL('../../../scripts/exercise-name-sources/fr.json', import.meta.url), 'utf8'))
  afterEach(() => _setLangState('en', {}, null, null))

  test('matches the curated source and covers the complete built-in catalogue', () => {
    expect(Object.keys(frNames)).toHaveLength(EXDB.length)
    expect(frNames).toEqual(source)
    expect(EXERCISE_NAME_LANGS).toContain('fr')
  })

  test('contains a non-empty translation for every known exercise with no untranslated qualifiers', () => {
    for (const exercise of EXDB) {
      expect(frNames[exercise.id]?.trim(), exercise.id).toBeTruthy()
      expect(frNames[exercise.id], exercise.id).not.toMatch(
        /(?:^|[^\p{L}])(?:barbell|dumbbell|cable|stability ball|medicine ball|assisted|weighted)(?=$|[^\p{L}])/iu
      )
    }
  })

  test('preserves identity-changing qualifiers and equipment', () => {
    const rules = [
      [/assisted/iu, /assisté/iu],
      [/weighted/iu, /lesté/iu],
      [/(?:^|[^\p{L}])male(?=$|[^\p{L}])/iu, /masculin/iu],
      [/(?:^|[^\p{L}])female(?=$|[^\p{L}])/iu, /féminin/iu],
      [/barbell/iu, /barre/iu],
      [/dumbbell/iu, /haltère/iu],
      [/kettlebell/iu, /kettlebell/iu],
      [/smith/iu, /multipower/iu],
      [/stability ball/iu, /ballon de stabilité/iu],
      [/exercise ball/iu, /ballon de stabilité/iu],
      [/medicine ball/iu, /médecine-ball/iu],
      [/cable/iu, /câble/iu],
      [/band/iu, /élastique/iu],
    ]
    for (const exercise of EXDB) {
      for (const [english, french] of rules) {
        if (english.test(exercise.n)) expect(frNames[exercise.id], `${exercise.id}: ${english}`).toMatch(french)
      }
    }
  })

  test('shows French first, keeps English in parentheses by default, and can hide it', () => {
    const exercise = EXDB[0]
    _setLangState('fr', {}, null, frNames)
    expect(exerciseNameFor(exercise)).toBe(`${frNames[exercise.id]} (${exercise.n})`)
    expect(exerciseNameSearchText(exercise)).toContain(frNames[exercise.id])
    expect(exerciseNameSearchText(exercise)).toContain(exercise.n)
    _setLangState('fr', {}, null, frNames, false)
    expect(exerciseNameFor(exercise)).toBe(frNames[exercise.id])
  })

  test('never translates custom exercises or changes other languages', () => {
    const custom = { id: 'custom-1', n: 'Mon exercice' }
    _setLangState('fr', {}, null, frNames)
    expect(exerciseNameFor(custom)).toBe('Mon exercice')
    _setLangState('en', {}, null, null)
    expect(exerciseNameFor(EXDB[0])).toBe(EXDB[0].n)
  })

  test('keeps loanword names without duplicating the English title', () => {
    const burpee = EXDB.find(e => e.id === '1160')
    _setLangState('fr', {}, null, frNames)
    expect(exerciseNameFor(burpee)).toBe('burpee')
  })
})