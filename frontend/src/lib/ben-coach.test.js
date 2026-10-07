// The advisory layer: engine-consistent verdicts, attention signals, alternatives and
// session-length variants — all from the same completed sets, silent when evidence is thin.
import { describe, it, expect } from 'vitest'
import {
  recommendationFor, routineCoaching, exerciseAttention, alternativesFor, sessionVariants,
} from './ben-coach.js'
import { EXDB, isAssisted } from './exercises.js'
import { muscleGroupsOf } from './muscles.js'

const LIFT = EXDB.find(e => e.bp !== 'cardio' && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp) && !['body weight', 'band', 'resistance band'].includes(e.eq) && !isAssisted(e.id)).id
const BWEX = EXDB.find(e => e.eq === 'body weight' && e.bp !== 'cardio').id
const CARDIO = EXDB.find(e => e.bp === 'cardio').id

const R = { id: 'r', name: 'R', ex: [{ id: LIFT, sets: 3, reps: 5, weight: 60 }] }
const T = (sets, reps, weight) => ({ sets, reps, weight })

// Saved sessions as the app writes them: routine stamp, plan stamp, target.
const logged = (id, target, cells, w, d = '2026-03-01') => ({
  d, routineIds: ['r'],
  entries: [{
    id, rid: 'r', planned: { ...target }, target: { ...target },
    sets: cells.map(c => c === null
      ? { w, r: 0, done: false }
      : { w, r: c[0], done: true, ...(c[1] == null ? {} : { rir: c[1] }) }),
  }],
})
const clean = (reps, rir) => [[reps, rir], [reps, rir], [reps, rir]]
const S = (...workouts) => ({ unit: 'kg', routines: [R], week: {}, workouts })

describe('recommendationFor follows the engine', () => {
  it('has no verdict without history', () => {
    expect(recommendationFor(S(), R, LIFT)).toMatchObject({ status: 'baseline', label: 'Build a baseline', next: null })
  })

  it('has no verdict for an exercise outside the routine', () => {
    expect(recommendationFor(S(logged(LIFT, T(3, 5, 60), clean(5, null), 60)), R, 'nope'))
      .toMatchObject({ status: 'baseline' })
  })

  it('recommends a small raise with concrete numbers after a clean session', () => {
    const r = recommendationFor(S(logged(LIFT, T(3, 5, 60), clean(5, null), 60)), R, LIFT)
    expect(r).toMatchObject({ status: 'progress', label: 'Increase slightly', next: { weight: 62.5 } })
  })

  it('repeats after a session with misses', () => {
    const r = recommendationFor(S(logged(LIFT, T(3, 5, 60), [[5, null], [5, null], [3, null]], 60)), R, LIFT)
    expect(r).toMatchObject({ status: 'repeat', label: 'Repeat the target' })
  })

  it('recommends backing off after three stalled sessions', () => {
    const miss = logged(LIFT, T(3, 5, 60), clean(3, null), 60)
    const r = recommendationFor(S(miss, { ...miss, d: '2026-03-02' }, { ...miss, d: '2026-03-03' }), R, LIFT)
    expect(r).toMatchObject({ status: 'regress', label: 'Repeat or reduce' })
    expect(r.next.weight).toBeLessThan(60)
  })

  it('holds rather than raises when the clean session was ground out at failure', () => {
    const r = recommendationFor(S(logged(LIFT, T(3, 5, 60), clean(5, 0), 60)), R, LIFT)
    expect(r).toMatchObject({ status: 'repeat', label: 'Repeat the target' })
  })

  it('raises when the clean session was comfortable', () => {
    const r = recommendationFor(S(logged(LIFT, T(3, 5, 60), clean(5, 2), 60)), R, LIFT)
    expect(r).toMatchObject({ status: 'progress', next: { weight: 62.5 } })
  })

  it('gives bodyweight work a harder variation, not a load', () => {
    const routine = { id: 'r', name: 'R', ex: [{ id: BWEX, sets: 3, reps: 10, weight: 0 }] }
    const st = { unit: 'kg', routines: [routine], week: {}, workouts: [logged(BWEX, T(3, 10, 0), clean(10, null), 0)] }
    const r = recommendationFor(st, routine, BWEX)
    expect(r).toMatchObject({ status: 'progress', label: 'Make it harder', next: { weight: 0, reps: 11 } })
  })

  it('follows the plan when progression is off, and for cardio', () => {
    const off = { id: 'r', name: 'R', ex: [{ id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'off' }] }
    const st = { unit: 'kg', routines: [off], week: {}, workouts: [logged(LIFT, T(3, 5, 60), clean(5, null), 60)] }
    expect(recommendationFor(st, off, LIFT)).toMatchObject({ status: 'repeat', label: 'Repeat the target', next: null })
    const card = { id: 'r', name: 'R', ex: [{ id: CARDIO, sets: 1, min: 20, speed: 8 }] }
    expect(recommendationFor(S(), card, CARDIO).status).toBe('baseline')
  })

  it('routineCoaching keeps its shape: one entry per exercise, capped', () => {
    const routine = { id: 'r', name: 'R', ex: [LIFT, BWEX].map(id => ({ id, sets: 3, reps: 5, weight: id === LIFT ? 60 : 0 })) }
    const st = { unit: 'kg', routines: [routine], week: {}, workouts: [] }
    const rows = routineCoaching(st, routine, 1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: LIFT })
    expect(rows[0].recommendation.status).toBe('baseline')
  })
})

