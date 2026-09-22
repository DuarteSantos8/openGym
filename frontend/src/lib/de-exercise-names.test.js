import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import de from '../exercise-names/de.js'
import { EXDB } from './exercises-data.js'
import { checkName, stagedExercises } from '../../../scripts/de-name-rules.mjs'
import {
  EXERCISE_NAME_LANGS, _setLangState, derivePack, exerciseNameFor, exerciseNameSearchText
} from './i18n-core.js'

// German ships as a stage, not as a complete pack: the catalogue entries done with equipment.
// That is why this file asserts the staged set rather than EXDB.length the way the pt-BR test
// does — "incomplete" here is the stated shape, and the test's job is to stop it drifting.
describe('German exercise names', () => {
  const source = JSON.parse(readFileSync(new URL('../../../scripts/exercise-name-sources/de.json', import.meta.url), 'utf8'))
  const staged = stagedExercises(EXDB)
  afterEach(() => _setLangState('en', {}, null, null))

  test('matches the curated source and covers exactly the staged exercises', () => {
    expect(de).toEqual(source)
    expect(Object.keys(de)).toHaveLength(staged.length)
    expect(EXERCISE_NAME_LANGS).toContain('de')
  })

  test('covers every staged exercise and no body-weight one', () => {
    for (const exercise of staged) expect(de[exercise.id]?.trim(), exercise.id).toBeTruthy()
    for (const exercise of EXDB) {
      if (exercise.eq && exercise.eq !== 'body weight') continue
      expect(de[exercise.id], `${exercise.id} is body weight and must stay English`).toBeUndefined()
    }
  })

  // The same rules the translator corrects batches against, as a build failure. Both read
  // scripts/de-name-rules.mjs, so a rule relaxed for the translator is relaxed here too — which
  // is the point: there is one definition of what a German name may look like.
  test('every name obeys the naming rules', () => {
    const broken = []
    for (const exercise of staged) {
      const violations = checkName(exercise, de[exercise.id])
      if (violations.length) broken.push(`${exercise.id} "${de[exercise.id]}": ${violations.map(v => v.rule).join(', ')}`)
    }
    expect(broken).toEqual([])
  })

  test('shows German first and preserves the canonical English title', () => {
    const exercise = staged[0]
    _setLangState('de', {}, null, de)
    expect(exerciseNameFor(exercise)).toBe(`${de[exercise.id]} (${exercise.n})`)
    expect(exerciseNameSearchText(exercise)).toContain(de[exercise.id])
    expect(exerciseNameSearchText(exercise)).toContain(exercise.n)
  })

  test('falls back to the English title for a body-weight exercise', () => {
    const bodyWeight = EXDB.find(exercise => exercise.eq === 'body weight')
    _setLangState('de', {}, null, de)
    expect(exerciseNameFor(bodyWeight)).toBe(bodyWeight.n)
  })

  // de-CH derives from this pack by replacing ß with ss, so the base pack must be the ß one or
  // the Swiss locale derives nothing. A name written with ss here would pass every other test.
  test('de-CH derives the Swiss spelling from this pack', () => {
    const withSharpS = Object.entries(de).filter(([, name]) => name.includes('ß'))
    expect(withSharpS.length).toBeGreaterThan(0)
    const swiss = derivePack('de-CH', de)
    for (const [id, name] of withSharpS) {
      expect(swiss[id], id).toBe(name.replaceAll('ß', 'ss'))
      expect(swiss[id], id).not.toContain('ß')
    }
  })

  test('never translates custom exercises or changes other languages', () => {
    const custom = { id: 'custom-1', n: 'Meine Übung' }
    _setLangState('de', {}, null, de)
    expect(exerciseNameFor(custom)).toBe('Meine Übung')
    _setLangState('en', {}, null, null)
    expect(exerciseNameFor(staged[0])).toBe(staged[0].n)
  })
})
