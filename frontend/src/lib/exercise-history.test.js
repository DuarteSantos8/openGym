import { describe, it, expect, vi } from 'vitest'
import { exerciseHistory, HISTORY_SESSIONS } from './exercise-history.js'
import { estimate1RM } from './onerm.js'
import { socialSummary } from '../../../api/social/summary.js'
import { weekStreak } from '../../../api/training/history-metrics.js'
import { streakWeeks } from './history.js'

describe('friend progress summaries', () => {
  it('uses the same personal record and first-reached date as exercise history', () => {
    const cases = [
      [session(0, [warm(150, 5), work(60, 5), work(200, 5, false)]), session(1, [work(70, 5)]), session(2, [work(70, 5)])],
      [session(0, [work(0, 10)]), session(1, [work(0, 15)])],
      [session(0, [{ sec: 45, done: true }], { target: { mode: 'time' } }), session(1, [{ sec: 90, done: true }], { target: { mode: 'time' } })],
      [session(0, [{ min: 10, done: true }, { min: 20, done: true }], { target: { mode: 'cardio' } })],
      [session(0, [work(70, 5)]), session(1, [{ sec: 30, done: true }], { target: { mode: 'time' } })],
      [session(0, [{ mode: 'time', sec: 100, w: 150, done: true }, work(50, 5)])],
      [session(0, [{ ...work(40, 5), phase: 'work', warmup: true }, { ...work(90, 5), phase: 'warm-up' }])],
      [session(0, [{ r: 5, done: true }], { topW: 65 })],
      [session(0, [work(0, 10)], { topW: 65 })],
    ]
    for (const workouts of cases) {
      const state = { workouts: [...workouts].reverse(), unit: 'lb' }
      const history = exerciseHistory(state, 'bench')
      const summary = socialSummary(state, '2026-01-11')
      expect(summary.records[0]).toMatchObject({ exerciseId: 'bench', metric: history.metric, value: history.best,
        date: workouts.find(w => w.id === history.prId).d })
      expect(summary.unit).toBe('lb')
    }
  })

  it('shares only derived progress, with custom exercise names but no private notes', () => {
    const state = { workouts: [{ ...session(0, [work(60, 5)]), note: 'private note', bw: 82 }],
      bodyweight: [{ w: 82 }], customEx: [{ id: 'bench', n: 'My press', desc: 'private description' }], gymCards: ['secret'] }
    const summary = socialSummary(state, '2026-01-11')
    expect(Object.keys(summary).sort()).toEqual(['lastWorkout', 'recordCount', 'records', 'thisWeek', 'unit', 'weekStreak', 'workouts'])
    expect(summary.records[0].name).toBe('My press')
    expect(JSON.stringify(summary)).not.toMatch(/private|secret|bodyweight|sets|82/)
    expect(socialSummary(null, '2026-01-11')).toMatchObject({ workouts: 0, weekStreak: 0, records: [], lastWorkout: null })
    expect(socialSummary({ workouts: [null, { d: 'bad' }, session(0, [null, 'bad', work(60, 5)])] }, '2026-01-11').records[0].value).toBe(60)
  })

  it('counts weekly streaks with the same unfinished-week grace as Home', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-19T12:00:00'))
      const state = { workouts: [{ d: '2026-01-05' }, { d: '2026-01-12' }], weekStart: 1 }
      expect(streakWeeks(state)).toBe(2)
      expect(socialSummary(state, '2026-01-19').weekStreak).toBe(streakWeeks(state))
      expect(weekStreak(['2026-01-05'], '2026-01-19')).toBe(0)
      expect(weekStreak(['2026-01-04', '2026-01-11'], '2026-01-12', 0)).toBe(2)
      expect(weekStreak(['2026-01-04', '2026-01-11'], '2026-01-12', 1)).toBe(2)
      expect(weekStreak(['2026-01-11', '2026-01-12'], '2026-01-12', 0)).toBe(1)
      expect(weekStreak(['2026-01-11', '2026-01-12'], '2026-01-12', 1)).toBe(2)
    } finally { vi.useRealTimers() }
  })
})

const DAY = 86400000
const T0 = Date.UTC(2026, 0, 5, 10)
const iso = i => new Date(T0 + i * DAY).toISOString().slice(0, 10)

// One workout on day `i` with a single bench entry made of the given rows.
const session = (i, rows, extra = {}) => ({
  id: 'w' + i, d: iso(i), start: T0 + i * DAY, entries: [{ id: 'bench', target: { mode: 'reps' }, sets: rows, ...extra }],
})
const work = (w, r, done = true) => ({ w, r, done })
const warm = (w, r) => ({ w, r, done: true, phase: 'warmup' })

