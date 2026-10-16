// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RANGE, rangeFrom, rangeOptions, rangeStart, rememberRange, storedRange } from './progress-range.js'

const KEY = 'gains.progressRange'

beforeEach(() => localStorage.clear())
afterEach(() => vi.useRealTimers())

describe('rangeOptions', () => {
  it('offers 1M, 3M, 1Y and All, All being 0 days', () => {
    expect(rangeOptions()).toEqual([
      { value: 30, label: '1M' }, { value: 90, label: '3M' }, { value: 365, label: '1Y' }, { value: 0, label: 'All' },
    ])
  })
})

describe('rangeFrom', () => {
  it('reads a range the tab offers, including All (0)', () => {
    expect(rangeFrom('?range=30', 90)).toBe(30)
    expect(rangeFrom('?range=365', 90)).toBe(365)
    expect(rangeFrom('?range=0', 90)).toBe(0)
  })

  it('falls back when there is no range, or one that is not offered', () => {
    expect(rangeFrom('', 90)).toBe(90)
    expect(rangeFrom('?metric=steps', 365)).toBe(365)
    expect(rangeFrom('?range=45', 30)).toBe(30)
    expect(rangeFrom('?range=abc', 30)).toBe(30)
    expect(rangeFrom('?range=', 30)).toBe(30)
  })

  it('keeps other query parameters out of the way', () => {
    expect(rangeFrom('?metric=steps&range=365', 90)).toBe(365)
  })
})

describe('storedRange and rememberRange', () => {
  it('starts a first visit at 3M', () => {
    expect(DEFAULT_RANGE).toBe(90)
    expect(storedRange()).toBe(90)
  })

  it('remembers the last pick, All included', () => {
    rememberRange(365)
    expect(localStorage.getItem(KEY)).toBe('365')
    expect(storedRange()).toBe(365)
    rememberRange(0)
    expect(storedRange()).toBe(0)
    rememberRange(30)
    expect(storedRange()).toBe(30)
  })

  it('ignores a value the tab does not offer', () => {
    rememberRange(30)
    rememberRange(45)
    rememberRange('90')
    rememberRange(undefined)
    expect(storedRange()).toBe(30)
  })

  it.each(['45', 'abc', '', 'null'])('reads a stored %j as 3M', raw => {
    localStorage.setItem(KEY, raw)
    expect(storedRange()).toBe(90)
  })

  it('survives a storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(storedRange()).toBe(90)
    expect(() => rememberRange(30)).not.toThrow()
    vi.restoreAllMocks()
  })
})

describe('rangeStart', () => {
  it('is everything (0) for All, else that many days back', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-30T12:00:00Z'))
    expect(rangeStart(0)).toBe(0)
    expect(rangeStart(30)).toBe(Date.now() - 30 * 86400000)
    expect(rangeStart(365)).toBe(Date.now() - 365 * 86400000)
  })
})
