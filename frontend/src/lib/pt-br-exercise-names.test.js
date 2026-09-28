import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import ptBR from '../exercise-names/pt-BR.js'
import { EXDB } from './exercises-data.js'
import {
  EXERCISE_NAME_LANGS, _setLangState, exerciseNameFor, exerciseNameSearchText
} from './i18n-core.js'

describe('Brazilian Portuguese exercise names', () => {
  const source = JSON.parse(readFileSync(new URL('../../../scripts/exercise-name-sources/pt-BR.json', import.meta.url), 'utf8'))
  afterEach(() => _setLangState('en', {}, null, null))

  test('matches the curated source and covers the complete built-in catalogue', () => {
    expect(Object.keys(ptBR)).toHaveLength(EXDB.length)
    expect(ptBR).toEqual(source)
    expect(EXERCISE_NAME_LANGS).toContain('pt-BR')
  })

  test('contains a non-empty translation for every known exercise', () => {
    for (const exercise of EXDB) {
      expect(ptBR[exercise.id]?.trim(), exercise.id).toBeTruthy()
      expect(ptBR[exercise.id], exercise.id).not.toMatch(/(?:^|[^\p{L}])(?:abdómen|anca|gémeos|ecrã|ginásio|banda|piso|omoplata|pegada inversa|pegada invertida)(?=$|[^\p{L}])/iu)
    }
  })

  test('preserves identity-changing qualifiers and equipment', () => {
    const rules = [
      [/assisted/iu, /assistid/iu],
      [/weighted/iu, /(?:peso|carga|lastro|ponderad)/iu],
      [/(?:^|[^\p{L}])male(?=$|[^\p{L}])/iu, /masculin/iu],
      [/(?:^|[^\p{L}])female(?=$|[^\p{L}])/iu, /feminin/iu],
      [/barbell/iu, /barra/iu],
      [/dumbbell/iu, /halter/iu],
      [/kettlebell/iu, /kettlebell/iu],
      [/smith/iu, /smith/iu],
      [/stability ball/iu, /bola de estabilidade/iu],
      [/medicine ball/iu, /bola medicinal/iu],
    ]
    for (const exercise of EXDB) {
      for (const [english, portuguese] of rules) {
        if (english.test(exercise.n)) expect(ptBR[exercise.id], `${exercise.id}: ${english}`).toMatch(portuguese)
      }
    }
  })

  test('shows Portuguese first and preserves the canonical English title', () => {
    const exercise = EXDB[0]
    _setLangState('pt-BR', {}, null, ptBR)
    expect(exerciseNameFor(exercise)).toBe(`${ptBR[exercise.id]} (${exercise.n})`)
    expect(exerciseNameSearchText(exercise)).toContain(ptBR[exercise.id])
    expect(exerciseNameSearchText(exercise)).toContain(exercise.n)
  })

  test('never translates custom exercises or changes other languages', () => {
    const custom = { id: 'custom-1', n: 'Meu exercício' }
    _setLangState('pt-BR', {}, null, ptBR)
    expect(exerciseNameFor(custom)).toBe('Meu exercício')
    _setLangState('en', {}, null, null)
    expect(exerciseNameFor(EXDB[0])).toBe(EXDB[0].n)
  })
})
