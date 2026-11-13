import { describe, expect, it } from 'vitest'
import { LANGS, DATE_LOCALES, DERIVED_LOCALES } from './i18n-core.js'
import { matchLocale } from './default-lang.js'
import id from '../locales/id.js'

describe('Indonesian (id) locale pack is wired up', () => {
  it('is offered in the picker and has a date locale', () => {
    expect(LANGS.id).toBe('Bahasa Indonesia')
    expect(DATE_LOCALES.id).toBe('id-ID')
    expect(DERIVED_LOCALES.id).toBeUndefined()
  })

  it('an Indonesian device gets Bahasa Indonesia, with Indonesian dates', () => {
    expect(matchLocale('id-ID')).toBe('id')
    expect(matchLocale('id_ID')).toBe('id')
    expect(matchLocale('id')).toBe('id')
    expect(new Intl.DateTimeFormat(DATE_LOCALES.id, { month: 'long' }).format(new Date(2026, 9, 23))).toBe('Oktober')
  })

  it('the Indonesian pack has no em dashes in what it shows', () => {
    const dashed = Object.entries(id).filter(([, v]) => String(v).includes('—')).map(([k]) => k)
    expect(dashed).toEqual([])
  })
})
