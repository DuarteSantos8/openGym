// Cluster as a set type (1.4.5): every work set cut into mini-sets at the same weight.
import { describe, expect, it } from 'vitest'
import { applyIntensifierPlan } from './history.js'
import { isClusterSet, clustersOf } from './workout-model.js'

describe('cluster plan', () => {
  const cfg = { id: '0025', sets: 3, reps: 9, intensifier: { type: 'cluster', size: 3, restSec: 20 } }
  const rows = [{ w: 60, r: 5, phase: 'warmup' }, { w: 100, r: 9 }, { w: 100, r: 9 }, { w: 100, r: 9 }]
  it('cuts every work set and leaves the warm-up alone', () => {
    const out = applyIntensifierPlan(rows, cfg, 2.5)
    expect(out).toHaveLength(4)
    expect(isClusterSet(out[0])).toBe(false)
    for (const r of out.slice(1)) {
      expect(isClusterSet(r)).toBe(true)
      expect(r.r).toBe(9)
      expect(r.w).toBe(100)
      expect(clustersOf(r)).toEqual([{ r: 3, restSec: 20 }, { r: 3, restSec: 20 }, { r: 3, restSec: 20 }])
    }
  })
})
