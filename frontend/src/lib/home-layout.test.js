import { describe, expect, it } from 'vitest'
import { cardAvailable, cardShown, homeOrderOf, moveCard, moveListed } from './home-layout.js'

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

describe('modules (Settings → Modules)', () => {
  it('a card whose module is off is not shown, whatever its own switch says', () => {
    expect(cardShown({ modules: { body: false } }, 'weight')).toBe(false)
    expect(cardShown({ modules: { health: false } }, 'health')).toBe(false)
    expect(cardShown({ modules: { checkin: false } }, 'checkin')).toBe(false)
    expect(cardAvailable({ modules: { checkin: false } }, 'checkin')).toBe(false)
    expect(cardShown({ modules: { checkin: true }, showCheckinCard: false }, 'checkin')).toBe(false)
    expect(cardShown({ modules: { checkin: true }, checkIn: false }, 'checkin')).toBe(true)
  })
  it('the streak card stays in the list with Motivation off (its weekly sets line lives on)', () => {
    expect(cardAvailable({ modules: { motivation: false } }, 'streak')).toBe(true)
  })
  it('moving a card skips the ones its module hides, which keep their places', () => {
    const order = ['checkin', 'weight', 'health', 'streak']
    const listed = ['checkin', 'health', 'streak']
    expect(moveListed(order, listed, 'health', -1)).toEqual(['health', 'weight', 'checkin', 'streak'])
    expect(moveListed(order, listed, 'checkin', -1)).toBe(order)
  })
})
