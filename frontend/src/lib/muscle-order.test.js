// A custom exercise used to store its muscles in the order the chips were tapped, so the same
// exercise read differently depending on how it was built (Discord, luckapow).
import { describe, expect, it } from 'vitest'
import { inMuscleOrder, MUSCLES } from './muscles.js'

describe('muscles in the map order', () => {
  it('is the same list whatever order it was picked in', () => {
    expect(inMuscleOrder(['triceps', 'chest', 'deltoids'])).toEqual(['deltoids', 'chest', 'triceps'])
    expect(inMuscleOrder(['chest', 'deltoids', 'triceps'])).toEqual(['deltoids', 'chest', 'triceps'])
  })
  it('follows MUSCLES, leaves unknown names at the end and the input alone', () => {
    const picked = ['calves', 'made-up', 'abs']
    expect(inMuscleOrder(picked)).toEqual(['abs', 'calves', 'made-up'])
    expect(picked).toEqual(['calves', 'made-up', 'abs'])
    expect(inMuscleOrder([...MUSCLES].reverse())).toEqual(MUSCLES)
    expect(inMuscleOrder(undefined)).toEqual([])
  })
})
