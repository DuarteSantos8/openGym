import { describe, it, expect } from 'vitest'
import { makeSideSet, setSideField, toggleSide, addSideDrop, setSideDropAt, isSideSet } from './workout-model.js'
import { applyPrescription } from './progression.js'
import { buildSessionEntries } from './session-start.js'
import { workoutVolume, applyIntensifierPlan, setLabel, setsDone } from './history.js'
import { convertStateUnit } from './units.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { exerciseHistory } from './exercise-history.js'

const row = () => makeSideSet({ w: 20, r: 16 })
const done = s => toggleSide(toggleSide(s, 'L'), 'R')
const entry = s => ({ id: '0025', target: { mode: 'reps', side: true, bodyweight: false }, sets: [s] })

describe('unilateral sets across session boundaries', () => {
  it('applies weight and rep targets to the displayed sides and survives completion', () => {
    const source = row()
    const [next] = applyPrescription([source], { kind: 'up', weight: 22.5, reps: 20 })
    expect(next.sides.L).toMatchObject({ w: 22.5, r: 10, done: false })
    expect(next.sides.R).toMatchObject({ w: 22.5, r: 10, done: false })
    expect(done(next)).toMatchObject({ w: 22.5, r: 20, done: true })
    expect(source.sides.L.w).toBe(20)
  })

  it('preserves a logged side when applying a prescription mid-session', () => {
    const source = toggleSide(setSideField(row(), 'L', 'rir', 2), 'L')
    const [next] = applyPrescription([source], { kind: 'up', weight: 25, reps: 20 })
    expect(next.sides.L).toEqual(source.sides.L)
    expect(next.sides.R).toMatchObject({ w: 25, r: 10, done: false })
  })

  it('grows fresh independent side rows without copying completed work or drops', () => {
    const source = done(addSideDrop(row()))
    const next = applyPrescription([source], { kind: 'up', weight: 25, reps: 20, sets: 3 })
    expect(next).toHaveLength(3)
    expect(next[0]).toBe(source)
    for (const s of next.slice(1)) {
      expect(s.sides.L).toEqual({ w: 25, r: 10, done: false })
      expect(s.sides.R).toEqual({ w: 25, r: 10, done: false })
    }
    expect(next[1].sides.L).not.toBe(next[2].sides.L)
  })

  it('uses progressed side weights when building a routine session and its planned drops', () => {
    const cfg = { id: '0025', mode: 'reps', side: true, bodyweight: false, sets: 1, reps: 16, weight: 20, policy: 'linear', inc: 2.5, intensifier: { type: 'dropset', count: 1, pct: 20 } }
    const S = { unit: 'kg', exWeights: {}, workouts: [{ id: 'w', d: '2026-09-01', entries: [{ ...entry(done(row())), target: cfg }] }] }
    const [built] = buildSessionEntries(S, { id: 'r', policy: 'linear', ex: [cfg] })
    expect(built.plan.kind).toBe('up')
    expect(built.sets[0].sides.L.w).toBe(built.plan.weight)
    expect(built.sets[0].sides.L.drops[0].w).toBe(18)
  })

  it('converts both limbs and their drops in history and the active session', () => {
    const s = setSideDropAt(addSideDrop(setSideField(row(), 'R', 'w', 30)), 'R', 0, { w: 10 })
    const state = { unit: 'kg', active: { entries: [entry(s)] }, workouts: [{ entries: [entry(done(s))] }] }
    const result = convertStateUnit(state, 'lb')
    for (const e of [result.active.entries[0], result.workouts[0].entries[0]]) {
      expect(e.sets[0].sides.L.w).toBe(44)
      expect(e.sets[0].sides.R.w).toBe(66)
      expect(e.sets[0].sides.L.drops[0].w).toBe(35.5)
      expect(e.sets[0].sides.R.drops[0].w).toBe(22)
      expect(toggleSide(e.sets[0], 'L').w).toBe(66)
    }
    expect(state.active.entries[0].sets[0].sides.L.w).toBe(20)
    expect(convertStateUnit(result, 'kg').active.entries[0].sets[0].sides.R.w).toBe(30)
  })

  it('counts asymmetric loads correctly in workout and exercise-history volume', () => {
    const s = done(setSideField(row(), 'R', 'w', 30))
    const w = { id: 'w', d: '2026-09-01', entries: [entry(s)] }
    expect(workoutVolume(w)).toBe(400)
    expect(exerciseHistory({ workouts: [w] }, '0025').sessions[0].volume).toBe(400)
  })

  it('retains a single completed limb, counts only its volume and labels its partner as unlogged', () => {
    const s = toggleSide(addSideDrop(row()), 'L')
    const completed = buildCompletedWorkout({ id: 'a', entries: [entry(s), entry(row())] })
    expect(completed.entries).toHaveLength(1)
    expect(completed.entries[0].sets[0]).toEqual(s)
    expect(setsDone(completed)).toBe(1)
    expect(workoutVolume(completed)).toBe(20 * 8 + 16 * 8)
    expect(setLabel('0025', s, entry(s).target)).toBe('L 20×8 · R —')
    expect(workoutVolume({ entries: [entry({ ...s, phase: 'warmup' })] })).toBe(0)
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
    expect(workoutVolume({ entries: [entry(done(work))] })).toBe(20 * Math.ceil(totalReps / 2) + 30 * Math.floor(totalReps / 2))
  })
})
