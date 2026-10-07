import { afterEach, describe, expect, it } from 'vitest'
import { fmtAgo, fmtDaysAgo, changeCount, setsWorkCount, fmtDur, fmtDate } from './format.js'
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

// The "Last time (…)" line of a workout (#363): calendar days back from the session's own day.
describe('fmtDaysAgo', () => {
  afterEach(() => _setLangState('en', {}, null, null))
  const day = '2026-10-04'
  const back = n => { const d = new Date(Date.UTC(2026, 9, 4 - n)); return d.toISOString().slice(0, 10) }

  it('days for the first week, then weeks, then months', () => {
    expect(fmtDaysAgo(back(0), day)).toBe('today')
    expect(fmtDaysAgo(back(1), day)).toBe('yesterday')
    expect(fmtDaysAgo(back(2), day)).toBe('2 days ago')
    expect(fmtDaysAgo(back(6), day)).toBe('6 days ago')
    expect(fmtDaysAgo(back(7), day)).toBe('last week')
    expect(fmtDaysAgo(back(13), day)).toBe('last week')
    expect(fmtDaysAgo(back(14), day)).toBe('2 weeks ago')
    expect(fmtDaysAgo(back(34), day)).toBe('4 weeks ago')
    expect(fmtDaysAgo(back(35), day)).toBe('last month')
    expect(fmtDaysAgo(back(60), day)).toBe('last month')
    expect(fmtDaysAgo(back(61), day)).toBe('2 months ago')
    expect(fmtDaysAgo(back(364), day)).toBe('11 months ago')
  })

  it('a year or more back is the date with its year', () => {
    expect(fmtDaysAgo(back(365), day)).toBe(fmtDate(back(365), false, true))
    expect(fmtDaysAgo('2024-03-02', day)).toMatch(/2024/)
  })

  it('counts calendar days across a DST change, not 24-hour blocks', () => {
    // Europe: clocks go forward on 2026-03-29 and back on 2026-10-25.
    expect(fmtDaysAgo('2026-03-28', '2026-03-30')).toBe('2 days ago')
    expect(fmtDaysAgo('2026-10-24', '2026-10-26')).toBe('2 days ago')
    expect(fmtDaysAgo('2026-03-29', '2026-03-30')).toBe('yesterday')
  })

  it('counts from the given day, so a workout logged into the past reads correctly', () => {
    expect(fmtDaysAgo('2026-09-01', '2026-09-04')).toBe('3 days ago')
  })

  it('a day after the reference day (a clock set back) reads as today', () => {
    expect(fmtDaysAgo('2026-10-06', day)).toBe('today')
  })

  it('in the UI language, from the platform', () => {
    _setLangState('de', {}, null, null)
    expect(fmtDaysAgo(back(1), day)).toBe('gestern')
    expect(fmtDaysAgo(back(3), day)).toBe('vor 3 Tagen')
    expect(fmtDaysAgo(back(14), day)).toBe('vor 2 Wochen')
  })
})
