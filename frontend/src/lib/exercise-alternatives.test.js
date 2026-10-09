import { describe, expect, it } from 'vitest'
import { alternativesScope, rankAlternatives } from './exercise-alternatives.js'
import { BODYPARTS } from './exercises.js'

const ex = (id, tg, eq) => ({ id, bp: 'chest', tg, eq })

describe('alternativesScope', () => {
  it('opens on the exercise’s own body part', () => {
    expect(alternativesScope({ id: 'a', bp: BODYPARTS[0] })).toBe(BODYPARTS[0])
  })
  it('opens on All when there is nothing to go by or no chip for it', () => {
    expect(alternativesScope(null)).toBe('')
    expect(alternativesScope({ id: 'x', bp: '' })).toBe('')
    expect(alternativesScope({ id: 'x', bp: 'not a body part' })).toBe('')
  })
})

describe('rankAlternatives', () => {
  const like = ex('bench', 'pectorals', 'barbell')

  it('puts the same target muscle first, then the same equipment, and the exercise itself last', () => {
    const list = [
      ex('bench', 'pectorals', 'barbell'),
      ex('fly', 'pectorals', 'cable'),
      ex('pushup', 'serratus', 'body weight'),
      ex('db-press', 'pectorals', 'dumbbell'),
      ex('close-grip', 'triceps', 'barbell'),
      ex('incline-bb', 'pectorals', 'barbell'),
    ]
    expect(rankAlternatives(list, like).map(e => e.id))
      .toEqual(['incline-bb', 'fly', 'db-press', 'close-grip', 'pushup', 'bench'])
  })

  it('keeps the incoming order within a rank', () => {
    const list = [ex('c', 'pectorals', 'cable'), ex('a', 'pectorals', 'cable'), ex('b', 'pectorals', 'cable')]
    expect(rankAlternatives(list, like).map(e => e.id)).toEqual(['c', 'a', 'b'])
  })

  it('leaves the list alone when there is no exercise to compare with', () => {
    const list = [ex('a', 'x', 'y')]
    expect(rankAlternatives(list, null)).toBe(list)
  })

  it('does not reward a shared blank target or equipment', () => {
    const blank = { id: 'custom', bp: 'chest', tg: '', eq: '' }
    const list = [ex('a', 'pectorals', 'barbell'), { id: 'b', bp: 'chest', tg: '', eq: '' }]
    expect(rankAlternatives(list, blank).map(e => e.id)).toEqual(['a', 'b'])
  })
})
