// @vitest-environment happy-dom
// The tier badge says the level, not the settings word: German "Advanced" is "Erweitert" in the
// packs (an advanced setting), the skill tier is "Fortgeschritten".
import { afterEach, describe, expect, it } from 'vitest'
import { setLang } from '../lib/i18n.js'
import { tierName } from './Skills.jsx'

afterEach(async () => { await setLang('en') })

describe('tierName', () => {
  it('uses the tier\'s own key where a language has it, the plain name in English', async () => {
    await setLang('de')
    expect(tierName(3)).toBe('Fortgeschritten')
    expect(tierName(1)).toBe('Einsteiger')
    await setLang('en')
    expect(tierName(3)).toBe('Advanced')
    expect(tierName(4)).toBe('Elite')
  })
})
