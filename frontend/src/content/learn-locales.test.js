// @vitest-environment happy-dom
import { afterAll, describe, expect, it } from 'vitest'
import { GLOSSARY } from './learn.js'
import { LANGS, getLang, setLang, t } from '../lib/i18n.js'

afterAll(async () => { await setLang('en') })

describe('the glossary in every supported language', () => {
  for (const locale of Object.keys(LANGS).filter(code => code !== 'en')) {
    it(locale + ' loads through the runtime and has a label and definition for every entry', async () => {
      await setLang(locale)
      expect(getLang()).toBe(locale)
      const missing = []
      for (const { id, term, def } of GLOSSARY) {
        const label = t(term), definition = t(def)
        if (typeof label !== 'string' || !label.trim()) missing.push(id + ' label')
        if (typeof definition !== 'string' || !definition.trim() || definition === def) missing.push(id + ' definition')
      }
      expect(missing).toEqual([])
    })
  }
})

describe('words that mean different things', () => {
  it.each(['cs', 'fr', 'hu', 'it', 'lt', 'pl'])('%s keeps Set and Streak distinct at runtime', async locale => {
    await setLang(locale)
    expect(t('Set')).not.toBe(t('Streak'))
  })

  it('Chinese names upper and lower body halves, not limbs', async () => {
    await setLang('zh')
    expect(t('Upper / Lower')).toBe('上半身 / 下半身')
    expect(t('Upper body twice, lower body twice.')).toBe('上半身两次，下半身两次。')
    expect(t('A plan that alternates upper-body days and lower-body days, usually four sessions a week.'))
      .toBe('交替安排上半身训练日和下半身训练日的计划，通常每周训练4次。')
    expect(t('How a week of training is divided between body parts. Full body, upper/lower and push/pull/legs are the common ones.'))
      .toBe('一周训练如何分配给不同身体部位。常见方式包括全身训练、上半身与下半身分化，以及推、拉、腿分化。')
  })
})
