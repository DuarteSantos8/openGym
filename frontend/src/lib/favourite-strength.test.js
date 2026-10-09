import { describe, it, expect } from 'vitest'
import { favouriteStrength, GAIN_DAYS, TREND_POINTS } from './favourite-strength.js'

const DAY = 86400000
const NOW = Date.UTC(2026, 2, 1)
const at = daysAgo => NOW - daysAgo * DAY
const iso = ms => new Date(ms).toISOString().slice(0, 10)
const wk = (daysAgo, id, sets) => ({ d: iso(at(daysAgo)), start: at(daysAgo), entries: [{ id, sets }] })
const set = (w, r) => ({ w, r, done: true })

const S = {
  favEx: ['squat', 'bench', 'plank', 'run', 'never-logged'],
  workouts: [
    wk(60, 'bench', [set(80, 5)]),        // 93.3
    wk(40, 'squat', [set(100, 5)]),       // 116.7
    wk(20, 'bench', [set(90, 5)]),        // 105
    wk(10, 'bench', [set(85, 5)]),        // 99.2, not a new best
    wk(5, 'plank', [{ sec: 60, w: 0, done: true }]),
    wk(3, 'run', [{ min: 30, speed: 10, done: true }]),
    wk(2, 'deadlift', [set(140, 3)]),     // logged, but not a favourite
  ],
}

describe('favouriteStrength', () => {
  it('lists favourites with an estimate, in favourite order, with the set behind the best', () => {
    const rows = favouriteStrength(S, { now: NOW })
    expect(rows.map(r => r.id)).toEqual(['squat', 'bench'])
    expect(rows[1].best).toEqual({ est: 105, w: 90, r: 5, d: iso(at(20)) })
  })

  it('leaves out timed, cardio, never-logged and non-favourite exercises', () => {
    const ids = favouriteStrength(S, { now: NOW }).map(r => r.id)
    expect(ids).not.toContain('plank')
    expect(ids).not.toContain('run')
    expect(ids).not.toContain('never-logged')
    expect(ids).not.toContain('deadlift')
  })

  it('reports the gain over the window against the best that stood before it', () => {
    const bench = favouriteStrength(S, { now: NOW }).find(r => r.id === 'bench')
    expect(bench.gain).toBe(11.7)   // 105 − 93.3
  })

  it('has no gain when nothing was logged before the window, or the best did not move', () => {
    const squat = favouriteStrength(S, { now: NOW }).find(r => r.id === 'squat')
    expect(squat.gain).toBeNull()   // only logged before the window
    const fresh = { favEx: ['bench'], workouts: [wk(5, 'bench', [set(60, 5)]), wk(2, 'bench', [set(70, 5)])] }
    expect(favouriteStrength(fresh, { now: NOW })[0].gain).toBeNull()   // first sessions are not a gain
  })

  it('counts a session exactly at the window edge as inside it', () => {
    const S2 = { favEx: ['bench'], workouts: [wk(GAIN_DAYS + 1, 'bench', [set(80, 5)]), wk(GAIN_DAYS, 'bench', [set(90, 5)])] }
    expect(favouriteStrength(S2, { now: NOW })[0].gain).toBe(11.7)
  })

  it('carries the per-session estimates for the trend line, oldest first', () => {
    const bench = favouriteStrength(S, { now: NOW }).find(r => r.id === 'bench')
    expect(bench.trend.map(p => p.y)).toEqual([93.3, 105, 99.2])
    expect(bench.trend[0].d).toBe(iso(at(60)))
  })

  it('keeps only the latest sessions in the trend', () => {
    const many = { favEx: ['bench'], workouts: Array.from({ length: TREND_POINTS + 5 }, (_, i) => wk(40 - i, 'bench', [set(60 + i, 5)])) }
    const trend = favouriteStrength(many, { now: NOW })[0].trend
    expect(trend).toHaveLength(TREND_POINTS)
    expect(trend.at(-1).y).toBe(Math.round((60 + TREND_POINTS + 4) * (1 + 5 / 30) * 10) / 10)
  })

  it('tolerates a profile with no favourites or no workouts', () => {
    expect(favouriteStrength({}, { now: NOW })).toEqual([])
    expect(favouriteStrength({ favEx: ['bench'] }, { now: NOW })).toEqual([])
    expect(favouriteStrength({ workouts: S.workouts }, { now: NOW })).toEqual([])
  })

  it('follows the formula it is given', () => {
    const one = { favEx: ['bench'], workouts: [wk(1, 'bench', [set(100, 5)])] }
    expect(favouriteStrength(one, { now: NOW })[0].best.est).toBe(116.7)
    expect(favouriteStrength(one, { now: NOW, formula: 'brzycki' })[0].best.est).toBe(112.5)
  })
})
