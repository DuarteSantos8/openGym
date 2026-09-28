import { describe, expect, it } from 'vitest'
import { LANGS, DERIVED_LOCALES } from './i18n-core.js'
import { PT_BR_OVERRIDES } from '../locales/pt-BR.js'
import { BODYPARTS, allExercises } from './exercises.js'

const PACK_KEYS = [
  'English exercise names',
  'Show the English name in parentheses next to the translated one.',
  'English names only',
  'Replace the translated names with the original English ones.',
]

describe('exercise-name toggle locale coverage', () => {
  const packs = import.meta.glob('../locales/*.js', { eager: true, import: 'default' })
  const localeCodes = Object.keys(LANGS).filter(code => code !== 'en' && !DERIVED_LOCALES[code])

  it('defines every Settings label in each locale pack', () => {
    expect(Object.keys(packs)).toHaveLength(localeCodes.length)
    for (const code of localeCodes) {
      const pack = packs[`../locales/${code}.js`]
      expect(pack, `${code} locale pack is missing`).toBeTruthy()
      for (const key of PACK_KEYS) {
        expect(Object.hasOwn(pack, key), `${code} is missing ${key}`).toBe(true)
        expect(pack[key], `${code} has a blank ${key}`).toEqual(expect.any(String))
        expect(pack[key].trim(), `${code} has a blank ${key}`).not.toBe('')
      }
    }
  })
})
// The Library, picker and editor chips show t(bp) and t(eq) for the catalogue's own values, which
// no t('literal') names, so check-source-strings cannot see them. 'full body' came with the
// catalogue in v1.3.8 and stayed English in every language until QA found it (v1.3.9).
describe('catalogue body parts and equipment', () => {
  const packs = import.meta.glob('../locales/*.js', { eager: true, import: 'default' })
  it('every body part and every piece of equipment of the catalogue has a word in each pack', () => {
    const terms = [...BODYPARTS, ...new Set(allExercises({}).map(e => e.eq).filter(Boolean))]
    expect(BODYPARTS).toContain('full body')
    for (const [file, pack] of Object.entries(packs)) {
      const missing = terms.filter(k => !Object.hasOwn(pack, k) || !String(pack[k]).trim())
      expect(missing, file).toEqual([])
    }
  })
})
