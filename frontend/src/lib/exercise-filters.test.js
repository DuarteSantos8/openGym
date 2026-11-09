import { describe, it, expect } from 'vitest'
import { EXDB } from './exercises.js'
import { MUSCLES } from './muscles.js'
import {
  MUSCLE_GROUPS, BACK_MUSCLES, EQUIP_GROUPS, equipGroupOf, matchesEquip, matchesMuscles, isCardioEx,
} from './exercise-filters.js'

const byId = id => EXDB.find(e => e.id === id)

describe('muscle filter', () => {
  it('lists every muscle of the map exactly once, plus cardio', () => {
    const all = MUSCLE_GROUPS.flatMap(g => g.ids)
    expect(new Set(all).size).toBe(all.length)
    expect([...MUSCLES].sort()).toEqual(all.filter(id => id !== 'cardio').sort())
    expect(all).toContain('cardio')
  })
  it('draws a muscle from behind only when it is a back one', () => {
    for (const id of BACK_MUSCLES) expect(MUSCLES).toContain(id)
    expect(BACK_MUSCLES.has('chest')).toBe(false)
  })
  it('matches a primary muscle, not a secondary one', () => {
    const bench = byId('0025')   // chest primary, triceps secondary
    expect(matchesMuscles(bench, ['chest'])).toBe(true)
    expect(matchesMuscles(bench, ['triceps'])).toBe(false)
    expect(matchesMuscles(bench, ['biceps'])).toBe(false)
  })
  it('matches any of several muscles, and everything when none is chosen', () => {
    const bench = byId('0025')
    expect(matchesMuscles(bench, ['biceps', 'chest'])).toBe(true)
    expect(matchesMuscles(bench, [])).toBe(true)
    expect(matchesMuscles(bench, undefined)).toBe(true)
  })
  it('treats cardio as a kind of exercise', () => {
    const cardio = EXDB.find(isCardioEx)
    expect(cardio).toBeTruthy()
    expect(matchesMuscles(cardio, ['cardio'])).toBe(true)
    expect(matchesMuscles(byId('0025'), ['cardio'])).toBe(false)
  })
  it('finds a reasonable share of the catalogue under each muscle', () => {
    for (const id of MUSCLES) expect(EXDB.filter(e => matchesMuscles(e, [id])).length, id).toBeGreaterThan(0)
  })
})

describe('equipment filter', () => {
  it('puts every catalogue equipment kind in exactly one group', () => {
    const kinds = [...new Set(EXDB.map(e => e.eq))]
    for (const k of kinds) expect(EQUIP_GROUPS.filter(g => g.id === equipGroupOf(k))).toHaveLength(1)
    const listed = EQUIP_GROUPS.flatMap(g => g.values)
    expect(new Set(listed).size).toBe(listed.length)   // no kind in two groups
  })
  it('folds the many kinds into the ten a lifter thinks in', () => {
    expect(EQUIP_GROUPS).toHaveLength(10)
    expect(equipGroupOf('ez barbell')).toBe('barbell')
    expect(equipGroupOf('leverage machine')).toBe('machine')
    expect(equipGroupOf('body weight')).toBe('none')
    expect(equipGroupOf('resistance band')).toBe('band')
  })
  it('sends the unknown, the empty and a custom exercise to Other', () => {
    expect(equipGroupOf('something new')).toBe('other')
    expect(equipGroupOf('')).toBe('other')
    expect(equipGroupOf(undefined)).toBe('other')
    expect(equipGroupOf('custom')).toBe('other')
  })
  it('matches any of several groups, and everything when none is chosen', () => {
    const bench = byId('0025')   // barbell
    expect(matchesEquip(bench, ['barbell'])).toBe(true)
    expect(matchesEquip(bench, ['dumbbell', 'barbell'])).toBe(true)
    expect(matchesEquip(bench, ['dumbbell'])).toBe(false)
    expect(matchesEquip(bench, [])).toBe(true)
  })
})
