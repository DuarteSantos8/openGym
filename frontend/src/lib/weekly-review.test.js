// Weekly review, trend-vs-noise bodyweight tracking, consistency and strength direction —
// all from the existing history/state systems, silent on thin evidence.
import { describe, it, expect } from 'vitest'
import {
  bodyweightTrend, weightDirection, strengthRetention, consistency, weeklyReview,
} from './ben-coach.js'
import { EXDB, isAssisted } from './exercises.js'

const LIFT = EXDB.find(e => e.bp !== 'cardio' && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp) && !['body weight', 'band', 'resistance band'].includes(e.eq) && !isAssisted(e.id)).id
const LIFT2 = EXDB.find(e => e.id !== LIFT && e.bp !== 'cardio' && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp) && !['body weight', 'band', 'resistance band'].includes(e.eq) && !isAssisted(e.id)).id
const BWEX = EXDB.find(e => e.eq === 'body weight' && e.bp !== 'cardio').id

const isoDaysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
const bw = pairs => pairs.map(([d, w]) => ({ d, w }))
const liftSets = (w, r = 5) => [{ w, r, done: true }, { w, r, done: true }, { w, r, done: true }]
const liftEntry = (id, w, target) => ({ id, target: target || { sets: 3, reps: 5, weight: w }, sets: liftSets(w) })

describe('bodyweightTrend separates signal from fluctuation', () => {
  const S = bodyweight => ({ unit: 'kg', bodyweight })

  it('stays baseline under two logged weeks', () => {
    expect(bodyweightTrend(S([]))).toMatchObject({ status: 'baseline', delta: null, meaningful: false })
    expect(bodyweightTrend(S(bw([['2026-02-02', 80]])))).toMatchObject({ status: 'baseline', meaningful: false })
  })

  it('keeps the two-week rule: ±0.15 decides, with no noise estimate', () => {
    const down = bodyweightTrend(S(bw([['2026-02-02', 80], ['2026-02-09', 79.4]])))
    expect(down).toMatchObject({ status: 'down', weeksUsed: 2, noise: null, meaningful: true })
    expect(down.delta).toBeCloseTo(-0.6, 5)
    expect(bodyweightTrend(S(bw([['2026-02-02', 80], ['2026-02-09', 80.1]])))).toMatchObject({ status: 'steady', meaningful: false })
  })

  it('fits the slope over four weeks and calls a steady drop meaningful', () => {
    const t = bodyweightTrend(S(bw([['2026-02-02', 80], ['2026-02-09', 79.5], ['2026-02-16', 79], ['2026-02-23', 78.5]])))
    expect(t.status).toBe('down')
    expect(t.rate).toBeCloseTo(-0.5, 5)
    expect(t.weeksUsed).toBe(4)
    expect(t.meaningful).toBe(true)
  })

  it('does not react to an alternating sawtooth', () => {
    const t = bodyweightTrend(S(bw([['2026-02-02', 80], ['2026-02-09', 81], ['2026-02-16', 80], ['2026-02-23', 81]])))
    expect(t.meaningful).toBe(false)
    expect(t.noise).toBeGreaterThan(0.2)
  })

  it('reads a flat line as steady, not progress', () => {
    const t = bodyweightTrend(S(bw([['2026-02-02', 80], ['2026-02-09', 80], ['2026-02-16', 80], ['2026-02-23', 80]])))
    expect(t).toMatchObject({ status: 'steady', meaningful: false })
  })
})

describe('weightDirection', () => {
  const downAbove = { status: 'down', delta: -1, weeks: [{ avg: 81 }] }
  const upAbove = { status: 'up', delta: 1, weeks: [{ avg: 81 }] }
  const upBelow = { status: 'up', delta: 1, weeks: [{ avg: 74 }] }

  it('reads toward/away against a set goal, and at-goal at the goal', () => {
    expect(weightDirection({ targetW: 80 }, downAbove)).toBe('toward')
    expect(weightDirection({ targetW: 80 }, upAbove)).toBe('away')
    expect(weightDirection({ targetW: 75 }, upBelow)).toBe('toward')
    expect(weightDirection({ targetW: 80 }, { status: 'down', delta: -0.01, weeks: [{ avg: 80.02 }] })).toBe('at-goal')
  })

  it('falls back to the fat-loss intent with no goal, and unknown on thin data', () => {
    expect(weightDirection({}, downAbove)).toBe('toward')
    expect(weightDirection({}, upAbove)).toBe('away')
    expect(weightDirection({}, { status: 'steady', delta: 0, weeks: [{ avg: 80 }] })).toBe('flat')
    expect(weightDirection({}, { status: 'baseline', delta: null, weeks: [] })).toBe('unknown')
  })
})

describe('strengthRetention direction counts', () => {
  const aged = (daysAgo, id, w) => ({
    d: isoDaysAgo(daysAgo), start: Date.now() - daysAgo * 86400000,
    entries: [{ id, sets: liftSets(w) }],
  })

  it('counts clearly up and clearly down lifts', () => {
    const S = {
      unit: 'kg',
      workouts: [aged(40, LIFT, 100), aged(40, LIFT2, 50), aged(10, LIFT, 105), aged(10, LIFT2, 45)],
    }
    const st = strengthRetention(S)
    expect(st.compared).toBe(2)
    expect(st.improved).toBe(1)
    expect(st.declined).toBe(1)
    expect(st.status).toBe('mixed')
  })

  it('stays baseline-shaped with too little to compare', () => {
    expect(strengthRetention({ unit: 'kg', workouts: [] })).toMatchObject({ status: 'baseline', compared: 0 })
  })
})