describe('exerciseAttention', () => {
  const miss = (d) => logged(LIFT, T(3, 5, 60), clean(3, null), 60, d)

  it('flags a run of two misses before the engine deloads at three', () => {
    const st = S(miss('2026-03-01'), miss('2026-03-02'))
    expect(exerciseAttention(st, R)).toMatchObject([{ id: LIFT, kind: 'stalling', stalls: 2 }])
  })

  it('stays quiet on a single miss', () => {
    expect(exerciseAttention(S(miss('2026-03-01')), R)).toEqual([])
  })

  it('flags a trained movement with nothing completed in the window', () => {
    const today = new Date()
    const iso = (back) => new Date(today.getTime() - back * 86400000).toISOString().slice(0, 10)
    const old = logged(LIFT, T(3, 5, 60), clean(5, null), 60, '2020-01-01')
    const other = (d) => ({ d, entries: [{ id: BWEX, target: T(3, 10, 0), sets: [{ w: 0, r: 10, done: true }] }] })
    const st = S(old, other(iso(2)), other(iso(1)))
    expect(exerciseAttention(st, R)).toMatchObject([{ id: LIFT, kind: 'skipped' }])
  })

  it('does not call a new exercise skipped', () => {
    const iso = new Date().toISOString().slice(0, 10)
    const other = { d: iso, entries: [{ id: BWEX, target: T(3, 10, 0), sets: [{ w: 0, r: 10, done: true }] }] }
    expect(exerciseAttention(S(other, { ...other, d: iso }), R)).toEqual([])
  })

  it('flags planned equipment outside the active profile, and only then', () => {
    const eq = EXDB.find(e => e.id === LIFT).eq
    const prof = { id: 'home', name: 'Home', equipment: ['body weight'] }
    const on = { unit: 'kg', routines: [R], week: {}, equipFilterOn: true, equipProfiles: [prof], activeEquipId: 'home', workouts: [] }
    expect(exerciseAttention(on, R)).toMatchObject([{ id: LIFT, kind: 'equipment', eq }])
    expect(exerciseAttention(S(), R)).toEqual([])
  })

  it('ignores timed and cardio slots', () => {
    const routine = { id: 'r', name: 'R', ex: [{ id: CARDIO, sets: 1, min: 20, speed: 8 }] }
    expect(exerciseAttention(S(), routine)).toEqual([])
  })
})

