// @vitest-environment happy-dom
// Seasonal themes (lib/seasonal.js): the date window, the choice, the opt-in colours, once a day.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEMES, inSeason, seasonChoice, themeOn, activeSeason, seasonAccent, seasonInWorkout, onceToday, doneToday } from './seasonal.js'

const local = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min)

describe('the Halloween window', () => {
  it('runs from 1 October to the end of 31 October, local time', () => {
    expect(inSeason('halloween', local(2026, 9, 30, 23, 59))).toBe(false)
    expect(inSeason('halloween', local(2026, 10, 1, 0, 0))).toBe(true)
    expect(inSeason('halloween', local(2026, 10, 31, 23, 59))).toBe(true)
    expect(inSeason('halloween', local(2026, 11, 1, 0, 0))).toBe(false)
    expect(inSeason('halloween', local(2027, 3, 1))).toBe(false)
  })

  it('follows the clock on the wall, not UTC: one instant, two answers', () => {
    const was = process.env.TZ
    try {
      const instant = new Date(Date.UTC(2026, 9, 31, 23, 30))   // 31 Oct 23:30 UTC
      process.env.TZ = 'America/Los_Angeles'                    // 31 Oct, 16:30: still Halloween
      expect(inSeason('halloween', new Date(instant))).toBe(true)
      process.env.TZ = 'Pacific/Auckland'                       // 1 Nov, 12:30: over
      expect(inSeason('halloween', new Date(instant))).toBe(false)
    } finally {
      if (was === undefined) delete process.env.TZ; else process.env.TZ = was
    }
  })

  it('a window may wrap the new year', () => {
    const winter = { id: 'x', from: [12, 20], to: [1, 6] }
    expect(inSeason(winter, local(2026, 12, 31))).toBe(true)
    expect(inSeason(winter, local(2027, 1, 6))).toBe(true)
    expect(inSeason(winter, local(2027, 1, 7))).toBe(false)
  })

  it('every theme in the list has the fields the settings page reads', () => {
    for (const th of THEMES) {
      expect(th.title && th.during && th.back && th.icon, th.id).toBeTruthy()
      expect(th.from).toHaveLength(2)
      expect(th.to).toHaveLength(2)
      if (th.colors) expect(th.colorsTitle && th.colorsNote, th.id).toBeTruthy()
    }
  })
})

describe('the choice', () => {
  const oct = local(2026, 10, 25), may = local(2026, 5, 3)
  it('absent, or a value it does not know, reads as Auto', () => {
    expect(seasonChoice({}, 'halloween')).toBe('auto')
    expect(seasonChoice({ seasonal: { halloween: 'spooky' } }, 'halloween')).toBe('auto')
    expect(themeOn({}, 'halloween', oct)).toBe(true)
    expect(themeOn({}, 'halloween', may)).toBe(false)
  })
  it('On shows it all year, Off never', () => {
    expect(themeOn({ seasonal: { halloween: 'on' } }, 'halloween', may)).toBe(true)
    expect(themeOn({ seasonal: { halloween: 'off' } }, 'halloween', oct)).toBe(false)
    expect(activeSeason({ seasonal: { halloween: 'off' } }, oct)).toBe(null)
    expect(activeSeason({}, oct)).toBe('halloween')
  })
  it('the colours stand in for the accent only while the theme shows, and only when chosen', () => {
    expect(seasonAccent({}, oct)).toBe(null)
    expect(seasonAccent({ seasonal: { halloweenColors: true } }, oct)).toBe('orange')
    expect(seasonAccent({ seasonal: { halloweenColors: true } }, may)).toBe(null)
    expect(seasonAccent({ seasonal: { halloween: 'off', halloweenColors: true } }, oct)).toBe(null)
  })
})

describe('during workouts', () => {
  const oct = local(2026, 10, 25), may = local(2026, 5, 3)
  it('on by default while the theme shows, off when switched off, never out of season', () => {
    expect(seasonInWorkout({}, oct)).toBe(true)
    expect(seasonInWorkout({ seasonal: { halloweenWorkout: false } }, oct)).toBe(false)
    expect(seasonInWorkout({}, may)).toBe(false)
    expect(seasonInWorkout({ seasonal: { halloween: 'off' } }, oct)).toBe(false)
  })
})

describe('once a day', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())
  it('fires the first time on a local date, then not again until the next one', () => {
    const morning = local(2026, 10, 25, 7), night = local(2026, 10, 25, 23, 59), next = local(2026, 10, 26, 0, 1)
    expect(doneToday('spider', morning)).toBe(false)
    expect(onceToday('spider', morning)).toBe(true)
    expect(doneToday('spider', night)).toBe(true)
    expect(onceToday('spider', night)).toBe(false)
    expect(onceToday('spider', next)).toBe(true)
  })
  it('keys are separate: the spider does not use up the pumpkin', () => {
    const d = local(2026, 10, 25)
    expect(onceToday('spider', d)).toBe(true)
    expect(onceToday('pumpkin', d)).toBe(true)
  })
  it('storage that is not there answers no, so nothing repeats on every start', () => {
    const blocked = () => { throw new Error('blocked') }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, clear() {} })
    try {
      expect(onceToday('spider')).toBe(false)
      expect(doneToday('spider')).toBe(true)
    } finally { vi.unstubAllGlobals() }
  })
})
