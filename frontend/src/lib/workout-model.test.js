import { describe, it, expect } from 'vitest'
import {
  phaseForSet, isWarmupRow, modeForSet, modeForEntry,
  setType, isDropSet, isRestPauseSet, dropsOf, clustersOf, extraVolumeOf,
  addDrop, addCluster, removeDropAt, removeClusterAt, setDropAt, setClusterAt,
  nextDropWeight, nextBurstReps, splitBurstReps,
  isSideSet, makeSideSet, syncSideAggregate, setSideField, toggleSide,
  addSideDrop, removeSideDropAt, setSideDropAt, addSideCluster, removeSideClusterAt, setSideClusterAt,
} from './workout-model.js'

describe('phaseForSet / isWarmupRow', () => {
  it('reads both the explicit phase and the legacy boolean', () => {
    expect(isWarmupRow({ phase: 'warmup' })).toBe(true)
    expect(isWarmupRow({ warmup: true })).toBe(true)
    expect(isWarmupRow({ phase: 'work' })).toBe(false)
    expect(isWarmupRow({})).toBe(false)
  })
})

describe('setType / isDropSet / isRestPauseSet', () => {
  it('defaults to straight for anything without a recognised type', () => {
    expect(setType({})).toBe('straight')
    expect(setType({ type: 'nonsense' })).toBe('straight')
    expect(setType(null)).toBe('straight')
    expect(isDropSet({})).toBe(false)
    expect(isRestPauseSet({})).toBe(false)
  })

  it('recognises drop-set and rest-pause rows', () => {
    expect(setType({ type: 'dropset' })).toBe('dropset')
    expect(isDropSet({ type: 'dropset' })).toBe(true)
    expect(setType({ type: 'restpause' })).toBe('restpause')
    expect(isRestPauseSet({ type: 'restpause' })).toBe(true)
  })

  it('is a separate axis from warm-up — a row is not both at once by construction, but phase never leaks into type', () => {
    expect(setType({ phase: 'warmup', type: 'dropset' })).toBe('dropset')
    expect(isWarmupRow({ phase: 'warmup', type: 'dropset' })).toBe(true)
  })
})

describe('dropsOf / clustersOf', () => {
  it('only return rows for their own type', () => {
    const drop = { type: 'dropset', drops: [{ w: 80, r: 5 }] }
    const burst = { type: 'restpause', clusters: [{ r: 4, restSec: 15 }] }
    expect(dropsOf(drop)).toEqual([{ w: 80, r: 5 }])
    expect(clustersOf(drop)).toEqual([])
    expect(clustersOf(burst)).toEqual([{ r: 4, restSec: 15 }])
    expect(dropsOf(burst)).toEqual([])
  })

  it('is defensive about missing/malformed arrays', () => {
    expect(dropsOf({ type: 'dropset' })).toEqual([])
    expect(dropsOf({ type: 'dropset', drops: 'nope' })).toEqual([])
    expect(clustersOf(null)).toEqual([])
  })
})

describe('extraVolumeOf', () => {
  it('sums weight x reps across a drop-set\'s own drops', () => {
    const set = { type: 'dropset', w: 100, r: 5, drops: [{ w: 80, r: 5 }, { w: 60, r: 6 }] }
    expect(extraVolumeOf(set)).toBe(80 * 5 + 60 * 6)
  })

  it('is zero for rest-pause — its own r is already the total across every burst, so clusters are a breakdown, not extra volume', () => {
    const set = { type: 'restpause', w: 60, r: 20, clusters: [{ r: 10, restSec: 15 }, { r: 5, restSec: 15 }, { r: 3, restSec: 15 }, { r: 1, restSec: 15 }, { r: 1, restSec: 15 } ] }
    expect(extraVolumeOf(set)).toBe(0)
  })

  it('is zero for a straight or warm-up set', () => {
    expect(extraVolumeOf({ w: 100, r: 5 })).toBe(0)
    expect(extraVolumeOf({ phase: 'warmup', w: 20, r: 8 })).toBe(0)
  })

  it('sums both sides drops for a per-side drop-set (issue #60)', () => {
    let s = addSideDrop(makeSideSet({ w: 20, r: 16 }), 20)   // each side: one 16×8 drop
    expect(extraVolumeOf(s)).toBe(16 * 8 * 2)                // L + R
    // an asymmetric edit is reflected
    s = setSideDropAt(s, 'R', 0, { w: 10, r: 6 })
    expect(extraVolumeOf(s)).toBe(16 * 8 + 10 * 6)
  })
})

