import { describe, it, expect } from 'vitest'
import { CARDS, cardOrder, isShown, toggle, move, homeItems } from './garmin-layout.js'

describe('garmin layout', () => {
  it('keeps the own order and adds new cards at the end', () => {
    const o = cardOrder({ cards: ['acts', 'nope', 'ready'] })
    expect(o.slice(0, 2)).toEqual(['acts', 'ready'])
    expect(o).toHaveLength(CARDS.length)
  })
  it('hides, shows and moves', () => {
    expect(isShown({ hidden: ['zones'] }, 'zones')).toBe(false)
    expect(toggle({ hidden: ['zones'] }, 'zones', true)).toEqual({ hidden: [] })
    expect(toggle({}, 'run', false)).toEqual({ hidden: ['run'] })
    expect(move({}, 'ready', -1).cards.slice(0, 2)).toEqual(['ready', 'sick'])
    expect(move({}, 'sick', -1).cards[0]).toBe('sick')
  })
  it('home items default to the first three', () => {
    expect(homeItems({})).toEqual(['bb', 'sleep', 'hrv'])
    expect(homeItems({ home: [] })).toEqual([])
  })
})
