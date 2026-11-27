import { describe, expect, it } from 'vitest'
import { cleanPrizes, grantPrize, hasPrize, mergePrizes } from './prizes.js'
import { pickerChoices } from './streak-icons.js'
import { offeredIcons } from './app-icon-variants.js'
import { doorFor, presentFor } from '../seasonal/advent-doors.js'
import { mergeStates } from './sync-merge.js'

describe('presents kept for good', () => {
  it('keeps known ids once each, and nothing else', () => {
    expect(cleanPrizes(['festive-flame', 'x', 'festive-flame', 'xmas-icon-2026'])).toEqual(['xmas-icon-2026', 'festive-flame'])
    expect(cleanPrizes('nope')).toBeNull()
    expect(cleanPrizes([])).toBeNull()
  })

  it('given once, merged by union', () => {
    const s = {}
    expect(grantPrize(s, 'festive-flame')).toBe(true)
    expect(grantPrize(s, 'festive-flame')).toBe(false)
    expect(grantPrize(s, 'made-up')).toBe(false)
    expect(hasPrize(s, 'festive-flame')).toBe(true)
    expect(mergePrizes(['festive-flame'], ['xmas-icon-2026'])).toEqual(['xmas-icon-2026', 'festive-flame'])
    expect(mergePrizes(null, undefined)).toBeUndefined()
  })

  it('the festive flame and the Christmas icon are offered only to whoever was given them', () => {
    expect(pickerChoices({}, 'flame').map(c => c.v)).not.toContain('flameHat')
    expect(pickerChoices({ prizes: ['festive-flame'] }, 'flame').map(c => c.v)).toContain('flameHat')
    const dec = new Date(2026, 11, 13)
    expect(offeredIcons(dec, 'default', []).map(v => v.id)).not.toContain('christmas')
    expect(offeredIcons(new Date(2027, 5, 1), 'default', ['xmas-icon-2026']).map(v => v.id)).toContain('christmas')
  })

  it('a present given on one device survives the sync with another', () => {
    const a = { _ts: 2, workouts: [], routines: [], prizes: ['festive-flame'] }
    const b = { _ts: 1, workouts: [], routines: [], prizes: ['xmas-icon-2026'] }
    expect(mergeStates(a, b).prizes).toEqual(['xmas-icon-2026', 'festive-flame'])
    expect(mergeStates(b, a).prizes).toEqual(['xmas-icon-2026', 'festive-flame'])
  })

  it('2026: a present every Saturday, the 5th, 12th and 19th; later years keep the flame', () => {
    expect([5, 12, 19].map(d => presentFor(d, 2026))).toEqual(['nutrition', 'icon', 'flame'])
    expect(doorFor(12, 2026)).toMatchObject({ kind: 'present', present: 'icon' })
    expect(presentFor(12, 2027)).toBeNull()
    expect(presentFor(19, 2027)).toBe('flame')
    expect(presentFor(5, 2025)).toBeNull()
  })
})
