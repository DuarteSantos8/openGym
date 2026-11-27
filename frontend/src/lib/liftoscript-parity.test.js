import { describe, it, expect } from 'vitest'
import { simulateParity, MAX_WEEKS } from './liftoscript-parity.js'
import { EXDB } from './exercises.js'

// A plainly loaded barbell-style lift, as in progression.default.test.js.
const LIFT = EXDB.find(e => e.bp !== 'cardio' && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp) &&
  !['body weight', 'band', 'resistance band'].includes(e.eq) && !e.assisted)?.id
const LP = 'if (completedReps >= reps) { weight += 2.5 }'
const H = true, M = false
const base = { exId: LIFT, sets: 3, reps: 5, start: 60 }

describe('Liftoscript vs openGym progression, 8–12 week simulations (EP09-T04)', () => {
  it('a linear script matches the native linear rule over 12 weeks without three misses in a row', () => {
    const outcomes = [H, H, M, H, H, M, M, H, H, H, M, H]
    const res = simulateParity({ ...base, script: LP, outcomes })
    expect(res.error).toBeUndefined()
    expect(res.divergences).toBe(0)
    expect(res.unsafe).toBe(0)
    expect(res.weeks).toHaveLength(12)
    expect(res.weeks.at(-1).native).toBe(60 + 8 * 2.5)
  })

  it('never adds load after a missed session, in either rule', () => {
    const res = simulateParity({ ...base, script: LP, outcomes: [H, M, H, M, H, M, H, M] })
    for (const w of res.weeks.filter(x => !x.hit)) {
      expect(w.native).toBeLessThanOrEqual(w.weight)
      expect(w.script).toBeLessThanOrEqual(w.weight)
    }
  })

  it('reports the native deload a stateless script cannot express, instead of hiding it', () => {
    const res = simulateParity({ ...base, script: LP, outcomes: [H, M, M, M, H, H, H, H] })
    const deload = res.weeks.find(w => w.nativeKind === 'deload')
    expect(deload, 'the native rule deloads after repeated misses').toBeTruthy()
    expect(deload.native).toBeLessThan(deload.weight)
    expect(deload.diverges).toBe(true)
    expect(deload.script).toBe(deload.weight)
    expect(res.divergences).toBeGreaterThan(0)
  })

  it('flags a script that adds load after a miss as unsafe', () => {
    const res = simulateParity({ ...base, script: 'weight += 2.5', outcomes: [H, M, H, M, H, H, H, H] })
    expect(res.unsafe).toBe(2)
    expect(res.weeks.filter(w => w.unsafe).every(w => !w.hit)).toBe(true)
  })

  it('stops at an invalid script with its reason and keeps the weeks already simulated', () => {
    const res = simulateParity({ ...base, script: 'weight = fetch(1)', outcomes: [H, H, H, H, H, H, H, H] })
    expect(res.error).toMatch(/Unknown|Expected|Unexpected/)
    expect(res.weeks).toEqual([])
  })

  it('is deterministic and bounded', () => {
    const args = { ...base, script: LP, outcomes: [H, H, M, H, H, H, H, M, H, H] }
    expect(simulateParity(args)).toEqual(simulateParity(args))
    expect(() => simulateParity({ ...base, script: LP, outcomes: Array(MAX_WEEKS + 1).fill(H) })).toThrow()
    expect(() => simulateParity({ ...base, script: LP, outcomes: [] })).toThrow()
    expect(() => simulateParity({ ...base, script: LP, outcomes: [H], start: -5 })).toThrow()
  })
})
