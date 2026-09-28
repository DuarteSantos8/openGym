import { describe, it, expect } from 'vitest'
import { insightsFor, sessionInsights, windowWorkouts } from './coach-insights.js'
import { EXIDX } from './exercises.js'

// Pick two real catalogue ids from different body parts so the body-part grouping is real.
const ids = Object.keys(EXIDX)
const chest = ids.find(id => EXIDX[id].bp === 'chest')
const legs = ids.find(id => EXIDX[id].bp === 'upper legs')

const day = (d, h = 10) => new Date(d + 'T' + String(h).padStart(2, '0') + ':00:00').getTime()
const w = (id, d, entries, over = {}) => ({ id, d, name: 'Push', start: day(d), end: day(d) + 55 * 60000, entries, ...over })
const set = (w_, r, extra = {}) => ({ done: true, w: w_, r, ...extra })

const S = () => ({
  unit: 'kg', targetW: 80, customEx: [{ id: 'cx1', n: 'My row', bp: 'back' }],
  bodyweight: [{ d: '2026-07-01', w: 90 }, { d: '2026-08-02', w: 84 }, { d: '2026-08-10', w: 83 }, { d: '2026-08-20', w: 82.5 }],
  workouts: [
    w('w0', '2026-07-20', [{ id: chest, sets: [set(60, 10)] }]),                                             // outside the window
    w('w1', '2026-08-03', [{ id: chest, sets: [set(40, 8, { phase: 'warmup' }), set(60, 10), set(60, 10)] }, { id: legs, sets: [set(100, 5)] }]),
    w('w2', '2026-08-06', [{ id: chest, sets: [set(65, 10), set(65, 9)] }, { id: 'cx1', sets: [set(50, 10)] }], { name: 'Pull' }),
    w('w3', '2026-08-12', [{ id: chest, sets: [set(70, 10), set(70, 10), { done: false, w: 70, r: 0 }] }, { id: legs, sets: [set(110, 5)] }], { prs: [chest] })
  ]
})

describe('insightsFor', () => {
  const win = { from: '2026-08-01', to: '2026-08-15' }
  it('counts only the window, and only done, non-warm-up work sets', () => {
    const i = insightsFor(S(), win)
    expect(i.sessions).toBe(3)
    expect(windowWorkouts(S(), win).map(x => x.id)).toEqual(['w1', 'w2', 'w3'])
    expect(i.sets).toBe(2 + 1 + 2 + 1 + 2 + 1)
    expect(i.minutes).toBe(55)
    // volume excludes the warm-up and the unchecked set
    expect(i.volume).toBe(60 * 10 * 2 + 100 * 5 + 65 * 10 + 65 * 9 + 50 * 10 + 70 * 10 * 2 + 110 * 5)
  })
  it('groups sets by body part, custom exercises included, biggest first', () => {
    const i = insightsFor(S(), win)
    expect(i.bodyParts[0]).toMatchObject({ bp: 'chest', sets: 6 })
    expect(i.bodyParts.map(b => b.bp)).toContain('back')
    expect(i.bodyParts.reduce((n, b) => n + b.share, 0)).toBeCloseTo(1, 5)
  })
  it('reads the body weight inside the window with its delta and goal', () => {
    const i = insightsFor(S(), win)
    expect(i.bodyweight.points.map(p => p.y)).toEqual([84, 83])
    expect(i.bodyweight.delta).toBe(-1)
    expect(i.bodyweight.goal).toBe(80)
    expect(i.bodyweight.last).toBe(83)
  })
  it('tracks estimated 1RM first → last for exercises with two or more sessions, most-trained first', () => {
    const i = insightsFor(S(), win, { topN: 1 })
    expect(i.strength).toHaveLength(1)
    const c = i.strength[0]
    expect(c.id).toBe(chest)
    expect(c.sessions).toBe(3)
    expect(c.last).toBeGreaterThan(c.first)
    expect(c.pct).toBeGreaterThan(0)
    expect(c.delta).toBeCloseTo(c.last - c.first, 1)
    expect(insightsFor(S(), win).strength.length).toBe(2)   // chest + legs; the custom row has one session
  })
  it('falls back to the workouts’ own span when no window is given', () => {
    const i = insightsFor(S())
    expect(i.sessions).toBe(4)
    expect(i.from).toBe('2026-07-20')
    expect(i.to).toBe('2026-08-12')
  })
  it('is empty-safe', () => {
    const i = insightsFor({ workouts: [], bodyweight: [] })
    expect(i.sessions).toBe(0)
    expect(i.minutes).toBeNull()
    expect(i.bodyweight.delta).toBeNull()
    expect(i.strength).toEqual([])
  })
})

describe('sessionInsights', () => {
  it('compares a workout with the previous one of the same name', () => {
    const s = S()
    const r = sessionInsights(s, s.workouts[3])   // w3 'Push' — previous Push is w1
    expect(r.prevDate).toBe('2026-08-03')
    expect(r.now.sets).toBe(3)
    expect(r.now.prs).toBe(1)
    expect(r.then.sets).toBe(3)
    expect(r.now.volume - r.then.volume).toBe((70 * 10 * 2 + 110 * 5) - (60 * 10 * 2 + 100 * 5))
    const chestLift = r.lifts.find(l => l.id === chest)
    expect(chestLift.w).toBe(70)
    expect(chestLift.prev).not.toBeNull()
    expect(chestLift.est).toBeGreaterThan(chestLift.prev)
  })
  it('has no comparison when the name was never trained before', () => {
    const s = S()
    const r = sessionInsights(s, s.workouts[2])   // the only 'Pull'
    expect(r.then).toBeNull()
    expect(r.prevDate).toBeNull()
    expect(r.lifts.every(l => l.prev === null)).toBe(true)
  })
  it('returns null for nothing', () => { expect(sessionInsights(S(), null)).toBeNull() })
})
