// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { GLOSSARY } from './learn.js'
import { LANGS, baseLang, derivePack } from '../lib/i18n-core.js'

const load = import.meta.glob('../locales/*.js', { import: 'default' })
describe('the glossary in every supported language', () => {
  for (const locale of Object.keys(LANGS).filter(code => code !== 'en')) {
    it(locale + ' has a label and definition for every entry', async () => {
      const dict = derivePack(locale, await load['../locales/' + baseLang(locale) + '.js']())
      const missing = []
      for (const { id, term, def } of GLOSSARY) {
        if (typeof dict[term] !== 'string' || !dict[term].trim()) missing.push(id + ' label')
        if (typeof dict[def] !== 'string' || !dict[def].trim() || dict[def] === def) missing.push(id + ' definition')
      }
      expect(missing).toEqual([])
    })
  }
})
