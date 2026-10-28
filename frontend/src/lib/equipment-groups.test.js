import { describe, expect, it } from 'vitest'
import { ALL_EQUIPMENT } from './equipment.js'
import { EXDB } from './exercises-data.js'
import { EQUIP_GROUPS, groupOf, groupKinds, groupValue, groupIdOf, eqMatches, eqOnAmong } from './equipment-groups.js'

describe('equipment groups', () => {
  it('names every kind the catalogue and an equipment profile know, each in one group', () => {
    const named = EQUIP_GROUPS.flatMap(g => g.kinds)
    expect(new Set(named).size).toBe(named.length)
    for (const k of ALL_EQUIPMENT) expect(named, k).toContain(k)
    for (const k of new Set(EXDB.map(e => e.eq).filter(Boolean))) expect(named, k).toContain(k)
    expect(groupOf('something new')).toBe('other')
  })

  it('sorts kinds into the groups in the groups’ order, an empty group left out', () => {
    expect(groupKinds(['cable', 'dumbbell', 'body weight', 'kettlebell', 'something new'])).toEqual([
      { id: 'bw', label: 'Body weight', kinds: ['body weight'] },
      { id: 'free', label: 'Free weights', kinds: ['dumbbell', 'kettlebell'] },
      { id: 'cable', label: 'Cables', kinds: ['cable'] },
      { id: 'other', label: 'Other', kinds: ['something new'] },
    ])
    expect(groupKinds(null)).toEqual([])
  })

  it('a filter value is a kind or a whole group', () => {
    expect(groupIdOf(groupValue('free'))).toBe('free')
    expect(groupIdOf('dumbbell')).toBe(null)
    expect(eqMatches('', { eq: 'cable' })).toBe(true)
    expect(eqMatches('dumbbell', { eq: 'kettlebell' })).toBe(false)
    expect(eqMatches(groupValue('free'), { eq: 'kettlebell' })).toBe(true)
    expect(eqMatches(groupValue('free'), { eq: 'barbell' })).toBe(false)
    expect(eqMatches(groupValue('other'), { eq: 'something new' })).toBe(true)
    expect(eqMatches(groupValue('free'), {})).toBe(false)
  })

  it('keeps a filter only while the list has something under it (#71)', () => {
    expect(eqOnAmong(groupValue('free'), ['kettlebell', 'cable'])).toBe(groupValue('free'))
    expect(eqOnAmong(groupValue('free'), ['cable'])).toBe('')
    expect(eqOnAmong('cable', ['cable'])).toBe('cable')
    expect(eqOnAmong('dumbbell', ['cable'])).toBe('')
    expect(eqOnAmong('', ['cable'])).toBe('')
  })
})
