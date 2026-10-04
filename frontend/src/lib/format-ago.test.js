import { afterEach, describe, expect, it } from 'vitest'
import { fmtAgo, fmtAgoDate, changeCount, setsWorkCount, fmtDur } from './format.js'
import { _setLangState } from './i18n-core.js'
import ar from '../locales/ar.js'
import uk from '../locales/uk.js'

// "Last synced: …" in Settings — the platform words it, in the UI language (en-GB here).
describe('fmtAgo', () => {
  const now = Date.UTC(2026, 8, 23, 12, 0, 0)
  it('reads the coarsest whole unit back from now', () => {
    expect(fmtAgo(now - 20 * 1000, now)).toBe('now')
    expect(fmtAgo(now - 5 * 60000, now)).toBe('5 minutes ago')
    expect(fmtAgo(now - 3 * 3600000 - 59 * 60000, now)).toBe('3 hours ago')
    expect(fmtAgo(now - 86400000, now)).toBe('yesterday')
    expect(fmtAgo(now - 9 * 86400000, now)).toBe('9 days ago')
  })

  it('a time ahead of the clock (the clock was set back) reads as now, not "in 5 minutes"', () => {
    expect(fmtAgo(now + 5 * 60000, now)).toBe('now')
  })
})

describe('fmtAgoDate', () => {
  afterEach(() => _setLangState('en', {}, null, null))

  it('uses calendar days and combines weeks, months and remaining days', () => {
    const now = new Date(2026, 8, 23, 12)
    expect(fmtAgoDate('2026-09-22', now)).toBe('yesterday')
    expect(fmtAgoDate('2026-09-17', now)).toBe('6 days ago')
    expect(fmtAgoDate('2026-09-16', now)).toBe('1 week ago')
    expect(fmtAgoDate('2026-09-15', now)).toBe('1 week, 1 day ago')
    expect(fmtAgoDate('2026-08-24', now)).toBe('1 month ago')
    expect(fmtAgoDate('2026-08-16', now)).toBe('1 month, 8 days ago')
  })

  it('does not count a future calendar date as time ago', () => {
    expect(fmtAgoDate('2026-09-24', new Date(2026, 8, 23, 12))).toBe('today')
  })
})

describe('changeCount', () => {
  it('has a singular', () => {
    expect(changeCount(1)).toBe('1 change')
    expect(changeCount(3)).toBe('3 changes')
  })
})

// The finish summary of a one-set workout read "1 sets · 1 work" (Android QA, v1.3.9).
describe('setsWorkCount', () => {
  afterEach(() => _setLangState('en', {}, null, null))

  it('has a singular', () => {
    expect(setsWorkCount(1, 1)).toBe('1 set · 1 work')
    expect(setsWorkCount(1, 0)).toBe('1 set · 0 work')
    expect(setsWorkCount(4, 3)).toBe('4 sets · 3 work')
  })

  it('and the packs carry it', () => {
    _setLangState('uk', uk, null, null)
    expect(setsWorkCount(1, 1)).toBe(uk['{0} set · {1} work'].replace('{0}', '1').replace('{1}', '1'))
    expect(uk['{0} set · {1} work']).not.toBe(uk['{0} sets · {1} work'])
  })
})

// A session's length in the UI language. The units were Latin letters in every pack, so an
// Arabic or Ukrainian History row read "34 min" and "1h 5m" in the middle of its own script.
describe('fmtDur', () => {
  afterEach(() => _setLangState('en', {}, null, null))

  it('reads minutes, and hours with minutes past the hour, in English as before', () => {
    expect(fmtDur(34 * 60000)).toBe('34 min')
    expect(fmtDur(175 * 60000)).toBe('2h 55m')
  })

  it('uses each pack\'s own units', () => {
    _setLangState('ar', ar, null, null)
    expect(fmtDur(34 * 60000)).toBe('34 دقيقة')
    expect(fmtDur(65 * 60000)).toBe('1 ساعة 5 دقيقة')
    _setLangState('uk', uk, null, null)
    expect(fmtDur(34 * 60000)).toBe('34 хв')
    expect(fmtDur(65 * 60000)).toBe('1 год 5 хв')
  })
})