describe('addDrop / addCluster', () => {
  it('appends a drop and stamps the row as a drop-set', () => {
    const set = { w: 100, r: 5, done: true }
    const next = addDrop(set, { w: 80, r: 5 })
    expect(next.type).toBe('dropset')
    expect(next.drops).toEqual([{ w: 80, r: 5 }])
    expect(set.drops).toBeUndefined() // pure — the original row is untouched
    expect(addDrop(next, { w: 60, r: 4 }).drops).toEqual([{ w: 80, r: 5 }, { w: 60, r: 4 }])
  })

  it('appends a burst and stamps the row as a rest-pause set', () => {
    const set = { w: 60, r: 8, done: true }
    const next = addCluster(set, { r: 4, restSec: 15 })
    expect(next.type).toBe('restpause')
    expect(next.clusters).toEqual([{ r: 4, restSec: 15 }])
  })
})

describe('removeDropAt / removeClusterAt', () => {
  it('removes one entry by index, leaving the rest in place', () => {
    const set = { type: 'dropset', w: 100, r: 5, drops: [{ w: 80, r: 5 }, { w: 60, r: 5 }] }
    expect(removeDropAt(set, 0).drops).toEqual([{ w: 60, r: 5 }])
  })

  it('removes one burst by index', () => {
    const set = { type: 'restpause', w: 60, r: 8, clusters: [{ r: 4, restSec: 15 }, { r: 3, restSec: 15 }] }
    expect(removeClusterAt(set, 1).clusters).toEqual([{ r: 4, restSec: 15 }])
  })

  it('reverts the row to a straight set once its last drop/burst is removed', () => {
    const drop = { type: 'dropset', w: 100, r: 5, drops: [{ w: 80, r: 5 }] }
    expect(removeDropAt(drop, 0)).toEqual({ type: 'straight', w: 100, r: 5, drops: [] })
    expect(isDropSet(removeDropAt(drop, 0))).toBe(false)

    const burst = { type: 'restpause', w: 60, r: 8, clusters: [{ r: 4, restSec: 15 }] }
    expect(removeClusterAt(burst, 0)).toEqual({ type: 'straight', w: 60, r: 8, clusters: [] })
    expect(isRestPauseSet(removeClusterAt(burst, 0))).toBe(false)
  })
})

describe('setDropAt / setClusterAt', () => {
  it('patches one drop\'s fields, leaving the others untouched', () => {
    const set = { type: 'dropset', w: 100, r: 5, drops: [{ w: 80, r: 5 }, { w: 60, r: 5 }] }
    expect(setDropAt(set, 0, { w: 82.5 }).drops).toEqual([{ w: 82.5, r: 5 }, { w: 60, r: 5 }])
    expect(setDropAt(set, 1, { r: 6 }).drops).toEqual([{ w: 80, r: 5 }, { w: 60, r: 6 }])
  })

  it('patches one burst\'s reps', () => {
    const set = { type: 'restpause', w: 60, r: 8, clusters: [{ r: 4, restSec: 15 }] }
    expect(setClusterAt(set, 0, { r: 5 }).clusters).toEqual([{ r: 5, restSec: 15 }])
  })

  it('is a no-op for an index that does not exist', () => {
    const set = { type: 'dropset', w: 100, r: 5, drops: [{ w: 80, r: 5 }] }
    expect(setDropAt(set, 3, { w: 1 })).toBe(set)
  })
})

describe('nextDropWeight / nextBurstReps', () => {
  it('drops by the given percentage, rounded to the nearest .5', () => {
    expect(nextDropWeight(100, 20)).toBe(80)
    expect(nextDropWeight(80, 20)).toBe(64)
    expect(nextDropWeight(61, 10)).toBe(55)
  })

  it('defaults to 20% and never goes negative', () => {
    expect(nextDropWeight(100)).toBe(80)
    expect(nextDropWeight(0, 20)).toBe(0)
  })

  it('roughly halves the previous rep count, floored at 1', () => {
    expect(nextBurstReps(8)).toBe(4)
    expect(nextBurstReps(1)).toBe(1)
    expect(nextBurstReps(0)).toBe(1)
  })
})

describe('splitBurstReps', () => {
  it('splits a total into a descending, roughly-halving sequence that adds back up to it', () => {
    expect(splitBurstReps(12)).toEqual([6, 3, 2, 1])
    expect(splitBurstReps(6)).toEqual([3, 2, 1])
    expect(splitBurstReps(1)).toEqual([1])
  })

  it('every split sums exactly to the requested total', () => {
    for (const total of [1, 2, 3, 5, 7, 10, 15, 20, 33]) {
      expect(splitBurstReps(total).reduce((a, b) => a + b, 0)).toBe(total)
    }
  })

  it('is empty for zero or invalid input', () => {
    expect(splitBurstReps(0)).toEqual([])
    expect(splitBurstReps(-5)).toEqual([])
    expect(splitBurstReps(undefined)).toEqual([])
  })
})

