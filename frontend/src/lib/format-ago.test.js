import { afterEach, describe, expect, it } from 'vitest'
import { fmtAgo, fmtTrainingAgo, fmtDate, changeCount, setsWorkCount, fmtDur } from './format.js'
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

// #363: the reference line under a set used to print the calendar date, and the only way
// to know "how long ago" was to subtract from today. Weeks and months are exact multiples;
// anything else stays a day count. A year or more is a date again.
describe('fmtTrainingAgo', () => {
  const now = new Date(2026, 9, 6, 15, 0, 0)
  const ago = iso => fmtTrainingAgo(iso, now)

  it('reads today, yesterday and a handful of days', () => {
    expect(ago('2026-10-06')).toBe('today')
    expect(ago('2026-10-05')).toBe('yesterday')
    expect(ago('2026-10-04')).toBe('2 days ago')
    expect(ago('2026-09-30')).toBe('6 days ago')
  })

  it('uses a week or a month when the gap is an exact one, and days otherwise', () => {
    expect(ago('2026-09-29')).toBe('1 week ago')
    expect(ago('2026-09-28')).toBe('8 days ago')
    expect(ago('2026-09-22')).toBe('2 weeks ago')
    expect(ago('2026-09-18')).toBe('18 days ago')
    expect(ago('2026-09-06')).toBe('1 month ago')
    expect(ago('2026-08-29')).toBe('38 days ago')
    expect(ago('2026-08-07')).toBe('2 months ago')
  })

  it('keeps a date once the session is a year old, or dated in the future', () => {
    expect(ago('2025-10-06')).toBe(fmtDate('2025-10-06'))
    expect(ago('2026-10-07')).toBe(fmtDate('2026-10-07'))
  })

  it('does not change how a sync time is worded', () => {
    expect(fmtAgo(Date.UTC(2026, 8, 23, 12, 0, 0) - 9 * 86400000, Date.UTC(2026, 8, 23, 12, 0, 0))).toBe('9 days ago')
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