describe('exerciseHistory', () => {
  it('is empty when the exercise was never logged', () => {
    const S = { workouts: [session(0, [work(60, 5)])] }
    expect(exerciseHistory(S, 'squat')).toMatchObject({ total: 0, best: 0, prId: null, sessions: [], points: [] })
    expect(exerciseHistory({ workouts: [] }, 'bench').total).toBe(0)
    expect(exerciseHistory({}, 'bench').total).toBe(0)
  })

  it('lists sessions newest first with their work sets, value and volume', () => {
    const S = { workouts: [session(0, [work(60, 5), work(60, 5)]), session(2, [work(65, 5), work(65, 4)])] }
    const h = exerciseHistory(S, 'bench')
    expect(h.mode).toBe('reps')
    expect(h.metric).toBe('weight')
    expect(h.total).toBe(2)
    expect(h.sessions.map(s => s.d)).toEqual([iso(2), iso(0)])
    expect(h.sessions[0]).toMatchObject({ value: 65, volume: 65 * 9, target: { mode: 'reps' } })
    expect(h.sessions[0].sets).toHaveLength(2)
    expect(h.sessions[1]).toMatchObject({ value: 60, volume: 600 })
    // the chart stays chronological
    expect(h.points.map(p => [p.d, p.y])).toEqual([[iso(0), 60], [iso(2), 65]])
  })

  it('leaves warm-ups and unfinished rows out of every number', () => {
    const S = { workouts: [session(0, [warm(40, 8), work(60, 5), work(100, 5, false)])] }
    const h = exerciseHistory(S, 'bench')
    expect(h.best).toBe(60)
    expect(h.sessions[0].sets).toEqual([work(60, 5)])
    expect(h.sessions[0].volume).toBe(300)
    expect(h.sessions[0].e1rm).toBe(estimate1RM(60, 5))
  })

  it('marks the PR on the session that first reached the best weight, once', () => {
    const S = { workouts: [
      session(0, [work(60, 5)]), session(1, [work(70, 5)]), session(2, [work(65, 5)]), session(3, [work(70, 3)]),
    ] }
    const h = exerciseHistory(S, 'bench')
    expect(h.best).toBe(70)
    expect(h.prId).toBe('w1')
    expect(h.sessions.filter(s => s.pr).map(s => s.id)).toEqual(['w1'])
  })

  it('keeps the last ten sessions in the list but every session on the chart', () => {
    const S = { workouts: Array.from({ length: 14 }, (_, i) => session(i, [work(50 + i, 5)])) }
    const h = exerciseHistory(S, 'bench')
    expect(h.total).toBe(14)
    expect(h.sessions).toHaveLength(HISTORY_SESSIONS)
    expect(h.sessions[0].d).toBe(iso(13))
    expect(h.sessions.at(-1).d).toBe(iso(4))
    expect(h.points).toHaveLength(14)
    expect(h.e1rmPoints).toHaveLength(14)
    // the record lives outside the listed window, so no listed session carries the marker
    expect(h.prId).toBe('w13')
    expect(exerciseHistory(S, 'bench', { limit: 3 }).sessions).toHaveLength(3)
  })

  it('orders backfilled sessions by date, not by position in the log', () => {
    const S = { workouts: [session(5, [work(60, 5)]), { ...session(1, [work(80, 5)]), start: undefined }] }
    const h = exerciseHistory(S, 'bench')
    expect(h.points.map(p => p.d)).toEqual([iso(1), iso(5)])
    expect(h.sessions.map(s => s.d)).toEqual([iso(5), iso(1)])
    expect(h.prId).toBe('w1')
  })

  it('plots reps for an exercise that was never loaded', () => {
    const S = { workouts: [session(0, [work(0, 8)]), session(1, [work(0, 10), work(0, 9)])] }
    const h = exerciseHistory(S, 'bench')
    expect(h.metric).toBe('reps')
    expect(h.points.map(p => p.y)).toEqual([8, 10])
    expect(h.best).toBe(10)
    expect(h.prId).toBe('w1')
  })

  it('plots the longest hold for timed work and the minutes for cardio', () => {
    const hold = i => ({ id: 'h' + i, d: iso(i), start: T0 + i * DAY, entries: [{ id: 'plank', target: { mode: 'time' }, sets: [{ sec: 40 + i * 10, done: true }, { sec: 30, done: true }] }] })
    const run = i => ({ id: 'r' + i, d: iso(i), start: T0 + i * DAY, entries: [{ id: 'run', target: { mode: 'cardio' }, sets: [{ min: 20, speed: 10, done: true }, { min: 5, speed: 12, done: true }] }] })
    const S = { workouts: [hold(0), hold(1), run(0)] }
    const plank = exerciseHistory(S, 'plank')
    expect(plank).toMatchObject({ mode: 'time', metric: 'sec', best: 50, prId: 'h1' })
    expect(plank.points.map(p => p.y)).toEqual([40, 50])
    expect(plank.sessions[0].volume).toBeNull()
    expect(plank.e1rmPoints).toEqual([])
    const cardio = exerciseHistory(S, 'run')
    expect(cardio).toMatchObject({ mode: 'cardio', metric: 'min', best: 25 })
    expect(cardio.points[0].y).toBe(25)
  })

  it('gives a session logged in another mode no point, but keeps it in the list', () => {
    const S = { workouts: [
      { id: 'a', d: iso(0), start: T0, entries: [{ id: 'x', target: { mode: 'time' }, sets: [{ sec: 30, done: true }] }] },
      { id: 'b', d: iso(1), start: T0 + DAY, entries: [{ id: 'x', target: { mode: 'reps' }, sets: [work(20, 10)] }] },
    ] }
    const h = exerciseHistory(S, 'x')
    expect(h.mode).toBe('reps')
    expect(h.points).toHaveLength(1)
    expect(h.sessions.map(s => [s.id, s.value])).toEqual([['b', 20], ['a', null]])
  })
})