describe('consistency', () => {
  const week = { 1: ['r'], 3: ['r'], 5: ['r'] }
  const done = n => Array.from({ length: n }, (_, i) => ({ d: isoDaysAgo(i + 1), entries: [] }))

  it('measures four weeks against the scheduled days', () => {
    const st = { unit: 'kg', week, workouts: done(6) }
    expect(consistency(st)).toMatchObject({ done: 6, expected: 12, rate: 0.5, status: 'close' })
    expect(consistency({ unit: 'kg', week, workouts: done(12) }).status).toBe('on-track')
    expect(consistency({ unit: 'kg', week, workouts: done(2) }).status).toBe('behind')
  })

  it('is baseline with no scheduled days, not a failure', () => {
    expect(consistency({ unit: 'kg', week: {}, workouts: done(3) }).status).toBe('baseline')
  })
})

describe('weeklyReview', () => {
  const R = { id: 'r', name: 'R', ex: [{ id: BWEX, sets: 3, reps: 10, weight: 0 }] }
  const week = { 1: ['r'], 3: ['r'], 5: ['r'] }
  const bwDown = bw([['2026-02-02', 80], ['2026-02-09', 79.5], ['2026-02-16', 79], ['2026-02-23', 78.5]])
  const bwUp = bw([['2026-02-02', 78.5], ['2026-02-09', 79], ['2026-02-16', 79.5], ['2026-02-23', 80]])
  const bwSession = (back, reps = 10) => ({
    d: isoDaysAgo(back),
    entries: [{ id: BWEX, target: { sets: 3, reps: 10, weight: 0 }, sets: [{ w: 0, r: reps, done: true }, { w: 0, r: reps, done: true }, { w: 0, r: reps, done: true }] }],
  })

  it('asks for a plan, a schedule, then a first session — in that order', () => {
    expect(weeklyReview({ unit: 'kg', routines: [], week: {}, workouts: [], bodyweight: [] }).recommendation.kind).toBe('setup')
    const unscheduled = { unit: 'kg', routines: [R], week: {}, workouts: [], bodyweight: [] }
    expect(weeklyReview(unscheduled).recommendation.kind).toBe('setup')
    const fresh = { unit: 'kg', routines: [R], week, workouts: [], bodyweight: [] }
    expect(weeklyReview(fresh).recommendation).toMatchObject({ kind: 'start' })
    expect(weeklyReview(fresh).training).toMatchObject({ done: 0, planned: 3, status: 'open' })
  })

  it('puts consistency first when training fell behind', () => {
    const st = { unit: 'kg', routines: [R], week, bodyweight: bwDown, workouts: [bwSession(3), bwSession(2)] }
    const review = weeklyReview(st)
    expect(review.consistency.status).toBe('behind')
    expect(review.recommendation.kind).toBe('consistency')
  })

  it('names a stalling exercise with its evidence', () => {
    const RL = { id: 'r', name: 'R', ex: [{ id: LIFT, sets: 3, reps: 5, weight: 60 }] }
    const target = { sets: 3, reps: 5, weight: 60 }
    const miss = back => ({
      d: isoDaysAgo(back), routineIds: ['r'],
      entries: [{ id: LIFT, rid: 'r', planned: { ...target }, target: { ...target }, sets: [{ w: 60, r: 3, done: true }, { w: 60, r: 3, done: true }] }],
    })
    const st = {
      unit: 'kg', routines: [RL], week,
      bodyweight: bwDown,
      workouts: [miss(9), miss(7), bwSession(5), bwSession(4), bwSession(3), bwSession(2)],
    }
    const review = weeklyReview(st)
    expect(review.attention).toMatchObject([{ id: LIFT, kind: 'stalling', stalls: 2 }])
    expect(review.recommendation.kind).toBe('attention')
    expect(review.recommendation.why.join(' ')).toContain('2')
  })

  it('flags weight working against the goal only when the trend is meaningful', () => {
    const mk = bodyweight => ({ unit: 'kg', routines: [R], week, bodyweight, workouts: [bwSession(6), bwSession(5), bwSession(4), bwSession(3), bwSession(2), bwSession(1)] })
    expect(weeklyReview(mk(bwUp)).recommendation.kind).toBe('weight')
    expect(weeklyReview(mk(bwDown)).recommendation.kind).toBe('progress')
  })

  it('lists engine-awarded records from the last 14 days', () => {
    const st = {
      unit: 'kg', routines: [R], week, bodyweight: bwDown,
      workouts: [{ ...bwSession(2), prs: [BWEX] }, bwSession(5), bwSession(4), bwSession(3), bwSession(9), bwSession(8)],
    }
    const review = weeklyReview(st)
    expect(review.improvements).toMatchObject([{ id: BWEX }])
    expect(review.improvements[0].name).toEqual(expect.any(String))
  })

  it('reports this week’s training count against the plan', () => {
    const today = isoDaysAgo(0)
    const st = {
      unit: 'kg', routines: [R], week, bodyweight: [],
      workouts: [{ ...bwSession(0), d: today }, { ...bwSession(1), d: today }],
    }
    expect(weeklyReview(st).training.done).toBe(2)
  })
})
