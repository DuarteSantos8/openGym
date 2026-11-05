import { afterEach, describe, expect, it } from 'vitest'
import { fmtChatTimestamp } from './format.js'
import { _setLangState, dateLocale } from './i18n-core.js'

describe('fmtChatTimestamp', () => {
  afterEach(() => _setLangState('en', {}, null, null))

  it('formats the date and time with the selected app locale', () => {
    const runtimeLocale = Intl.DateTimeFormat().resolvedOptions().locale
    const selectedLang = runtimeLocale.toLowerCase().startsWith('de') ? 'it' : 'de'
    _setLangState(selectedLang, {}, null, null)
    const at = new Date(2026, 9, 9, 13, 5)
    const now = new Date(2026, 9, 10, 10, 0)
    const expected = `${at.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' })} · ${at.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })}`
    const runtimeDefault = `${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ${at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`

    expect(dateLocale()).not.toBe(runtimeLocale)
    expect(fmtChatTimestamp(at.getTime(), now.getTime())).toBe(expected)
    expect(expected).not.toBe(runtimeDefault)
  })

  it('keeps same-day timestamps time-only in the local time zone', () => {
    _setLangState('de', {}, null, null)
    const at = new Date(2026, 9, 10, 0, 5)
    const now = new Date(2026, 9, 10, 23, 55)
    expect(fmtChatTimestamp(at.getTime(), now.getTime())).toBe(
      at.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
    )
  })
})
