import { describe, expect, it } from 'vitest'
import { LANGS, DATE_LOCALES, DERIVED_LOCALES } from './i18n-core.js'
import { matchLocale } from './default-lang.js'
import sv from '../locales/sv.js'

// Swedish (#721) came in as a pack plus two registry lines. A pack the registry forgets never
// shows up in the language picker, and one without a date locale formats dates in English.
describe('every locale pack is wired up', () => {
  const packs = import.meta.glob('../locales/*.js', { eager: true, import: 'default' })
  const codes = Object.keys(packs).map(p => p.match(/([\w-]+)\.js$/)[1])

  it.each(codes)('%s is offered in the picker and has a date locale', (code) => {
    expect(LANGS[code], `${code} missing from LANGS`).toEqual(expect.any(String))
    expect(DATE_LOCALES[code], `${code} missing from DATE_LOCALES`).toEqual(expect.any(String))
    expect(DERIVED_LOCALES[code]).toBeUndefined()
  })

  it('a Swedish phone gets Swedish, with Swedish dates', () => {
    expect(LANGS.sv).toBe('Svenska')
    expect(matchLocale('sv-SE')).toBe('sv')
    expect(matchLocale('sv_FI')).toBe('sv')
    expect(new Intl.DateTimeFormat(DATE_LOCALES.sv, { month: 'long' }).format(new Date(2026, 9, 23))).toBe('oktober')
  })

  it('the Swedish pack has no em dashes in what it shows', () => {
    const dashed = Object.entries(sv).filter(([, v]) => String(v).includes('—')).map(([k]) => k)
    expect(dashed).toEqual([])
  })
})
