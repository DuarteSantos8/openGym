import { describe, it, expect } from 'vitest'
import { goalProgress, goalSeries, goalsOf, goalWeight, goalKg, visibleGoals, repeatGoal } from './exercise-goals.js'
import { mergeStates, stampChange } from './sync-merge.js'
import { convertStateUnit } from './units.js'
import { stampPut } from '../../../api/sync-stamps.js'

const goal = (extra = {}) => ({ exerciseId: '0025', type: 'e1rm', target: 100, createdAt: 2000, formula: 'epley', ...extra })
const workout = (start, w, r = 1, extra = {}) => ({ id: String(start), start, d: '2026-10-19', entries: [{ id: '0025', sets: [{ w, r, done: true, ...extra }] }] })
const state = (...workouts) => ({ unit: 'kg', workouts })
describe('exercise goals', () => {
  it('dates completion at the first qualifying success, not the later best or creation date', () => {
    const p = goalProgress(state(workout(500, 80), workout(1000, 100), workout(1500, 110), workout(3000, 90)), goal(), 4000)
    expect(p.completion.t).toBe(1000)
    expect(p.best.y).toBe(110)
    expect(p.achieved).toBe(true)
  })
  it('uses the existing decay curve without reducing historical achievement', () => {
    const day = 86400000, S = state(workout(1000, 100))
    expect(goalProgress(S, goal(), 1000 + 14 * day).current).toBe(100)
    const p = goalProgress(S, goal(), 1000 + 42 * day)
    expect(p.current).toBe(50)
    expect(p.achieved).toBe(true)
    expect(goalProgress(S, goal(), 1000 + 100 * day).current).toBe(50)
    expect(goalProgress(S, goal({ type: 'weight', reps: 1 }), 1000 + 42 * day).current).toBeNull()
  })
  it('repeats from the latest session and preserves earlier achievements through subsequent attempts', () => {
    const S = state(workout(500, 80), workout(1000, 100), workout(2000, 70))
    const next = repeatGoal(S, goal(), 3000)
    expect(next.achievements).toHaveLength(1)
    expect(next.achievements[0]).toMatchObject({ completedAt: 1000, target: 100 })
    expect(goalProgress(S, next, 4000)).toMatchObject({ achieved: false, percent: 0, waiting: true, baseline: { y: 70 } })
    S.workouts.push(workout(4000, 85))
    expect(goalProgress(S, next, 5000)).toMatchObject({ achieved: false, percent: 50, waiting: false })
    S.workouts.push(workout(5000, 100), workout(5500, 60))
    expect(goalProgress(S, next, 6000).completion.t).toBe(5000)
    const again = repeatGoal(S, next, 6000)
    expect(again.achievements.map(a => a.completedAt)).toEqual([1000, 5000])
    expect(goalProgress(S, again, 7000)).toMatchObject({ achieved: false, baseline: { y: 60 } })
    expect(repeatGoal(S, again, 7000)).toBeNull()
  })
  it('requires a fresh success even when the restart baseline already meets the target', () => {
    const S = state(workout(1000, 110)), next = repeatGoal(S, goal(), 2000)
    expect(goalProgress(S, next, 3000)).toMatchObject({ achieved: false, percent: 0 })
    S.workouts.push(workout(3000, 90), workout(4000, 100))
    expect(goalProgress(S, next, 3500).achieved).toBe(false)
    expect(goalProgress(S, next, 5000).achieved).toBe(true)
    S.workouts.pop()
    expect(goalProgress(S, next, 5000).achieved).toBe(false)
    expect(next.achievements).toHaveLength(1)
  })
  it('counts historical improvement from the first qualifying session, even before goal creation', () => {
    const p = goalProgress(state(workout(500, 60), workout(1000, 80), workout(1500, 70), workout(3000, 90)), goal())
    expect(p.points.map(x => x.y)).toEqual([60, 80, 70, 90])
    expect(p.baseline.y).toBe(60)
    expect(p.best.y).toBe(90)
    expect(p.percent).toBe(75)
    expect(goalProgress(state(workout(500, 60), workout(1000, 80)), goal()).percent).toBe(50)
    expect(goalProgress(state(workout(500, 60), workout(1000, 80)), goal()).points).toHaveLength(2)
  })
  it('measures the gap from the baseline and keeps the best through a lighter session', () => {
    const p = goalProgress(state(workout(1000, 80), workout(3000, 90), workout(4000, 85)), goal())
    expect(p.percent).toBe(50); expect(p.remaining).toBe(10); expect(p.latest.y).toBe(85)
  })
  it('recalculates achievement when its supporting workout is removed or corrected', () => {
    expect(goalProgress(state(workout(1000, 80), workout(3000, 100)), goal()).achieved).toBe(true)
    expect(goalProgress(state(workout(1000, 80), workout(3000, 90)), goal()).achieved).toBe(false)
    expect(goalProgress(state(workout(1000, 80)), goal()).percent).toBe(0)
  })
  it('never invents a starting value and treats an existing qualifying record as achieved', () => {
    expect(goalProgress(state(), goal()).baseline).toBeNull()
    expect(goalProgress(state(workout(3000, 80)), goal()).percent).toBe(0)
    expect(goalProgress(state(workout(1000, 110)), goal()).percent).toBe(100)
  })
  it('separates estimated 1RM from an actual single and excludes warmups/incomplete work', () => {
    const S = state(workout(1000, 90, 5), workout(3000, 200, 1, { warmup: true }), workout(4000, 300, 1, { done: false }))
    expect(goalProgress(S, goal()).achieved).toBe(true)
    expect(goalProgress(S, goal({ type: 'weight', reps: 1 })).best.y).toBe(90)
    expect(goalSeries(S, goal()).map(p => p.y)).toEqual([105])
  })
  it('checks rep thresholds and only compares reps at the specified load', () => {
    const S = state(workout(1000, 60, 8), workout(3000, 50, 15), workout(4000, 80, 3))
    expect(goalProgress(S, goal({ type: 'weight', reps: 5 })).best.y).toBe(60)
    expect(goalProgress(S, goal({ type: 'reps', weightKg: 60, target: 12 })).best.y).toBe(8)
  })
  it('tracks timed work without counting reps or preparation', () => {
    const S = state({ start: 1000, d: '2026-10-19', entries: [{ id: '0025', target: { mode: 'time' }, sets: [{ done: true, w: 0, sec: 75 }] }, { id: '0025', target: { mode: 'time' }, sets: [{ phase: 'warmup', done: true, w: 0, sec: 999 }] }] })
    expect(goalProgress(S, goal({ type: 'time', weightKg: 0, target: 90 })).best.y).toBe(75)
  })
  it('preserves target meaning when units change', () => {
    const g = goal({ type: 'weight', reps: 5 }), S = state(workout(1000, 80, 5), workout(3000, 90, 5))
    const lb = convertStateUnit({ ...S, exerciseGoals: { g } }, 'lb')
    expect(lb.exerciseGoals.g.target).toBe(100)
    expect(goalProgress(lb, g).best.y).toBeCloseTo(90, 0)
    expect(goalKg(goalWeight(100, 'lb'), 'lb')).toBeCloseTo(100)
  })
  it('ignores cleared and malformed records', () => {
    expect(goalsOf({ exerciseGoals: { cleared: { _ts: 30 }, invalid: goal({ target: -1 }), g: goal() } }).map(g => g.id)).toEqual(['g'])
  })
  it('sorts comparable progress and applies type/status filters', () => {
    const rows = [{ name: 'B', goal: goal({ createdAt: 3 }), progress: { percent: 60, achieved: false } }, { name: 'A', goal: goal({ createdAt: 2, archived: true }), progress: { percent: 100, achieved: true } }]
    expect(visibleGoals(rows, {}).map(r => r.name)).toEqual(['B'])
    expect(visibleGoals(rows, { status: 'all', sort: 'name' }).map(r => r.name)).toEqual(['A', 'B'])
    expect(visibleGoals(rows, { type: 'time' })).toEqual([])
  })
})
describe('goal sync', () => {
  const change = (prev, now, fn) => { const next = structuredClone(prev); fn(next); next._ts = stampChange(prev, next, now); return next }
  it('keeps a repeated attempt and its achievement when a stale device syncs', () => {
    const base = { ...state(workout(1000, 100)), exerciseGoals: { g: { ...goal(), _ts: 2000 } }, _ts: 2000 }
    const next = change(base, 3000, s => { s.exerciseGoals.g = repeatGoal(s, s.exerciseGoals.g, 3000) })
    stampPut(base, next, { overRead: true, now: 3000 })
    const merged = mergeStates(base, next)
    expect(merged.exerciseGoals.g.attemptStartedAt).toBe(3000)
    expect(merged.exerciseGoals.g.achievements).toHaveLength(1)
    expect(goalProgress(merged, merged.exerciseGoals.g, 4000).achieved).toBe(false)
  })
  it('merges independent device additions and does not resurrect deleted goals', () => {
    const base = { unit: 'kg', _ts: 10, exerciseGoals: {} }
    const a = change(base, 20, s => { s.exerciseGoals.a = { ...goal(), _ts: 20 } })
    const b = change(base, 30, s => { s.exerciseGoals.b = { ...goal(), _ts: 30 } })
    const merged = mergeStates(a, b)
    expect(goalsOf(merged)).toHaveLength(2)
    const deleted = change(merged, 40, s => { s.exerciseGoals.a = { _ts: 40 } })
    expect(goalsOf(mergeStates(a, deleted)).map(g => g.id)).toEqual(['b'])
  })
  it('seeded stamped goals survive the server and a stale client merge', () => {
    const prev = { unit: 'kg', _ts: 10, workouts: [], exerciseGoals: {} }
    const next = { ...prev, exerciseGoals: { seeded: { ...goal(), _ts: 50 } } }
    stampPut(prev, next, { overRead: true, now: 50 })
    expect(next.exerciseGoals.seeded._ts).toBe(50)
    expect(goalsOf(mergeStates({ ...prev, _ts: 100 }, next))).toHaveLength(1)
  })
})
