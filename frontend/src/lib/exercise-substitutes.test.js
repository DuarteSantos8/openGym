import { describe, expect, it } from 'vitest'
import { EXDB, EXIDX } from './exercises.js'
import { eqAvailable } from './equipment.js'
import { SUBSTITUTE_FAMILIES, suggestedSubstitutes } from './exercise-substitutes.js'

describe('reviewed substitutes', () => {
  it('has unique, existing catalogue IDs and excludes self, other muscles and fly movements', () => {
    const ids = Object.values(SUBSTITUTE_FAMILIES).flat()
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter(id => !EXIDX[id])).toEqual([])
    const candidates = ['0025', '0308', '0405', '0289', '0662'].map(id => EXIDX[id])
    expect(suggestedSubstitutes(candidates, EXIDX['0025']).map(e => e.id)).toEqual(['0289', '0662'])
  })
  it('respects equipment and accessories, preserves favourite order and caps suggestions', () => {
    const available = EXDB.filter(e => eqAvailable(['dumbbell'], e))
    const suggestions = suggestedSubstitutes(available, EXIDX['0025'])
    expect(suggestions.map(e => e.id)).toEqual(['0662'])
    const ordered = ['0662', '0289', '0748', '0576'].map(id => EXIDX[id])
    expect(suggestedSubstitutes(ordered, EXIDX['0025']).map(e => e.id)).toEqual(['0662', '0289', '0748'])
  })
  it('does not guess for unknown, custom or missing exercise metadata', () => {
    expect(suggestedSubstitutes(EXDB, { id: 'custom', n: 'bench press', tg: 'pectorals' })).toEqual([])
    expect(suggestedSubstitutes(EXDB, { ...EXIDX['0025'], custom: true })).toEqual([])
    expect(suggestedSubstitutes(EXDB, null)).toEqual([])
    expect(suggestedSubstitutes(EXDB, { id: '0025' })).toEqual([])
  })
})
