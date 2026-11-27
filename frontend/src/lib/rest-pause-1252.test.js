// #1252: rest-pause's activation set is the start of the work set, not a warm-up, and a planned
// rest-pause progresses like any lift. Rebuilt from @jclainezr's #1253.
import { describe, expect, it } from 'vitest'
import { applyIntensifierPlan, setLabel, workoutVolume, restPauseGoal } from './history.js'
import { readSession, nextPrescription } from './progression.js'
import { isWarmupRow, makeSideSet } from './workout-model.js'
import { EXDB, isAssisted } from './exercises.js'

const LIFT = EXDB.find(e => e.bp !== 'cardio' && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp) && !['body weight', 'band', 'resistance band'].includes(e.eq) && !isAssisted(e.id)).id
const cfg = (extra = {}) => ({ id: LIFT, mode: 'reps', sets: 3, reps: 8, weight: 60, inc: 2.5, intensifier: { type: 'restpause', totalReps: 8, restSec: 15 }, ...extra })
const built = c => applyIntensifierPlan([0, 1, 2].map(() => ({ w: 60, r: 8, done: false })), c)

describe('rest-pause plan', () => {
  it('is one work row: the activation set and its bursts, nothing marked warm-up', () => {
    const rows = built(cfg())
    expect(rows).toHaveLength(1)
    expect(rows.some(isWarmupRow)).toBe(false)
    expect(rows[0]).toMatchObject({ w: 60, r: 16, type: 'restpause', act: true })
    expect(rows[0].clusters.map(c => c.r).reduce((a, b) => a + b, 0)).toBe(8)
    expect(setLabel(LIFT, rows[0], cfg())).toContain('60×8+')
  })
  it('keeps the warm-ups the plan asks for in front of it', () => {
    const rows = applyIntensifierPlan([{ w: 30, r: 5, done: false, phase: 'warmup' }, { w: 60, r: 8, done: false }], cfg())
    expect(rows.map(r => (isWarmupRow(r) ? 'warm' : r.type))).toEqual(['warm', 'restpause'])
  })
  it('per side: each limb gets its share of both', () => {
    const rows = applyIntensifierPlan([makeSideSet({ w: 20, r: 8 })], cfg({ side: true }))
    expect(rows).toHaveLength(1)
    expect(rows[0].sides.L).toMatchObject({ r: 8, act: true })
    expect(rows[0].sides.R).toMatchObject({ r: 8, act: true })
  })
  it('the activation set counts in the volume', () => {
    const row = { ...built(cfg())[0], done: true }
    expect(workoutVolume({ entries: [{ id: LIFT, sets: [row] }] })).toBe(60 * 16)
  })
})

describe('rest-pause read back', () => {
  it('a ticked row at its reps is a done session, and linear progression adds weight', () => {
    const row = { ...built(cfg())[0], done: true }
    const entry = { id: LIFT, target: cfg(), sets: [row] }
    expect(readSession(entry).ok).toBe(true)
    const S = { unit: 'kg', workouts: [{ d: '2026-11-01', entries: [entry] }] }
    const p = nextPrescription(S, { ...cfg(), prog: 'linear' })
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(62.5)
  })
  it('bursts short of the plan is not done', () => {
    const row = { ...built(cfg())[0], r: 13, done: true }
    expect(readSession({ id: LIFT, target: cfg(), sets: [row] }).ok).toBe(false)
  })
  it('an older session (a warm-up, then the bursts alone) is read against the bursts', () => {
    expect(restPauseGoal(cfg(), { type: 'restpause', r: 8 })).toBe(8)
    const old = [{ w: 60, r: 8, done: true, phase: 'warmup' }, { w: 60, r: 8, done: true, type: 'restpause', clusters: [{ r: 4 }, { r: 2 }, { r: 1 }, { r: 1 }] }]
    expect(readSession({ id: LIFT, target: cfg(), sets: old }).ok).toBe(true)
  })
})
