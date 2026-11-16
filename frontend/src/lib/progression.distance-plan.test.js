// A carry planned at 40 m read "Plan: 2 × 20 m" on the workout screen: the plan the session
// compares against left the distance out (QA 1.4.5). On v2 it is the slot's metres, never last time's.
import { describe, expect, it } from 'vitest'
import { setsRepsOf } from './history.js'
import { migratedFixture } from './test-fixtures.js'
import { buildSessionExposures } from './session-start.js'
import { entriesForExposures } from './session-ui-adapter.js'

const carry = { id: '2133', mode: 'distance', sets: 2, m: 40, weight: 24 }
const planned = (slot, workouts = []) => {
  const P = migratedFixture({ unit: 'kg', routines: [{ id: 'r', name: 'R', ex: [slot] }], workouts })
  const draft = { ...P, prescriptions: { ...P.prescriptions } }
  const xs = buildSessionExposures(draft, P.routines[0], { now: Date.parse('2026-11-05T12:00:00Z'), newId: x => x })
  return entriesForExposures(xs, draft.prescriptions)[0].planned
}

describe('a carry keeps its distance in the plan', () => {
  it('reads the metres the routine said, also after a longer carry last time', () => {
    expect(planned(carry)).toEqual({ sets: 2, m: 40 })
    expect(setsRepsOf({ ...planned(carry), mode: 'distance' })).toBe('2 × 40 m')
    const last = [{ id: 'w', d: '2026-11-01', start: 1, end: 2, routineIds: ['r'], entries: [{ id: '2133', rid: 'r', target: carry, sets: [{ m: 60, w: 24, done: true }] }] }]
    expect(planned(carry, last).m).toBe(40)
  })
  it('leaves the distance off everything else', () => {
    expect('m' in planned({ id: '0025', sets: 3, reps: 5 })).toBe(false)
    expect('m' in planned({ id: '0463', mode: 'time', sets: 2, sec: 30 })).toBe(false)
  })
})
