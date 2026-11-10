import { describe, it, expect, vi } from 'vitest'
vi.mock('./api.js', () => ({ api: vi.fn() }))
import { bbCurve, sessionCost, sleepVsStrength, runEfficiency, trainingLoad, sleepTarget } from './garmin-insights.js'

const wk = (d, extra = {}) => ({ id: d, d, start: `${d}T10:00:00`, end: `${d}T11:00:00`, entries: [], ...extra })
const act = (d, extra = {}) => ({ id: d, name: 'Gym', type: 'strength_training', start: `${d} 10:05:00`, dur: 3000, bb: -20, ...extra })

describe('bbCurve', () => {
  it('marks the gym session with its cost and the unmatched run', () => {
    const g = { days: [{ date: '2026-11-10', bb15: [[0, 80], [600, 60]] }], acts: [act('2026-11-10'), act('2026-11-10', { id: 'r', name: 'Run', type: 'running', start: '2026-11-10 18:00:00', dur: 1800, bb: -10 })] }
    const c = bbCurve(g, '2026-11-10', [wk('2026-11-10', { name: 'Push' })])
    expect(c.points[1]).toEqual({ m: 600, y: 60 })
    expect(c.marks).toEqual([
      { from: 600, to: 660, label: 'Push', kind: 'gym', cost: -20 },
      { from: 1080, to: 1110, label: 'Run', kind: 'activity', cost: -10 },
    ])
  })
  it('is null without a curve', () => expect(bbCurve({ days: [{ date: '2026-11-10' }] }, '2026-11-10', [])).toBeNull())
})

describe('sessionCost', () => {
  it('groups by routine and needs two sessions', () => {
    const days = ['01', '03', '05'].flatMap(n => [{ date: `2026-11-${n}`, hrv: 50, restHr: 50 }, { date: `2026-11-0${+n + 1}`, hrv: 40, restHr: 54 }])
    const g = { days, acts: ['2026-11-01', '2026-11-03', '2026-11-05'].map(d => act(d)) }
    const ws = ['2026-11-01', '2026-11-03', '2026-11-05'].map((d, i) => wk(d, { routineId: i < 2 ? 'a' : 'b' }))
    const r = sessionCost(g, ws, [{ id: 'a', name: 'Push' }])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ rid: 'a', name: 'Push', n: 2, bb: -20 })
    expect(r[0].rhrNext).toBeGreaterThan(0)
    expect(r[0].hrvNext).toBeLessThan(0)
  })
})

describe('sleepVsStrength', () => {
  const entry = w => ({ id: 'sq', sets: [{ w, r: 5, done: true }] })
  it('fills both buckets', () => {
    const dates = Array.from({ length: 9 }, (_, i) => `2026-10-0${i + 1}`)
    const workouts = [{ id: 'x', d: '2026-09-30', entries: [entry(100)] }, ...dates.map((d, i) => ({ id: d, d, entries: [entry(100 + (i + 1) * 5)] }))]
    const g = { days: dates.map((date, i) => ({ date, sleepScore: i < 3 ? 90 : i < 6 ? 50 : 72 })) }
    const r = sleepVsStrength({ workouts }, g)
    expect(r.good.n).toBe(3)
    expect(r.poor.n).toBe(3)
    expect(r.good.pct).toBeGreaterThan(0)
  })
  it('is null with too little data', () => expect(sleepVsStrength({ workouts: [] }, { days: [] })).toBeNull())
})

describe('runEfficiency', () => {
  const run = (d, speed) => ({ type: 'running', start: `${d} 07:00:00`, dur: 1800, speed, hr: 150 })
  it('rounds metres per beat and reports the change', () => {
    const acts = [3.4, 3.3, 3.2, 2.8, 2.9, 3].map((s, i) => run(`2026-11-0${6 - i}`, s))
    const r = runEfficiency({ acts })
    expect(r.points[0]).toEqual({ d: '2026-11-01', y: 1.2 })
    expect(r.change).toBeGreaterThan(0)
  })
  it('skips short runs and gives no change under six', () => {
    expect(runEfficiency({ acts: [run('2026-11-01', 3), { ...run('2026-11-02', 3), dur: 300 }] })).toBeNull()
    expect(runEfficiency({ acts: [run('2026-11-01', 3), run('2026-11-02', 3)] }).change).toBeNull()
  })
})

describe('trainingLoad', () => {
  it('sums weeks Monday to Sunday and the acute ratio', () => {
    const g = { acts: [act('2026-11-10', { load: 100 }), act('2026-11-02', { load: 60 }), act('2026-10-20', { load: 40 })] }
    const ws = [wk('2026-11-10', { entries: [{ id: 'sq', sets: [{ w: 100, r: 5, done: true }, { w: 100, r: 5, done: false }] }] })]
    const t = trainingLoad(g, ws, '2026-11-10', 3)
    expect(t.weeks.map(x => x.from)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09'])
    expect(t.weeks.map(x => x.garmin)).toEqual([0, 60, 100])
    expect(t.weeks[2].gym).toBe(500)
    expect(t.acute).toBe(100)
    expect(t.chronic).toBe(50)
    expect(t.ratio).toBe(2)
  })
})

describe('sleepTarget', () => {
  it('prefers Garmin, then manual, then the default', () => {
    expect(sleepTarget({ needTonight: { min: 480, bedFrom: 1350 } }, '2026-11-10', 400)).toMatchObject({ min: 480, source: 'garmin', bedFrom: 1350 })
    expect(sleepTarget({ days: [{ date: '2026-11-10', sleepNeed: 470 }] }, '2026-11-10', 400).source).toBe('garmin')
    expect(sleepTarget({}, '2026-11-10', 400)).toMatchObject({ min: 400, source: 'manual' })
    expect(sleepTarget(null, '2026-11-10', 0)).toMatchObject({ min: 450, source: 'default' })
  })
})
