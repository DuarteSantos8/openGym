import { afterEach, describe, expect, test } from 'vitest'
import lt from '../locales/lt.js'
import pl from '../locales/pl.js'
import { DATE_LOCALES, LANGS, _setLangState, t, tn } from './i18n-core.js'

const placeholders = value => [...String(value).matchAll(/\{\d+\}/g)].map(match => match[0]).sort()

describe('Lithuanian locale', () => {
  afterEach(() => _setLangState('en', {}, null, null))

  test('is selectable and uses Lithuanian date and plural rules', () => {
    expect(LANGS.lt).toBe('Lietuvių')
    expect(DATE_LOCALES.lt).toBe('lt-LT')

    _setLangState('lt', lt, null, null)
    const workouts = n => tn('{0} workout', '{0} workouts', n)
    expect(workouts(1)).toBe('1 treniruotė')
    expect(workouts(2)).toBe('2 treniruotės')
    expect(workouts(10)).toBe('10 treniruočių')
    expect(workouts(11)).toBe('11 treniruočių')
    expect(workouts(21)).toBe('21 treniruotė')
    expect(workouts(22)).toBe('22 treniruotės')
    expect(workouts(1.5)).toBe('1.5 treniruotės')
  })

  test('keeps context-sensitive fitness terms and both passkey sentences coherent', () => {
    _setLangState('lt', lt, null, null)
    const bio = t('your fingerprint, face or PIN')
    expect(t('Passkeys use {0}. No passwords to remember.', bio))
      .toBe('Prisijungimą su prieigos raktu patvirtinate piršto atspaudu, veido atpažinimu arba PIN kodu. Nereikia prisiminti slaptažodžių.')
    expect(t('Pick a name, then confirm with {0}. The passkey lives on your device, so no password needed.', bio))
      .toContain('patvirtinkite piršto atspaudu')
    expect(t('Weekly')).toBe('Kas savaitę')
    expect(t('Quick check-in')).toBe('Greitas pasisvėrimas')
    expect(t('Pull-ups (10 reps, bodyweight)')).toContain('Prisitraukimai')
    expect(t('soleus')).toBe('plekšninis raumuo')
    expect(t('brachialis')).toBe('žastinis raumuo')
  })

  test('handles zero, teen, plural and decimal change counts', () => {
    _setLangState('lt', lt, null, null)
    const changes = n => tn('{0} change applied', '{0} changes applied', n)
    expect(changes(1)).toBe('Pritaikytas 1 pakeitimas')
    expect(changes(2)).toBe('Pritaikyti 2 pakeitimai')
    expect(changes(0)).toBe('Pritaikyta 0 pakeitimų')
    expect(changes(11)).toBe('Pritaikyta 11 pakeitimų')
    expect(changes(1.5)).toBe('Pritaikyta 1.5 pakeitimo')
  })

  test('matches the baseline key set and preserves interpolation placeholders', () => {
    expect(Object.keys(lt).sort()).toEqual(Object.keys(pl).sort())
    for (const [source, translated] of Object.entries(lt)) {
      const forms = translated && typeof translated === 'object' ? Object.values(translated) : [translated]
      for (const form of forms) expect(placeholders(form), source).toEqual(placeholders(source))
    }
  })

  test('provides all Lithuanian CLDR forms for every plural entry', () => {
    for (const [source, baseline] of Object.entries(pl)) {
      if (!baseline || typeof baseline !== 'object') continue
      const translated = lt[source]
      expect(typeof translated, source).toBe('object')
      expect(Object.keys(translated), source).toEqual(['one', 'few', 'many', 'other'])
      for (const form of Object.values(translated)) expect(form.trim(), source).not.toBe('')
    }
  })
})
