// The effort gate: a clean session ground out at failure holds the weight instead of
// loading the grind. Sparse or missing ratings never block progression.
import { describe, it, expect } from 'vitest'
import { readSession, nextPrescription } from './progression.js'
import { EXDB, isAssisted } from './exercises.js'

// A plainly loaded lift: more weight is harder (same filter as progression.test.js).
const LIFT = EXDB.find(e => e.bp !== 'cardio' && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp) && !['body weight', 'band', 'resistance band'].includes(e.eq) && !isAssisted(e.id)).id
const BW = EXDB.find(e => e.eq === 'body weight' && e.bp !== 'cardio').id

const R = { id: 'r', name: 'R', ex: [] }

// One session. Each cell is [reps, rir] (rir null = unrated) or null (never checked off).
const sess = (id, target, cells, w) => ({
  d: '2026-03-01', routineIds: ['r'],
  entries: [{
    id, rid: 'r', planned: { ...target }, target: { ...target },
    sets: cells.map(c => c === null
      ? { w, r: 0, done: false }
      : { w, r: c[0], done: true, ...(c[1] == null ? {} : { rir: c[1] }) }),
  }],
})
const S = (...workouts) => ({ unit: 'kg', workouts })
const T = (sets, reps, weight) => ({ sets, reps, weight })
const clean = (reps, rir) => Array.from({ length: 3 }, () => [reps, rir])

describe('readSession effort', () => {
  it('reads no effort off unrated sets', () => {
    const s = readSession({ id: LIFT, target: T(3, 5, 60), sets: clean(5, null).map(([r]) => ({ w: 60, r, done: true })) })
    expect(s.effort).toMatchObject({ avg: null, rated: 0, done: 3 })
  })

  it('averages the rated work sets', () => {
    const s = readSession({ id: LIFT, target: T(3, 5, 60), sets: [{ w: 60, r: 5, done: true, rir: 1 }, { w: 60, r: 5, done: true, rir: 3 }, { w: 60, r: 5, done: false }] })
    expect(s.effort).toMatchObject({ avg: 2, rated: 2, done: 2 })
  })
})

describe('linear progression with recorded effort', () => {
  const cfg = { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'linear' }

  it('still raises the load when nothing was rated', () => {
    expect(nextPrescription(S(sess(LIFT, T(3, 5, 60), clean(5, null), 60)), cfg, R))
      .toMatchObject({ kind: 'up', weight: 62.5 })
  })

  it('holds the weight when every rated set went to failure', () => {
    const p = nextPrescription(S(sess(LIFT, T(3, 5, 60), clean(5, 0), 60)), cfg, R)
    expect(p).toMatchObject({ kind: 'hold', weight: 60 })
    expect(p.why[0]).toMatch(/failure/)
  })

  it('reads RPE through the same gate', () => {
    const entry = {
      id: LIFT, rid: 'r', planned: T(3, 5, 60), target: T(3, 5, 60),
      sets: [0, 1, 2].map(() => ({ w: 60, r: 5, done: true, rpe: 10 })),
    }
    const st = { unit: 'kg', workouts: [{ d: '2026-03-01', routineIds: ['r'], entries: [entry] }] }
    expect(nextPrescription(st, cfg, R).kind).toBe('hold')
  })

  it('raises the load when the clean session was comfortable', () => {
    expect(nextPrescription(S(sess(LIFT, T(3, 5, 60), clean(5, 2), 60)), cfg, R))
      .toMatchObject({ kind: 'up', weight: 62.5 })
  })

  it('ignores a lone rating — one tap is not a finding', () => {
    const cells = [[5, 0], [5, null], [5, null]]
    expect(nextPrescription(S(sess(LIFT, T(3, 5, 60), cells, 60)), cfg, R))
      .toMatchObject({ kind: 'up', weight: 62.5 })
  })

  it('holds on a rated majority averaging under 1 RIR', () => {
    const cells = [[5, 0], [5, 0.5], [5, null]]
    expect(nextPrescription(S(sess(LIFT, T(3, 5, 60), cells, 60)), cfg, R))
      .toMatchObject({ kind: 'hold', weight: 60 })
  })

  it('treats an average of exactly 1 RIR as earned, not ground out', () => {
    expect(nextPrescription(S(sess(LIFT, T(3, 5, 60), clean(5, 1), 60)), cfg, R))
      .toMatchObject({ kind: 'up', weight: 62.5 })
  })

  it('still deloads after repeated misses, whatever the ratings say', () => {
    const miss = sess(LIFT, T(3, 5, 60), clean(3, 0), 60)
    expect(nextPrescription(S(miss, miss, miss), cfg, R).kind).toBe('deload')
  })
})

describe('policies the gate leaves alone', () => {
  it('greyskull still jumps — its last set goes to failure by design', () => {
    const cfg = { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'greyskull' }
    expect(nextPrescription(S(sess(LIFT, T(3, 5, 60), clean(5, 0), 60)), cfg, R).kind).toBe('up')
  })

  it('double progression holds at the top when it was a grind, climbs when comfortable', () => {
    const cfg = { id: LIFT, sets: 3, reps: 12, repsMin: 8, weight: 60, prog: 'double' }
    const target = { sets: 3, reps: 12, repsMin: 8, weight: 60 }
    expect(nextPrescription(S(sess(LIFT, target, clean(12, 0), 60)), cfg, R))
      .toMatchObject({ kind: 'hold', weight: 60, reps: 12 })
    expect(nextPrescription(S(sess(LIFT, target, clean(12, 3), 60)), cfg, R))
      .toMatchObject({ kind: 'up', weight: 62.5, reps: 8 })
  })

  it('bodyweight still climbs a rep — a rep costs no load', () => {
    const cfg = { id: BW, sets: 3, reps: 10, weight: 0, bodyweight: true }
    expect(nextPrescription(S(sess(BW, T(3, 10, 0), clean(10, 0), 0)), cfg, R))
      .toMatchObject({ kind: 'up', reps: 11 })
  })
})