describe('modeForSet / modeForEntry stay reps-mode for drop-sets and rest-pause sets', () => {
  it('infers reps mode from the row\'s own r field regardless of type', () => {
    expect(modeForSet({ type: 'dropset', w: 100, r: 5 })).toBe('reps')
    expect(modeForSet({ type: 'restpause', w: 60, r: 8 })).toBe('reps')
  })

  it('an entry mixing straight and drop-set rows still reads as one reps-mode entry', () => {
    const entry = { sets: [{ w: 100, r: 5 }, { type: 'dropset', w: 100, r: 5, drops: [{ w: 80, r: 5 }] }] }
    expect(modeForEntry(entry)).toBe('reps')
  })
})

// One-sided (unilateral) sets: each side logged on its own, with the row's scalar w/r/done/effort
// kept as a correct aggregate so every other consumer (volume, 1RM, PRs, progression, counters)
// reads a per-side row exactly as it always read a straight one (issue #60).
describe('isSideSet', () => {
  it('is true only for a row carrying both L and R sides', () => {
    expect(isSideSet({ sides: { L: { w: 10, r: 8 }, R: { w: 10, r: 8 } } })).toBe(true)
    expect(isSideSet({ w: 10, r: 8 })).toBe(false)
    expect(isSideSet({ sides: { L: { w: 10, r: 8 } } })).toBe(false)
    expect(isSideSet(null)).toBe(false)
  })
})

describe('makeSideSet', () => {
  it('splits the row total evenly across two sides at the same weight, nothing done', () => {
    const s = makeSideSet({ w: 15, r: 16, done: false })
    expect(isSideSet(s)).toBe(true)
    expect(s.sides.L).toEqual({ w: 15, r: 8, done: false })
    expect(s.sides.R).toEqual({ w: 15, r: 8, done: false })
    // aggregate mirror: r = both sides, w = the (equal) weight, not done yet
    expect(s.r).toBe(16)
    expect(s.w).toBe(15)
    expect(s.done).toBe(false)
  })

  it('drops any straight-set effort so the row carries a single source of truth', () => {
    const s = makeSideSet({ w: 20, r: 10, rir: 2 })
    expect(s.rir).toBeUndefined()
    expect(s.rpe).toBeUndefined()
  })
})

describe('syncSideAggregate', () => {
  it('recomputes r as the sum, w as the heavier side, done only when both sides are', () => {
    const row = { sides: { L: { w: 15, r: 8, done: true }, R: { w: 17.5, r: 6, done: false } } }
    const s = syncSideAggregate(row)
    expect(s.r).toBe(14)
    expect(s.w).toBe(17.5)
    expect(s.done).toBe(false)
    const bothDone = syncSideAggregate({ sides: { L: { w: 15, r: 8, done: true }, R: { w: 15, r: 8, done: true } } })
    expect(bothDone.done).toBe(true)
  })

  it('takes the harder side for the row effort — lower RIR, higher RPE', () => {
    const rir = syncSideAggregate({ sides: { L: { w: 15, r: 8, rir: 3 }, R: { w: 15, r: 8, rir: 1 } } })
    expect(rir.rir).toBe(1)
    expect(rir.rpe).toBeUndefined()
    const rpe = syncSideAggregate({ sides: { L: { w: 15, r: 8, rpe: 7 }, R: { w: 15, r: 8, rpe: 9 } } })
    expect(rpe.rpe).toBe(9)
    expect(rpe.rir).toBeUndefined()
  })

  it('leaves a non-per-side row alone (returns a copy)', () => {
    const s = syncSideAggregate({ w: 20, r: 10, done: true })
    expect(s).toEqual({ w: 20, r: 10, done: true })
    expect(isSideSet(s)).toBe(false)
  })
})

