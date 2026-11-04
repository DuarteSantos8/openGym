import { afterEach, describe, expect, it } from 'vitest'
import fa from '../locales/fa.js'
import ar from '../locales/ar.js'
import {
  LANGS, RTL_LANGS, DATE_LOCALES, _setLangState, t, dateLocale,
  instrFor, exerciseNameFor
} from './i18n-core.js'

// Restore the shared language state for other tests.
afterEach(() => _setLangState('en', {}, null, null))

describe('Persian UI locale', () => {
  it('registers Persian as a right-to-left language', () => {
    expect(LANGS.fa).toBe('فارسی')
    expect(RTL_LANGS.has('fa')).toBe(true)
    expect(RTL_LANGS.has('en')).toBe(false)
  })

  it('covers the UI reference keys and preserves placeholder multiplicity', () => {
    expect(Object.keys(fa).sort()).toEqual(Object.keys(ar).sort())
    const marks = value => [...value.matchAll(/\{\d+\}/g)].map(match => match[0]).sort()
    for (const [key, value] of Object.entries(fa)) {
      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
      expect(marks(value)).toEqual(marks(key))
    }
  })

  it('translates UI strings and falls back to the source for unknown keys', () => {
    _setLangState('fa', fa, null, null)
    expect(t('Save')).toBe('ذخیره')
    expect(t('Settings')).toBe('تنظیمات')
    expect(t('Unknown source {0}', 3)).toBe('Unknown source 3')
    const key = Object.keys(fa).find(source => source.includes('{0}'))
    expect(key).toBeDefined()
    expect(t(key, 7)).toBe(fa[key].replaceAll('{0}', '7'))
  })

  it('keeps Gregorian dates and Latin digits in Persian formatting', () => {
    _setLangState('fa', fa, null, null)
    expect(dateLocale()).toBe(DATE_LOCALES.fa)
    const options = new Intl.DateTimeFormat(dateLocale()).resolvedOptions()
    expect(options.calendar).toBe('gregory')
    expect(options.numberingSystem).toBe('latn')
  })

  it('keeps original exercise names and instructions without Persian exercise packs', () => {
    _setLangState('fa', fa, null, null)
    const exercise = { id: 'example', n: 'push-up', st: ['Original instruction'] }
    expect(exerciseNameFor(exercise)).toBe('push-up')
    expect(instrFor(exercise)).toEqual(exercise.st)
  })
})