describe('alternativesFor', () => {
  it('suggests same-muscle movements, never itself', () => {
    const alts = alternativesFor(S(), LIFT, { count: 5 })
    expect(alts.length).toBeGreaterThan(0)
    expect(alts.length).toBeLessThanOrEqual(5)
    expect(alts.some(a => a.id === LIFT)).toBe(false)
    const primary = muscleGroupsOf(EXDB.find(e => e.id === LIFT))[0]
    for (const a of alts) {
      const g = muscleGroupsOf(EXDB.find(e => e.id === a.id) || { id: a.id })
      expect(g).toContain(primary)
    }
  })

  it('ranks bodyweight and available equipment first', () => {
    const alts = alternativesFor(S(), LIFT, { count: 30 })
    const seenUnavailable = { v: false }
    let bwBlockEnded = false
    for (const a of alts) {
      if (!a.available) seenUnavailable.v = true
      else expect(seenUnavailable.v).toBe(false)
      if (a.bodyweight) expect(bwBlockEnded).toBe(false)
      else if (alts.some(x => x.bodyweight)) bwBlockEnded = true
    }
  })

  it('only suggests what the home profile can actually do, first', () => {
    const prof = { id: 'home', name: 'Home', equipment: ['body weight'] }
    const st = { unit: 'kg', routines: [R], week: {}, equipFilterOn: true, equipProfiles: [prof], activeEquipId: 'home', workouts: [] }
    const alts = alternativesFor(st, LIFT, { count: 10 })
    expect(alts.length).toBeGreaterThan(0)
    expect(alts[0].available).toBe(true)
  })

  it('returns nothing for an unknown exercise', () => {
    expect(alternativesFor(S(), 'nope')).toEqual([])
  })
})

describe('sessionVariants', () => {
  const five = ['0025', '0031', '0047', '0334', '0241'].map(id => ({ id, sets: 3, reps: 10, weight: 20 }))
  const routine5 = { id: 'r', name: 'Five', ex: five }

  it('returns no short version for an already-short routine', () => {
    const v = sessionVariants({ id: 'r', name: 'R', ex: five.slice(0, 3) }, S())
    expect(v.short).toBe(null)
    expect(v.full.exerciseIds).toHaveLength(3)
    expect(v.longer).toBe(null)
  })

  it('picks the short subset by training evidence, in routine order', () => {
    // Five exercises → keep three: the fourth was never trained, the fifth trained most.
    const trained = (id, n, d0) => Array.from({ length: n }, (_, i) => logged(id, T(3, 10, 20), clean(10, null), 20, `2026-02-${String(d0 + i).padStart(2, '0')}`))
    const st = S(
      ...trained('0025', 1, 1), ...trained('0031', 1, 2), ...trained('0047', 1, 3),
      ...trained('0241', 3, 4),
    )
    const v = sessionVariants(routine5, st)
    expect(v.short.exerciseIds).toEqual(['0025', '0031', '0241'])
    expect(v.short.sets).toBe(9)
  })

  it('covers muscle groups before doubling up on the best-trained one', () => {
    // Chest ran most, but the short session still keeps one movement per group rather
    // than three chest exercises and nothing for deltoids.
    const trained = (id, n, d0) => Array.from({ length: n }, (_, i) => logged(id, T(3, 10, 20), clean(10, null), 20, `2026-04-${String(d0 + i).padStart(2, '0')}`))
    const st = S(
      ...trained('0025', 5, 1), ...trained('0047', 4, 6), ...trained('0031', 3, 10),
    )
    const v = sessionVariants(routine5, st)
    expect(v.short.exerciseIds).toEqual(['0025', '0031', '0334'])
  })

  it('estimates minutes only from the routine’s own timed history', () => {
    expect(sessionVariants(routine5, S()).full.minutes).toBe(null)
    const timed = (d, min) => ({ d, routineIds: ['r'], start: 1000, end: 1000 + min * 60000, entries: [] })
    const st = S(timed('2026-03-01', 33), timed('2026-03-03', 37))
    const v = sessionVariants(routine5, st)
    expect(v.full.minutes).toBe(37)
    expect(v.short.minutes).toBe(20)
  })

  it('suggests combining with a scheduled routine for a longer session', () => {
    const other = { id: 'o', name: 'Other', ex: [{ id: '0031', sets: 4, reps: 10, weight: 20 }] }
    const st = { unit: 'kg', routines: [routine5, other], week: { 1: ['r'], 3: ['o'] }, workouts: [] }
    expect(sessionVariants(routine5, st).longer).toMatchObject({ routineIds: ['r', 'o'] })
    expect(sessionVariants(routine5, S()).longer).toBe(null)
  })
})
