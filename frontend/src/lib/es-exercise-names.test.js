import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import es from '../exercise-names/es.js'
import { EXDB } from './exercises-data.js'
import {
  EXERCISE_NAME_LANGS, _setLangState, exerciseNameFor, exerciseNameSearchText
} from './i18n-core.js'

describe('Spanish exercise names', () => {
  const source = JSON.parse(readFileSync(new URL('../../../scripts/exercise-name-sources/es.json', import.meta.url), 'utf8'))
  afterEach(() => _setLangState('en', {}, null, null))

  test('matches the curated source and covers the complete built-in catalogue', () => {
    expect(Object.keys(es)).toHaveLength(EXDB.length)
    expect(es).toEqual(source)
    expect(EXERCISE_NAME_LANGS).toContain('es')
  })

  test('contains a non-empty translation for every known exercise', () => {
    for (const exercise of EXDB) {
      expect(es[exercise.id]?.trim(), exercise.id).toBeTruthy()
    }
  })

  test('preserves identity-changing qualifiers and equipment', () => {
    const rules = [
      [/assisted/iu, /asistid/iu],
      [/weighted/iu, /(?:peso|lastre)/iu],
      [/(?:^|[^\p{L}])male(?=$|[^\p{L}])/iu, /masculin/iu],
      [/(?:^|[^\p{L}])female(?=$|[^\p{L}])/iu, /femenin/iu],
      [/barbell/iu, /barra/iu],
      [/dumbbell/iu, /mancuerna/iu],
      [/kettlebell/iu, /kettlebell/iu],
      [/smith/iu, /smith/iu],
      [/stability ball/iu, /balón de estabilidad/iu],
      [/medicine ball/iu, /balón medicinal/iu],
      [/\bbands?\b/iu, /banda/iu],
      [/\bcables?\b/iu, /polea/iu],
    ]
    for (const exercise of EXDB) {
      for (const [english, spanish] of rules) {
        if (english.test(exercise.n)) expect(es[exercise.id], `${exercise.id}: ${english}`).toMatch(spanish)
      }
    }
  })

  test('shows Spanish first and preserves the canonical English title', () => {
    const exercise = EXDB[0]
    _setLangState('es', {}, null, es)
    expect(exerciseNameFor(exercise)).toBe(`${es[exercise.id]} (${exercise.n})`)
    expect(exerciseNameSearchText(exercise)).toContain(es[exercise.id])
    expect(exerciseNameSearchText(exercise)).toContain(exercise.n)
  })

  test('never translates custom exercises or changes other languages', () => {
    const custom = { id: 'custom-1', n: 'Mi ejercicio' }
    _setLangState('es', {}, null, es)
    expect(exerciseNameFor(custom)).toBe('Mi ejercicio')
    _setLangState('en', {}, null, null)
    expect(exerciseNameFor(EXDB[0])).toBe(EXDB[0].n)
  })
})
