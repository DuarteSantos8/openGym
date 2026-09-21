import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import ru from '../exercise-names/ru.js'
import { EXDB } from './exercises-data.js'
import {
  EXERCISE_NAME_LANGS, _setLangState, exerciseNameFor, exerciseNameSearchText
} from './i18n-core.js'

describe('Russian exercise names', () => {
  const source = JSON.parse(readFileSync(new URL('../../../scripts/exercise-name-sources/ru.json', import.meta.url), 'utf8'))
  afterEach(() => _setLangState('en', {}, null, null))

  test('matches the curated source and covers the complete built-in catalogue', () => {
    expect(Object.keys(ru)).toHaveLength(EXDB.length)
    expect(ru).toEqual(source)
    expect(EXERCISE_NAME_LANGS).toContain('ru')
  })

  test('contains a non-empty Russian translation for every known exercise', () => {
    for (const exercise of EXDB) {
      expect(ru[exercise.id]?.trim(), exercise.id).toBeTruthy()
      // Cyrillic somewhere in the title: a name left in English would otherwise pass
      // every other check in this file while showing "barbell bench press (barbell bench press)".
      expect(ru[exercise.id], exercise.id).toMatch(/\p{Script=Cyrillic}/u)
      // Transliterated calques the glossary rejects in favour of the term gyms actually use.
      expect(ru[exercise.id], exercise.id).not.toMatch(/(?:^|[^\p{L}])(?:керл|завиток|череполом|хруст|сит-ап|пуш-ап|пул-ап|чин-ап|кеттлбелл|ассистированн\p{L}*|проповедник|мёртвая тяга)(?=$|[^\p{L}])/iu)
    }
  })

  test('preserves identity-changing qualifiers and equipment', () => {
    const rules = [
      // "ez bar"/"ez barbell" is the EZ bar, and an olympic barbell is named for the bar too,
      // so a plain "barbell" is the only one that has to say штанга.
      [/ez[\s-]bar/iu, /ez-гриф/iu],
      [/(?<!ez[\s-])(?<!olympic )barbell/iu, /штанг/iu],
      [/olympic barbell/iu, /(?:олимпийск|штанг)/iu],
      [/dumbbell/iu, /гантел/iu],
      [/kettlebell/iu, /гир/iu],
      [/smith/iu, /смит/iu],
      [/trap bar/iu, /трэп-гриф/iu],
      [/stability ball/iu, /фитбол/iu],
      [/medicine ball/iu, /медбол/iu],
      [/assisted/iu, /(?:поддержк|самопомощ)/iu],
      [/weighted/iu, /отягощен/iu],
      [/(?:^|[^\p{L}])male(?=$|[^\p{L}])/iu, /муж/iu],
      [/(?:^|[^\p{L}])female(?=$|[^\p{L}])/iu, /жен/iu],
    ]
    for (const exercise of EXDB) {
      for (const [english, russian] of rules) {
        if (english.test(exercise.n)) expect(ru[exercise.id], `${exercise.id}: ${exercise.n}`).toMatch(russian)
      }
    }
  })

  test('shows Russian first and preserves the canonical English title', () => {
    const exercise = EXDB[0]
    _setLangState('ru', {}, null, ru)
    expect(exerciseNameFor(exercise)).toBe(`${ru[exercise.id]} (${exercise.n})`)
    expect(exerciseNameSearchText(exercise)).toContain(ru[exercise.id])
    expect(exerciseNameSearchText(exercise)).toContain(exercise.n)
  })

  test('never translates custom exercises or changes other languages', () => {
    const custom = { id: 'custom-1', n: 'Моё упражнение' }
    _setLangState('ru', {}, null, ru)
    expect(exerciseNameFor(custom)).toBe('Моё упражнение')
    _setLangState('en', {}, null, null)
    expect(exerciseNameFor(EXDB[0])).toBe(EXDB[0].n)
  })
})
