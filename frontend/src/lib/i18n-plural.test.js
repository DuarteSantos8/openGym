import { describe, it, expect, afterEach } from 'vitest'
import { tn, _setLangState } from './i18n-core.js'
import ru from '../locales/ru.js'
import de from '../locales/de.js'

describe('tn() — plural forms from the pack', () => {
  afterEach(() => _setLangState('en', {}, null, null))

  it('falls back to the English two-form split with no pack', () => {
    _setLangState('en', {}, null, null)
    expect(tn('{0} exercise', '{0} exercises', 1)).toBe('1 exercise')
    expect(tn('{0} exercise', '{0} exercises', 2)).toBe('2 exercises')
    expect(tn('{0} exercise', '{0} exercises', 0)).toBe('0 exercises')
  })

  it('leaves a pack that answers with a plain string exactly as it was', () => {
    // German has two forms and says so with ordinary strings; nothing about it changes.
    _setLangState('de', de, null, null)
    expect(tn('{0} exercise', '{0} exercises', 1)).toBe(de['{0} exercise'].replace('{0}', 1))
    expect(tn('{0} exercise', '{0} exercises', 7)).toBe(de['{0} exercises'].replace('{0}', 7))
  })

  it('picks Russian one / few / many by the CLDR rule, not by n === 1', () => {
    _setLangState('ru', ru, null, null)
    const ex = n => tn('{0} exercise', '{0} exercises', n)
    expect(ex(1)).toBe('1 упражнение')
    expect(ex(2)).toBe('2 упражнения')
    expect(ex(4)).toBe('4 упражнения')
    expect(ex(5)).toBe('5 упражнений')
    expect(ex(0)).toBe('0 упражнений')
    // The teens are the trap: 11-14 take "many" even though 1-4 do not.
    expect(ex(11)).toBe('11 упражнений')
    expect(ex(14)).toBe('14 упражнений')
    expect(ex(21)).toBe('21 упражнение')
    expect(ex(22)).toBe('22 упражнения')
    expect(ex(25)).toBe('25 упражнений')
    expect(ex(101)).toBe('101 упражнение')
  })

  it('fills every placeholder, not just the count', () => {
    _setLangState('ru', ru, null, null)
    expect(tn('{0} set · {1} work', '{0} sets · {1} work', 2, 3)).toBe('2 подхода · 3 рабочих')
    expect(tn('{0} set · {1} work', '{0} sets · {1} work', 5, 4)).toBe('5 подходов · 4 рабочих')
  })

  it('reads the forms off the plural key, so a singular-only key needs no entry', () => {
    _setLangState('ru', ru, null, null)
    // '1 day a week' carries no {0} and has no entry of its own; the plural key answers for it.
    expect(tn('1 day a week', '{0} days a week', 1)).toBe('1 день в неделю')
    expect(tn('1 day a week', '{0} days a week', 3)).toBe('3 дня в неделю')
  })

  it('has a form for every plural key the Russian pack declares', () => {
    for (const [key, value] of Object.entries(ru)) {
      if (!value || typeof value !== 'object') continue
      expect(Object.keys(value), key).toEqual(expect.arrayContaining(['one', 'few', 'many']))
      for (const form of Object.values(value)) expect(typeof form, key).toBe('string')
    }
  })
})
