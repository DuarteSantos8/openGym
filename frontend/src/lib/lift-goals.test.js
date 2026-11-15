import { describe, expect, it } from 'vitest'
import { GOAL_HORIZONS, goalFor, dueDay, withGoal, goalProgress } from './lift-goals.js'
import { stampChange, mergeStates } from './sync-merge.js'

const goal = (o = {}) => ({ w: 100, u: 'kg', h: 6, d: '2026-01-10', b: 60, ...o })

describe('reading a goal', () => {
  it('returns a clean goal and nothing for a missing or broken one', () => {
    expect(goalFor({ exGoals: { a: goal() } }, 'a')).toEqual(goal())
    expect(goalFor({}, 'a')).toBeNull()
    expect(goalFor({ exGoals: { a: goal() } }, 'b')).toBeNull()
    for (const bad of [{ w: 0 }, { w: -5 }, { w: 'x' }, { w: 5000 }, { h: 4 }, { d: 'soon' }, 'text', null, []]) {
      expect(goalFor({ exGoals: { a: bad && typeof bad === 'object' && !Array.isArray(bad) ? goal(bad) : bad } }, 'a')).toBeNull()
    }
  })
  it('defaults a strange unit to kg and a missing baseline to 0', () => {
    expect(goalFor({ exGoals: { a: goal({ u: 'stone', b: undefined }) } }, 'a')).toMatchObject({ u: 'kg', b: 0 })
  })
  it('offers 3, 6 and 12 months', () => {
    expect(GOAL_HORIZONS).toEqual([3, 6, 12])
  })
})

describe('the day a goal is due', () => {
  it('adds whole months', () => {
    expect(dueDay('2026-01-10', 3)).toBe('2026-04-10')
    expect(dueDay('2026-01-10', 12)).toBe('2027-01-10')
    expect(dueDay('2026-11-15', 6)).toBe('2027-05-15')
  })
  it('lands on the last day of a shorter month', () => {
    expect(dueDay('2026-08-31', 6)).toBe('2027-02-28')
    expect(dueDay('2027-08-31', 6)).toBe('2028-02-29')
    expect(dueDay('2026-11-30', 3)).toBe('2027-02-28')
  })
})

describe('setting and clearing', () => {
  it('writes one goal per exercise and leaves the others alone', () => {
    const m = withGoal(withGoal({}, 'a', goal()), 'b', goal({ w: 50 }))
    expect(Object.keys(m)).toEqual(['a', 'b'])
    expect(withGoal(m, 'a', goal({ w: 110 })).a.w).toBe(110)
    expect(m.a.w).toBe(100)
  })
  it('removes a goal for null and tolerates a missing map', () => {
    expect(withGoal({ a: goal() }, 'a', null)).toEqual({})
    expect(withGoal(undefined, 'a', null)).toEqual({})
  })
})

describe('progress', () => {
  it('measures from where you started to the target', () => {
    const p = goalProgress(goal(), 80, 'kg', '2026-04-10')
    expect(p).toMatchObject({ target: 100, best: 80, base: 60, pct: 50, done: false, dueISO: '2026-07-10' })
  })
  it('is done at the target and beyond, and then has no weekly figure', () => {
    for (const best of [100, 105]) {
      const p = goalProgress(goal(), best, 'kg', '2026-03-01')
      expect(p).toMatchObject({ status: 'done', done: true, pct: 100, perWeek: null })
    }
  })
  it('is overdue once the day has passed without reaching it', () => {
    const p = goalProgress(goal(), 90, 'kg', '2026-07-11')
    expect(p).toMatchObject({ status: 'overdue', perWeek: null })
    expect(p.daysLeft).toBeLessThan(0)
  })
  it('is on the last day itself, not overdue yet', () => {
    expect(goalProgress(goal(), 90, 'kg', '2026-07-10')).toMatchObject({ daysLeft: 0 })
    expect(goalProgress(goal(), 90, 'kg', '2026-07-10').status).not.toBe('overdue')
  })
  it('compares your share of the climb with your share of the time', () => {
    // halfway through the six months: 2026-01-10 → 2026-07-10
    expect(goalProgress(goal(), 90, 'kg', '2026-04-10').status).toBe('ahead')   // 75 % of the climb
    expect(goalProgress(goal(), 80, 'kg', '2026-04-10').status).toBe('on')      // 50 %
    expect(goalProgress(goal(), 65, 'kg', '2026-04-10').status).toBe('behind')  // 12 %
  })
  it('says what is left to gain each week', () => {
    const p = goalProgress(goal(), 80, 'kg', '2026-06-12')   // 4 weeks left, 20 kg to go
    expect(p.perWeek).toBe(5)
  })
  it('does not ask for more than the whole gap in a last week', () => {
    expect(goalProgress(goal(), 98, 'kg', '2026-07-09').perWeek).toBe(2)
  })
  it('reads the best in another unit', () => {
    const p = goalProgress(goal(), 176, 'lb', '2026-04-10')   // 176 lb ≈ 80 kg
    expect(p.best).toBeGreaterThan(79.5)
    expect(p.best).toBeLessThan(80.5)
  })
  it('handles nothing logged and a goal below where you started', () => {
    expect(goalProgress(goal({ b: 0 }), 0, 'kg', '2026-02-01')).toMatchObject({ best: 0, pct: 0, done: false })
    expect(goalProgress(goal({ b: 120, w: 100 }), 120, 'kg', '2026-02-01')).toMatchObject({ done: true, pct: 100 })
  })
})

describe('across two devices', () => {
  const clone = o => JSON.parse(JSON.stringify(o))
  const edit = (S, fn, wall) => { const next = clone(S); fn(next); next._ts = stampChange(S, next, wall); return next }
  const base = { _ts: 1000, unit: 'kg', exGoals: {}, workouts: [], routines: [] }
  it('keeps a goal set on each device for a different exercise', () => {
    const phone = edit(base, s => { s.exGoals = withGoal(s.exGoals, 'bench', goal()) }, 3000)
    const laptop = edit(base, s => { s.exGoals = withGoal(s.exGoals, 'squat', goal({ w: 140 })) }, 5000)
    for (const [a, b] of [[phone, laptop], [laptop, phone]]) {
      expect(Object.keys(mergeStates(a, b).exGoals).sort()).toEqual(['bench', 'squat'])
    }
  })
})
