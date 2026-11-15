// QA66: a carry's plan line read "Plan: 2 × 20 m" for a 40 m carry. The plan stamped on the
// session (plannedOf) now keeps the metres; an older stamp without them changes no plan.
import { describe, it, expect } from 'vitest'
import { plannedOf, planChanged } from './progression.js'
import { setsRepsOf } from './history.js'

describe('a carry\'s planned distance', () => {
  const carry = { id: '2133', mode: 'distance', sets: 2, m: 40, weight: 24 }
  it('is stamped and read back as the routine said', () => {
    expect(plannedOf(carry)).toMatchObject({ sets: 2, m: 40 })
    expect(setsRepsOf({ ...plannedOf(carry), mode: 'distance' })).toBe('2 × 40 m')
  })
  it('a stamp from before (no metres) is not a changed plan', () => {
    expect(planChanged({ sets: 2, weight: 24 }, carry)).toBe(false)
    expect(planChanged(plannedOf(carry), carry)).toBe(false)
  })
})
