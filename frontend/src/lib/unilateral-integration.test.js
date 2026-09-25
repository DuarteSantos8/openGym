import { describe, it, expect } from 'vitest'
import { makeSideSet, setSideField, toggleSide, addSideDrop, setSideDropAt, isSideSet } from './workout-model.js'
import { workoutVolume, applyIntensifierPlan, setLabel, setsDone } from './history.js'
import { convertStateUnit, convertActiveUnit } from './units.js'
import { exerciseHistory } from './exercise-history.js'

const row = () => makeSideSet({ w: 20, r: 16 })
const done = s => toggleSide(toggleSide(s, 'L'), 'R')
const entry = s => ({ id: '0025', target: { mode: 'reps', side: true, bodyweight: false }, sets: [s] })
const perfRow = (status, metric, value, resistance, segments = []) =>
  ({ status, observations: [{ metric, value }], resistance, segments })

describe('unilateral sets across session boundaries', () => {
  it('converts both limbs and their drops in history and the active session', () => {
    const s = setSideDropAt(addSideDrop(setSideField(row(), 'R', 'w', 30)), 'R', 0, { w: 10 })
    // The active session is its own store field since the storage split (Task 20/21) — it is no
    // longer part of the profile object convertStateUnit walks, so it goes through the sibling
    // convertActiveUnit instead, converted the same way alongside it.
    const state = { unit: 'kg', workouts: [{ entries: [entry(done(s))] }] }
    const active = { entries: [entry(s)] }
    const result = convertStateUnit(state, 'lb')
    const resultActive = convertActiveUnit(active, 'kg', 'lb')
    for (const e of [resultActive.entries[0], result.workouts[0].entries[0]]) {
      expect(e.sets[0].sides.L.w).toBe(44)
      expect(e.sets[0].sides.R.w).toBe(66)
      expect(e.sets[0].sides.L.drops[0].w).toBe(35.5)
      expect(e.sets[0].sides.R.drops[0].w).toBe(22)
      expect(toggleSide(e.sets[0], 'L').w).toBe(66)
    }
    expect(active.entries[0].sets[0].sides.L.w).toBe(20)
    expect(convertActiveUnit(resultActive, 'lb', 'kg').entries[0].sets[0].sides.R.w).toBe(30)
  })

  it('counts asymmetric loads correctly in workout and exercise-history volume', () => {
    const profile = { workouts: [{ id: 'w', d: '2026-09-01', exposures: [{ kind: 'legacy', exerciseId: '0025', performance: { sets: [{ status: 'completed', observations: [{ metric: 'repetitions', value: 8 }], resistance: { kind: 'external-load', value: 20 }, segments: [{ status: 'completed', observations: [{ metric: 'repetitions', value: 8 }], resistance: { kind: 'external-load', value: 30 }, segments: [] }] }] } }] }] }
    expect(workoutVolume(profile, profile.workouts[0])).toBe(400)
    expect(exerciseHistory(profile, '0025').sessions[0].volume).toBe(400)
  })

  it.each([12, 13])('preserves L/R rows and total reps for a planned rest-pause of %i', totalReps => {
    const [warmup, work] = applyIntensifierPlan([setSideField(row(), 'R', 'w', 30)], {
      side: true, reps: 16, intensifier: { type: 'restpause', totalReps, restSec: 15 },
    })
    expect(warmup.phase).toBe('warmup')
    expect(isSideSet(work)).toBe(true)
    expect(work.r).toBe(totalReps)
    for (const side of [work.sides.L, work.sides.R]) {
      expect(side.clusters.reduce((n, c) => n + c.r, 0)).toBe(side.r)
      expect(side.clusters.every(c => c.restSec === 15)).toBe(true)
    }
    expect(work.sides.L.w).toBe(20)
    expect(work.sides.R.w).toBe(30)
    // Canonical per-side aggregate: main row is one side, the other side is a segment (see
    // history.test.js's "per-side aggregate stays readable by existing consumers").
    const w = { exposures: [{ exerciseId: '0025', performance: { sets: [
      perfRow('completed', 'repetitions', work.sides.L.r, { kind: 'external-load', value: work.sides.L.w }, [
        perfRow('completed', 'repetitions', work.sides.R.r, { kind: 'external-load', value: work.sides.R.w }),
      ]),
    ] } }] }
    expect(workoutVolume({}, w)).toBe(20 * Math.ceil(totalReps / 2) + 30 * Math.floor(totalReps / 2))
  })
})
