import { describe, expect, it } from 'vitest'
import { EXDB, EXIDX } from './exercises.js'
import { eqAvailable } from './equipment.js'
import { SUBSTITUTE_FAMILIES, suggestedSubstitutes, relatedSubstitutes } from './exercise-substitutes.js'

describe('reviewed substitutes', () => {
  it('covers every catalogue exercise, without relying on a manually mapped movement family', () => {
    const missing = EXDB.filter(exercise => !relatedSubstitutes(EXDB, exercise).length)
    expect(missing.map(e => ({ id: e.id, name: e.n }))).toEqual([])
    expect(relatedSubstitutes(EXDB, EXIDX['8877']).every(e => e.tg === 'forearms')).toBe(true)
    expect(relatedSubstitutes(EXDB, EXIDX['5897']).every(e => e.cat === 'yoga')).toBe(true)
  }, 20000)
  it('offers lat stretches for dead hang without suggesting loaded pulls or unavailable hanging equipment', () => {
    const ex = EXIDX['5055']
    expect(suggestedSubstitutes(EXDB, ex)).toEqual([])
    const available = EXDB.filter(e => eqAvailable([], e))
    const related = relatedSubstitutes(available, ex)
    expect(related).toHaveLength(3)
    expect(related.every(e => e.tg === 'lats' && e.cat === 'stretching' && e.id !== ex.id)).toBe(true)
    expect(available.some(e => e.id === '10438')).toBe(false)
    expect(eqAvailable(['pull-up bar'], EXIDX['10438'])).toBe(true)
    expect(relatedSubstitutes(EXDB, { tg: 'lats' })).toEqual([])
    expect(relatedSubstitutes(EXDB, null)).toEqual([])
  })
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
