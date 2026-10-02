import { describe, it, expect, vi } from 'vitest'
import { exerciseHistory, HISTORY_SESSIONS, bestSetFor } from './exercise-history.js'
import { EXDB } from './exercises-data.js'
import { estimate1RM, e1rmSeries } from './onerm.js'
import { lastEntryFor } from './history.js'
import { nextPrescription } from './progression.js'
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

  it('pairs a load record with reps from that exact completed work set', () => {
    const state = { workouts: [session(0, [warm(120, 12), work(100, 5), work(60, 20), work(140, 8, false)])] }
    expect(socialSummary(state, '2026-01-11').records[0]).toMatchObject({ value: 100, reps: 5 })
    state.workouts.push(session(1, [work(100, 8)]))
    expect(socialSummary(state, '2026-01-11').records[0]).toMatchObject({ value: 100, reps: 5, date: iso(0) })
    const legacy = { workouts: [session(0, [{ r: 8, done: true }], { topW: 90 })] }
    expect(socialSummary(legacy, '2026-01-11').records[0].reps).toBeUndefined()
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

  it('aggregates duplicate occurrences into one dated snapshot and keeps only completed work', () => {
    const first = { id: 'bench', target: { mode: 'reps' }, sets: [warm(120, 5), work(60, 5)] }
    const later = { id: 'bench', target: { mode: 'reps' }, sets: [work(80, 5), work(200, 5, false)] }
    const S = { workouts: [{ id: 'combined', d: iso(4), start: T0 + 4 * DAY, entries: [first, later] }] }
    const before = structuredClone(S)
    const h = exerciseHistory(S, 'bench')
    expect(h).toMatchObject({ total: 1, best: 80, prId: 'combined' })
    expect(h.sessions[0]).toMatchObject({ id: 'combined', d: iso(4), value: 80, volume: 700 })
    expect(h.sessions[0].sets).toEqual([work(60, 5), work(80, 5)])
    expect(h.sessions[0].e1rm).toBe(estimate1RM(80, 5))
    expect(S).toEqual(before)
  })

  it('uses completed per-side limbs from duplicate occurrences without combining modes', () => {
    const partialSide = {
      id: 'bench', target: { mode: 'reps', side: true }, sets: [{ phase: 'work', w: 100, r: 10, done: false,
        sides: { L: { w: 100, r: 5, done: true }, R: { w: 200, r: 5, done: false } } }],
    }
    const timed = { id: 'bench', target: { mode: 'time' }, sets: [{ sec: 60, done: true }] }
    const S = { workouts: [{ id: 'sides', d: iso(5), start: T0 + 5 * DAY, entries: [timed, partialSide] }] }
    const h = exerciseHistory(S, 'bench')
    expect(h).toMatchObject({ total: 1, mode: 'reps', metric: 'weight', best: 100 })
    expect(h.sessions[0]).toMatchObject({ value: 100, volume: 500, e1rm: estimate1RM(100, 5) })
    expect(h.sessions[0].sets).toHaveLength(1)
    expect(h.sessions[0].sets[0]).toBe(partialSide.sets[0])
  })

  it('aggregates timed and cardio duplicates by their own metric', () => {
    const hold = { id: 'hold', d: iso(6), start: T0 + 6 * DAY, entries: [
      { id: 'plank', target: { mode: 'time' }, sets: [{ sec: 30, done: true }] },
      { id: 'plank', target: { mode: 'time' }, sets: [{ sec: 45, done: true }] },
    ] }
    const run = { id: 'run', d: iso(7), start: T0 + 7 * DAY, entries: [
      { id: 'run', target: { mode: 'cardio' }, sets: [{ min: 20, speed: 9, done: true }] },
      { id: 'run', target: { mode: 'cardio' }, sets: [{ min: 5, speed: 10, done: true }] },
    ] }
    expect(exerciseHistory({ workouts: [hold] }, 'plank').sessions[0]).toMatchObject({ value: 45, volume: null })
    expect(exerciseHistory({ workouts: [run] }, 'run').sessions[0]).toMatchObject({ value: 25, volume: null })
  })

  // The history sheet and Stats speak for the exercise, so a combined day that trains it in two
  // routines is one session with both occurrences. What the next session opens at is per routine
  // slot (#216): each routine reads its own occurrence of that day, never the other one's or the
  // two folded together.
  it('reads both routines\' occurrences of a combined day, while each routine progresses from its own', () => {
    const heavy = { id: 'bench', rid: 'A', target: { mode: 'reps', sets: 2, reps: 5 }, planned: { sets: 2, reps: 5 }, sets: [work(100, 5), work(100, 5)] }
    const light = { id: 'bench', rid: 'B', target: { mode: 'reps', sets: 2, reps: 12 }, planned: { sets: 2, reps: 12 }, sets: [work(60, 12), work(60, 12)] }
    const S = {
      unit: 'kg', exWeights: {},
      routines: [{ id: 'A', ex: [{ id: 'bench', sets: 2, reps: 5 }] }, { id: 'B', ex: [{ id: 'bench', sets: 2, reps: 12 }] }],
      workouts: [{ id: 'ab', d: iso(3), start: T0 + 3 * DAY, routineIds: ['A', 'B'], entries: [heavy, light] }],
    }
    const h = exerciseHistory(S, 'bench')
    expect(h).toMatchObject({ total: 1, best: 100 })
    expect(h.sessions[0].sets).toEqual([...heavy.sets, ...light.sets])
    expect(e1rmSeries(S, 'bench')).toHaveLength(1)

    expect(lastEntryFor(S, 'bench', 'A').sets).toEqual(heavy.sets)
    expect(lastEntryFor(S, 'bench', 'B').sets).toEqual(light.sets)
    expect(nextPrescription(S, S.routines[0].ex[0], S.routines[0]).weight).toBe(102.5)
    expect(nextPrescription(S, S.routines[1].ex[0], S.routines[1]).weight).toBe(62.5)
  })
})

