import { describe, expect, it } from 'vitest'
import { buildPlanBundle, mergePlan, parsePlan } from './plan-share.js'

// "Repeat last workout" is how the routine is meant to be trained, so a shared plan keeps it.
const stateWith = routine => ({
  routines: [{ id: 'r1', name: 'Technique', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60 }], ...routine }],
  week: {}, customEx: [],
})

describe('plan-share and a routine that repeats its last workout', () => {
  it('carries the switch through export and merge', () => {
    const bundle = parsePlan(JSON.stringify(buildPlanBundle(stateWith({ startFromLast: true }), 'Plan')))
    expect(bundle.routines[0].startFromLast).toBe(true)
    const target = { routines: [], week: {}, customEx: [] }
    mergePlan(target, bundle)
    expect(target.routines[0].startFromLast).toBe(true)
  })

  it('writes nothing for a routine without it', () => {
    const bundle = buildPlanBundle(stateWith({}), 'Plan')
    expect('startFromLast' in bundle.routines[0]).toBe(false)
    const target = { routines: [], week: {}, customEx: [] }
    mergePlan(target, parsePlan(JSON.stringify(bundle)))
    expect('startFromLast' in target.routines[0]).toBe(false)
  })
})
