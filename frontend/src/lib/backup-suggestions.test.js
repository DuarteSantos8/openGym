import { describe, it, expect } from 'vitest'
import { backupSuggestions } from './backup-suggestions.js'

const ex = (id, over = {}) => ({ id, tg: 'pectorals', cat: 'strength', eq: 'leverage machine', ...over })

describe('backupSuggestions (#1003, no AI needed)', () => {
  const chest = ex('m1')
  const list = [
    chest,
    ex('m2'),
    ex('d1', { eq: 'dumbbell' }),
    ex('c1', { eq: 'cable' }),
    ex('b1', { tg: 'biceps', eq: 'dumbbell' }),
    ex('u1', { eq: 'dumbbell', custom: true }),
  ]

  it('offers the same muscle on other kit first, never the exercise itself or a custom one', () => {
    const got = backupSuggestions(list, chest).map(e => e.id)
    expect(got).toEqual(['d1', 'c1', 'm2'])
  })

  it('leaves out what is already a backup and what the gym does not have', () => {
    const got = backupSuggestions(list, chest, { taken: ['d1'], available: e => e.eq !== 'cable' }).map(e => e.id)
    expect(got).toEqual(['m2'])
  })

  it('stops at n and copes with nothing to go on', () => {
    expect(backupSuggestions(list, chest, { n: 1 }).map(e => e.id)).toEqual(['d1'])
    expect(backupSuggestions(list, null)).toEqual([])
    expect(backupSuggestions(list, ex('x', { tg: '' }))).toEqual([])
  })
})
