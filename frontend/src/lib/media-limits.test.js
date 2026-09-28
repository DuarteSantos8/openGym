// The sizes the editor and Settings say ("0.2 MB", "12.5 of 200 MB used") are written with the
// language's own decimal mark, like every other number in the app.
import { afterEach, describe, expect, it } from 'vitest'
import { fmtMB } from './media-limits.js'
import { _setLangState } from './i18n-core.js'

afterEach(() => _setLangState('en', null, null, null))

describe('fmtMB', () => {
  it('rounds to one decimal and drops it on a whole number, unless asked to keep it', () => {
    expect(fmtMB(0.5)).toBe('0.5')
    expect(fmtMB(2)).toBe('2')
    expect(fmtMB(2.04)).toBe('2')
    expect(fmtMB(2, { fixed: true })).toBe('2.0')
  })

  it('writes the decimal mark of the language', () => {
    _setLangState('de', {}, null, null)
    expect(fmtMB(0.5)).toBe('0,5')
    expect(fmtMB(2, { fixed: true })).toBe('2,0')
    _setLangState('fr', {}, null, null)
    expect(fmtMB(12.5)).toBe('12,5')
    _setLangState('ar', {}, null, null)
    expect(fmtMB(0.5)).toMatch(/^0.5$/)   // Latin digits, as everywhere in the app
  })
})