describe('setSideField', () => {
  it('patches one side and resyncs the aggregate', () => {
    const base = makeSideSet({ w: 15, r: 16 })
    const s = setSideField(base, 'R', 'w', 17.5)
    expect(s.sides.R.w).toBe(17.5)
    expect(s.sides.L.w).toBe(15)
    expect(s.w).toBe(17.5)       // aggregate = heavier side
  })

  it('clears an effort field on null, mirroring how a straight row drops the key', () => {
    let s = setSideField(makeSideSet({ w: 15, r: 16 }), 'L', 'rir', 2)
    expect(s.sides.L.rir).toBe(2)
    expect(s.rir).toBe(2)
    s = setSideField(s, 'L', 'rir', null)
    expect(s.sides.L.rir).toBeUndefined()
    expect(s.rir).toBeUndefined()
  })

  it('ignores an unknown side without throwing', () => {
    const base = makeSideSet({ w: 15, r: 16 })
    expect(isSideSet(setSideField(base, 'X', 'w', 20))).toBe(true)
  })
})

describe('toggleSide', () => {
  it('flips one side and marks the row done only once both sides are', () => {
    let s = makeSideSet({ w: 15, r: 16 })
    expect(s.done).toBe(false)
    s = toggleSide(s, 'L')
    expect(s.sides.L.done).toBe(true)
    expect(s.done).toBe(false)   // R still open
    s = toggleSide(s, 'R')
    expect(s.sides.R.done).toBe(true)
    expect(s.done).toBe(true)    // both sides done → row done
    s = toggleSide(s, 'L')
    expect(s.done).toBe(false)   // un-tick one side → row no longer done
  })
})

// Per-side intensifiers: a unilateral set's drop-sets and rest-pause bursts are logged per limb
// too (issue #60). The structure stays symmetric (both sides carry the same count) while each
// side's numbers are edited independently; drops/clusters live on the sides, and the aggregate's
// extra volume sums both.
describe('addSideDrop / removeSideDropAt / setSideDropAt', () => {
  it('adds a drop to both sides, each seeded from its own side weight and reps', () => {
    let s = makeSideSet({ w: 20, r: 16 })              // sides: 20×8 each
    s = setSideField(s, 'R', 'w', 18)                  // make the sides asymmetric first
    s = addSideDrop(s, 20)                             // 20% lighter
    expect(s.sides.L.drops).toEqual([{ w: 16, r: 8 }]) // 20 → 16
    expect(s.sides.R.drops).toEqual([{ w: 14.5, r: 8 }]) // 18 → 14.4 → rounds to 14.5
    expect(s.type).toBe('dropset')                     // aggregate mirrors the intensifier type
    expect(s.drops).toBeUndefined()                    // drops live on the sides, not the row
  })

  it('edits one side drop independently, leaving the other side untouched', () => {
    let s = addSideDrop(makeSideSet({ w: 20, r: 16 }), 20)
    s = setSideDropAt(s, 'L', 0, { w: 12 })
    expect(s.sides.L.drops[0].w).toBe(12)
    expect(s.sides.R.drops[0].w).toBe(16)
  })

  it('removes a drop from both sides, reverting to straight when the last goes', () => {
    let s = addSideDrop(makeSideSet({ w: 20, r: 16 }), 20)
    s = removeSideDropAt(s, 0)
    expect(s.sides.L.drops).toEqual([])
    expect(s.sides.R.drops).toEqual([])
    expect(s.type).toBeUndefined()                     // no side is a drop-set anymore
  })
})

describe('addSideCluster / removeSideClusterAt / setSideClusterAt', () => {
  it('adds a burst to both sides and grows each side reps by its own added burst', () => {
    let s = makeSideSet({ w: 20, r: 16 })              // 8 per side
    s = addSideCluster(s, 15)                          // nextBurstReps(8) = 4
    expect(s.sides.L.clusters).toEqual([{ r: 4, restSec: 15 }])
    expect(s.sides.L.r).toBe(12)                       // 8 + 4
    expect(s.sides.R.r).toBe(12)
    expect(s.r).toBe(24)                               // aggregate total across both sides
    expect(s.type).toBe('restpause')
  })

  it('editing one side burst keeps that side reps in step and leaves the other alone', () => {
    let s = addSideCluster(makeSideSet({ w: 20, r: 16 }), 15) // L/R: r 12, burst 4
    s = setSideClusterAt(s, 'L', 0, 6)                 // +2 on L
    expect(s.sides.L.clusters[0].r).toBe(6)
    expect(s.sides.L.r).toBe(14)                       // 12 + 2
    expect(s.sides.R.r).toBe(12)                       // untouched
  })

  it('removing a burst subtracts its reps from that side', () => {
    let s = addSideCluster(makeSideSet({ w: 20, r: 16 }), 15) // r 12 each
    s = removeSideClusterAt(s, 0)
    expect(s.sides.L.clusters).toEqual([])
    expect(s.sides.L.r).toBe(8)                        // back to the base
    expect(s.type).toBeUndefined()
  })
})
