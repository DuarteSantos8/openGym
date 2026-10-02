import { afterEach, describe, expect, it } from 'vitest'
import { exerciseNameText } from './format.js'
import { _setLangState } from './i18n-core.js'
import de from '../exercise-names/de.js'
import es from '../exercise-names/es.js'

// A toast, a dialog title, the timed-set label and the Stats picker show an exercise name as
// plain text, with no element to carry the CSS title-casing. They have to come out cased the way
// the same name reads in the list next to them.
describe('exerciseNameText', () => {
  const bench = { id: '0025', n: 'barbell bench press' }
  const custom = { id: 'custom-1', n: 'my own press' }
  afterEach(() => _setLangState('en', {}, null, null))

  it('title-cases an English name and a custom one', () => {
    expect(exerciseNameText(bench)).toBe('Barbell Bench Press')
    expect(exerciseNameText(custom)).toBe('My Own Press')
  })

  it('title-cases a name from a lower-case pack, the English one in parentheses included', () => {
    _setLangState('es', {}, null, es)
    expect(exerciseNameText(bench)).toBe('Press De Banca Con Barra (Barbell Bench Press)')
  })

  it('leaves German as the pack writes it', () => {
    _setLangState('de', {}, null, de, false)
    expect(exerciseNameText(bench)).toBe('Bankdrücken mit Langhantel')
  })
})

// QA 1.3.9: the accent swatches' screen-reader names were the internal keys ("lime", "sky").
describe('ACCENT_NAMES', () => {
  it('names every accent, in every language pack', async () => {
    const { ACCENTS, ACCENT_NAMES } = await import('./format.js')
    expect(Object.keys(ACCENT_NAMES).sort()).toEqual(Object.keys(ACCENTS).sort())
    const packs = import.meta.glob('../locales/*.js', { eager: true, import: 'default' })
    for (const [file, pack] of Object.entries(packs))
      for (const name of Object.values(ACCENT_NAMES)) expect(pack[name], `${file}: ${name}`).toBeTruthy()
  })
})
