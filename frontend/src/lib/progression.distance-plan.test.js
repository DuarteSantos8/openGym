// A carry planned at 40 m read "Plan: 2 × 20 m" on the workout screen: the plan stamped on the
// session (plannedOf) left the distance out, so the line fell back to the 20 m default (QA 1.4.5).
import { describe, expect, it } from 'vitest'
import { plannedOf, planChanged } from './progression.js'
import { setsRepsOf } from './history.js'

const carry = { id: '2133', mode: 'distance', sets: 2, m: 40, weight: 24 }

describe('a carry keeps its distance in the plan', () => {
  it('stamps the metres', () => {
    expect(plannedOf(carry)).toMatchObject({ sets: 2, m: 40, weight: 24 })
    expect(setsRepsOf({ ...plannedOf(carry), mode: 'distance' })).toBe('2 × 40 m')
  })
  it('sees a new distance as a changed plan', () => {
    expect(planChanged(plannedOf(carry), { ...carry, m: 60 })).toBe(true)
    expect(planChanged(plannedOf(carry), carry)).toBe(false)
  })
  it('does not call a plan stamped before the distance was a changed one', () => {
    expect(planChanged({ sets: 2, weight: 24 }, carry)).toBe(false)
  })
  it('leaves the distance off everything else', () => {
    expect('m' in plannedOf({ id: '0025', sets: 3, reps: 5, m: 40 })).toBe(false)
    expect('m' in plannedOf({ id: '0463', mode: 'time', sets: 2, sec: 30 })).toBe(false)
  })
})
