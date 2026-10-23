import { describe, expect, it } from 'vitest'
import { cardShown, homeOrderOf, moveCard } from './home-layout.js'

describe('Home cards below the week', () => {
  it('a profile that never arranged them gets the default order', () => {
    expect(homeOrderOf({})).toEqual(['checkin', 'weight', 'health', 'streak'])
  })
  it('keeps the chosen order, drops unknown ids, and puts a card it does not name last', () => {
    expect(homeOrderOf({ homeOrder: ['streak', 'nope', 'health'] })).toEqual(['streak', 'health', 'checkin', 'weight'])
  })
  it('a card shows unless its switch is off; check-in and weight keep their own switches', () => {
    expect(cardShown({}, 'health')).toBe(true)
    expect(cardShown({ showHealthCard: false }, 'health')).toBe(false)
    expect(cardShown({ checkIn: false }, 'checkin')).toBe(false)
    expect(cardShown({ showWeightCard: false }, 'weight')).toBe(false)
  })
  it('moves a card up and down, not past either end', () => {
    const o = ['checkin', 'weight', 'health', 'streak']
    expect(moveCard(o, 'health', -1)).toEqual(['checkin', 'health', 'weight', 'streak'])
    expect(moveCard(o, 'checkin', -1)).toBe(o)
    expect(moveCard(o, 'streak', 1)).toBe(o)
  })
})
