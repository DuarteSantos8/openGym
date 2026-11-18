import { afterEach, describe, expect, test } from 'vitest'
import da from '../locales/da.js'
import { DATE_LOCALES, LANGS, _setLangState, t, tn } from './i18n-core.js'
import { matchLocale } from './default-lang.js'

// #1039: Danish, started by a native speaker, the rest filled in at merge time.
describe('Danish locale', () => {
  afterEach(() => _setLangState('en', {}, null, null))

  test('is selectable, with Danish dates, and a Danish browser picks it', () => {
    expect(LANGS.da).toBe('Dansk')
    expect(DATE_LOCALES.da).toBe('da-DK')
    expect(matchLocale('da-DK')).toBe('da')
    expect(matchLocale('da')).toBe('da')
  })

  test('speaks Danish, keeps the contributor’s words and the numbers in their sentences', () => {
    _setLangState('da', da, null, null)
    expect(t('Cancel')).toBe('Annuller')
    expect(t('Delete')).toBe('Slet')
    expect(tn('{0} workout', '{0} workouts', 3)).toBe('3 pas')
    expect(t('Next session: {0}, {1}', 'Mon', 'Push')).toBe('Næste pas: Mon, Push')
  })

  test('carries no leftover keys that no other pack has (the old exercise list)', () => {
    expect(Object.keys(da).some(k => / variation \d+$/.test(k))).toBe(false)
  })
})
