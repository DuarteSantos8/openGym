import { afterEach, describe, expect, test } from 'vitest'
import fi from '../locales/fi.js'
import { DATE_LOCALES, LANGS, _setLangState, t, tn } from './i18n-core.js'
import { matchLocale } from './default-lang.js'

describe('Finnish locale', () => {
  afterEach(() => _setLangState('en', {}, null, null))

  test('is selectable, with Finnish dates, and a Finnish browser picks it', () => {
    expect(LANGS.fi).toBe('Suomi')
    expect(DATE_LOCALES.fi).toBe('fi-FI')
    expect(matchLocale('fi-FI')).toBe('fi')
    expect(matchLocale('fi')).toBe('fi')
  })

  test('speaks Finnish and keeps the numbers in its sentences', () => {
    _setLangState('fi', fi, null, null)
    expect(t('Cancel')).not.toBe('Cancel')
    expect(t('Delete')).not.toBe('Delete')
    expect(tn('{0} workout', '{0} workouts', 3)).toContain('3')
    expect(t('Next session: {0}, {1}', 'Mon', 'Push')).toMatch(/Mon.*Push|Push.*Mon/)
  })
})