// #173: the workout card can hold today's rows against your best set instead of last time.
describe('bestSetFor', () => {
  it('is the heaviest work set, the most reps of equally heavy ones, first time reached', () => {
    const S = { workouts: [
      session(0, [warm(120, 1), work(100, 5), work(100, 6)]),
      session(2, [work(100, 6), work(90, 12)]),
      session(4, [work(95, 8), work(110, 3, false)]),
    ] }
    const best = bestSetFor(S, 'bench', 'reps')
    expect(best).toMatchObject({ d: iso(0), set: { w: 100, r: 6 }, target: { mode: 'reps' } })
  })

  it('looks across every routine and ignores the order workouts are stored in', () => {
    const later = { ...session(3, [work(80, 5)]), entries: [{ id: 'bench', rid: 'b', target: { mode: 'reps' }, sets: [work(80, 5)] }] }
    const earlier = { ...session(1, [work(80, 5)]), entries: [{ id: 'bench', rid: 'a', target: { mode: 'reps' }, sets: [work(80, 5)] }] }
    expect(bestSetFor({ workouts: [later, earlier] }, 'bench', 'reps').d).toBe(iso(1))
  })

  it('compares holds by their length and cardio by its minutes, never across modes', () => {
    const hold = (i, sec, w = 0) => ({ id: 'h' + i, d: iso(i), start: T0 + i * DAY, entries: [{ id: 'plank', target: { mode: 'time' }, sets: [{ sec, w, done: true }] }] })
    const S = { workouts: [hold(0, 60), hold(1, 90), hold(2, 90, 10), session(3, [work(20, 5)])] }
    expect(bestSetFor(S, 'plank', 'time')).toMatchObject({ d: iso(2), set: { sec: 90, w: 10 } })
    // the rep sets of another exercise, and a mode the exercise was never logged in, give nothing
    expect(bestSetFor(S, 'plank', 'reps')).toBeNull()
    const run = (i, min, speed) => ({ id: 'r' + i, d: iso(i), start: T0 + i * DAY, entries: [{ id: 'run', target: { mode: 'cardio' }, sets: [{ min, speed, done: true }] }] })
    expect(bestSetFor({ workouts: [run(0, 30, 9), run(1, 30, 10), run(2, 25, 12)] }, 'run', 'cardio').set).toMatchObject({ min: 30, speed: 10 })
  })

  // Asked on every render of every card while the line shows the best set, and each stepper tap
  // re-renders them all: copying and sorting a long history each time was the cost of a tap.
  it('settles a tie by start time in one pass, without sorting the history', () => {
    const at = (i, rid) => ({ ...session(i, [work(80, 5)]), entries: [{ id: 'bench', rid, target: { mode: 'reps' }, sets: [work(80, 5)] }] })
    const workouts = [at(5, 'c'), at(3, 'b'), at(1, 'a'), session(4, [work(70, 10)])]
    const sort = vi.spyOn(Array.prototype, 'sort')
    try {
      expect(bestSetFor({ workouts }, 'bench', 'reps')).toMatchObject({ d: iso(1), target: { mode: 'reps' } })
      expect(sort).not.toHaveBeenCalled()
    } finally { sort.mockRestore() }
    // a heavier set later on still beats an earlier tie
    expect(bestSetFor({ workouts: [...workouts, session(6, [work(85, 1)])] }, 'bench', 'reps')).toMatchObject({ d: iso(6), set: { w: 85, r: 1 } })
  })

  it('takes the least help on an assistance machine, and nothing when nothing was logged', () => {
    const id = EXDB.find(e => e.eq === 'leverage machine' && /assist/i.test(e.n)).id
    const S = { workouts: [0, 1, 2].map(i => ({ id: 'a' + i, d: iso(i), start: T0 + i * DAY,
      entries: [{ id, target: { mode: 'reps' }, sets: [work([30, 20, 0][i], 8)] }] })) }
    expect(bestSetFor(S, id, 'reps').set).toMatchObject({ w: 20, r: 8 })
    expect(bestSetFor({ workouts: [] }, 'bench', 'reps')).toBeNull()
    expect(bestSetFor({}, 'bench')).toBeNull()
  })
})
