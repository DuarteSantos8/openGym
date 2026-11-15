import { afterEach, describe, expect, it } from 'vitest'
import { _setLangState, DATE_LOCALES } from './i18n-core.js'
import { fmtNum } from './format.js'
import { canonicalNumber, decimalSeparator, localiseNumber, numberSeparators } from './number-input.js'

afterEach(() => _setLangState('en', null, null, null))

describe('the separator a number field shows', () => {
  // The whole point (P3): the field and the text beside it can never disagree, because both ask
  // the same Intl locale. Checked for every language the app ships, not a hand-kept list.
  it.each(Object.keys(DATE_LOCALES))('%s: a field shows 72.5 exactly as the text prints it', lang => {
    _setLangState(lang, {}, null, null)
    expect(localiseNumber('72.5')).toBe(fmtNum(72.5))
    expect(localiseNumber('0.5')).toBe(fmtNum(0.5))
  })

  it.each([
    ['en', '.'], ['de', ','], ['ru', ','], ['fr', ','], ['uk', ','], ['pt-BR', ','], ['sv', ','],
    // Swiss German writes 72.5; Arabic, Persian and Bengali run on Latin digits with a point in
    // the app's text (the nu-latn locales in DATE_LOCALES), so their fields stay as they were.
    ['de-CH', '.'], ['ar', '.'], ['fa', '.'], ['bn', '.'], ['hi', '.'], ['zh', '.'],
  ])('%s uses "%s"', (lang, sep) => {
    _setLangState(lang, {}, null, null)
    expect(decimalSeparator()).toBe(sep)
    expect(localiseNumber('72.5')).toBe('72' + sep + '5')
    expect(localiseNumber('33.')).toBe('33' + sep)
    expect(localiseNumber('80')).toBe('80')
  })

  it('never puts a grouping sign into a field, and leaves anything that is not a number alone', () => {
    _setLangState('de', {}, null, null)
    expect(localiseNumber('12345.5')).toBe('12345,5')
    expect(localiseNumber('')).toBe('')
    expect(localiseNumber(null)).toBe('')
    expect(localiseNumber('12:30')).toBe('12:30')
    expect(localiseNumber('1e-7')).toBe('1e-7')
  })

  it('knows the grouping sign too', () => {
    expect(numberSeparators('de-DE')).toEqual({ decimal: ',', group: '.' })
    expect(numberSeparators('en-GB')).toEqual({ decimal: '.', group: ',' })
    expect(numberSeparators('de-CH').decimal).toBe('.')
  })
})

describe('what a number field reads back', () => {
  const LANGS = ['en', 'de', 'ru', 'fr', 'ar']
  it.each(LANGS)('%s: typed "," and "." both mean the decimal separator', lang => {
    _setLangState(lang, {}, null, null)
    for (const typed of ['7', '72', '72,', '72.', '72,5', '72.5', '0,25', '.5', ',5']) {
      expect(canonicalNumber(typed)).toBe(typed.replace(',', '.'))
    }
    expect(Number(canonicalNumber('72,5'))).toBe(72.5)
    expect(Number(canonicalNumber('72.5'))).toBe(72.5)
    // A second separator typed by a slipping thumb is dropped, as before.
    expect(canonicalNumber('72.5.')).toBe('72.5')
    expect(canonicalNumber('72,5,')).toBe('72.5')
    expect(canonicalNumber('72.5,')).toBe('72.5')
  })

  it.each(LANGS)('%s: a pasted number with thousands separators keeps its size', lang => {
    _setLangState(lang, {}, null, null)
    const paste = s => Number(canonicalNumber(s, { bulk: true }))
    expect(paste('1.234,5')).toBe(1234.5)
    expect(paste('1,234.5')).toBe(1234.5)
    expect(paste('1.234.567')).toBe(1234567)
    expect(paste('1,234,567')).toBe(1234567)
    expect(paste('12.345.678,25')).toBe(12345678.25)
    expect(paste('1 234,5')).toBe(1234.5)
    expect(paste('1 234,5')).toBe(1234.5)
    expect(paste("1'234.5")).toBe(1234.5)
    expect(paste('72,5')).toBe(72.5)
    expect(paste('72.5')).toBe(72.5)
    expect(paste('72,5 kg')).toBe(72.5)
    expect(paste('0,125')).toBe(0.125)
    expect(paste('0.125')).toBe(0.125)
    // Never the two silent disasters.
    for (const s of ['1.234,5', '1,234.5']) {
      expect(paste(s)).not.toBe(1.2345)
      expect(paste(s)).not.toBe(12345)
    }
  })

  it('reads a lone separator before three digits as this language writes it', () => {
    const paste = (s, locale) => Number(canonicalNumber(s, { bulk: true, locale }))
    expect(paste('1,234', 'en-GB')).toBe(1234)
    expect(paste('1.234', 'en-GB')).toBe(1.234)
    expect(paste('1.234', 'de-DE')).toBe(1234)
    expect(paste('1,234', 'de-DE')).toBe(1.234)
    // Russian and French group with a space, so neither sign is a grouping one.
    expect(paste('1.234', 'ru-RU')).toBe(1.234)
    expect(paste('1,234', 'ru-RU')).toBe(1.234)
    // Typed key by key it is always a decimal, in every language.
    expect(Number(canonicalNumber('1,234', { locale: 'en-GB' }))).toBe(1.234)
    expect(Number(canonicalNumber('1.234', { locale: 'de-DE' }))).toBe(1.234)
  })

  it('takes the digits of an Arabic, Persian, Hindi, Bengali or Thai keyboard', () => {
    expect(canonicalNumber('٧٢٫٥')).toBe('72.5')
    expect(canonicalNumber('۷۲٫۵')).toBe('72.5')
    expect(canonicalNumber('७२.५')).toBe('72.5')
    expect(canonicalNumber('৭২.৫')).toBe('72.5')
    expect(canonicalNumber('๗๒.๕')).toBe('72.5')
    expect(canonicalNumber('１２')).toBe('12')
    expect(canonicalNumber('١٬٢٣٤٫٥', { bulk: true })).toBe('1234.5')
  })

  it('drops everything that is not part of a number', () => {
    expect(canonicalNumber('abc')).toBe('')
    expect(canonicalNumber('-5')).toBe('5')
    expect(canonicalNumber(null)).toBe('')
    expect(canonicalNumber('1e5')).toBe('15')
  })
})
