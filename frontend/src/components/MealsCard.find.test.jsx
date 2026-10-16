// @vitest-environment happy-dom
// MealsCard's `find`: the entry's meal opens and the entry flashes; with nothing to find, or an
// entry the day does not hold, nothing moves. The route that sets it is FoodHub.find.test.jsx.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MealsCard from './MealsCard.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

const day = {
  settings: { mealNames: ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] },
  entry: { items: [
    { uuid: 'a', meal: 0, name: 'Oats', quantity: 1, nutrition: { calories: 300 }, addedAt: '2026-10-11T07:00:00Z' },
    { uuid: 'b', meal: 1, name: 'Chicken bowl', quantity: 1, nutrition: { calories: 640 }, addedAt: '2026-10-11T12:00:00Z' },
  ] },
  activityRows: [], target: {}, activitySum: null,
}
const render = find => act(() => root.render(<MealsCard date="2026-10-11" day={day} find={find} />))
const toggles = () => [...host.querySelectorAll('.meal-toggle')]

describe('MealsCard and find', () => {
  it('opens the meal that holds the entry and flashes it', () => {
    render('b')
    expect(toggles().map(b => b.getAttribute('aria-expanded'))).toEqual(['false', 'true', 'false', 'false'])
    expect(host.querySelector('li.flash-find').textContent).toContain('Chicken bowl')
  })

  it('does nothing for an entry the day does not hold, or without a find', () => {
    render('zzz')
    expect(toggles().every(b => b.getAttribute('aria-expanded') === 'false')).toBe(true)
    render(null)
    expect(host.querySelector('.flash-find')).toBeNull()
  })
})
