import { describe, expect, it } from 'vitest'
import { levelFor, levelStart, pointsOf, levelOf, earnedBadges, pinnedIds, pinnedBadges, togglePin, POINTS, PIN_MAX } from './levels.js'
import { streakInfo } from './streak.js'

const weekly = n => Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(2026, 0, 5 + 7 * i, 12)); return { d: d.toISOString().slice(0, 10) } })

describe('levels', () => {
  it('each level asks a bit more than the one before', () => {
    expect([1, 2, 3, 4, 5].map(levelStart)).toEqual([0, 50, 150, 300, 500])
    expect(levelFor(0)).toMatchObject({ n: 1, need: 50 })
    expect(levelFor(149)).toMatchObject({ n: 2, into: 99, need: 1 })
    expect(levelFor(150).n).toBe(3)
    expect(levelFor(-5).n).toBe(1)
  })

  it('counts trained weeks, streak badges and challenges', () => {
    const S = { weekStart: 1, workouts: weekly(12), challenges: { '2026-02': { picked: [{ id: 'workouts', n: 4 }, { id: 'volume', n: 1 }, { id: 'new-ex', n: 1 }], done: ['workouts', 'volume', 'new-ex'], at: 1 } } }
    const info = streakInfo(S, '2026-03-25')
    const p = pointsOf(S, info)
    expect(p.weeks).toBe(12)
    expect(p.badges).toBe(2) // 4 and 12 weeks
    expect(p.challenges).toBe(3)
    expect(p.golds).toBe(1)
    expect(p.points).toBe(12 * POINTS.week + 2 * POINTS.badge + 3 * POINTS.challenge + POINTS.gold)
    expect(levelOf(S, info).n).toBe(levelFor(p.points).n)
  })

  it('is off with the Motivation module off', () => {
    expect(levelOf({ modules: { motivation: false }, workouts: weekly(3) }, null)).toBe(null)
  })
})

describe('profile badges', () => {
  const S = { weekStart: 1, workouts: weekly(13), challenges: { '2026-03': { picked: [{ id: 'workouts', n: 4 }], done: ['workouts'], at: 1 } } }
  const info = streakInfo(S, '2026-04-01')

  it('lists streak milestones first, then challenge months', () => {
    expect(earnedBadges(S, info).map(b => b.id)).toEqual(['streak-12', 'streak-4', 'month-2026-03'])
  })

  it('pins up to three, the oldest gives way, and a badge no longer earned is not shown', () => {
    let list = []
    for (const id of ['streak-4', 'streak-12', 'month-2026-03', 'streak-26']) list = togglePin({ profileBadges: list }, id)
    expect(list).toHaveLength(PIN_MAX)
    expect(list).toEqual(['streak-12', 'month-2026-03', 'streak-26'])
    expect(togglePin({ profileBadges: list }, 'streak-12')).toEqual(['month-2026-03', 'streak-26'])
    expect(pinnedBadges({ ...S, profileBadges: list }, info).map(b => b.id)).toEqual(['streak-12', 'month-2026-03'])
    expect(pinnedIds({ profileBadges: ['bogus', 'streak-4', 'streak-4', 7] })).toEqual(['streak-4'])
  })
})
