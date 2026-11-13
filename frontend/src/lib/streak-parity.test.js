// The trainer's member list (api/trainers/projections.js) and the member's own phone (lib/streak.js)
// must show the same streak. Both run api/coach/core/streak.js; these cases keep it that way.
import { describe, expect, it } from 'vitest'
import { streakInfo } from './streak.js'
import { setStreakRule } from './streak-rule.js'
import { weekKey, isoOf } from './format.js'
import { streakWeeks, summarize } from '../../../api/trainers/projections.js'
import { weekKeyOf } from '../../../api/coach/core/streak.js'

const day = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }

// A tiny seeded generator, so a failure names a profile that can be rebuilt.
function rng (seed) {
  let x = seed >>> 0 || 1
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296 }
}

describe('streak parity: server and app', () => {
  it('the server honours the rule history (the off-by-one the old copy had)', () => {
    // Generous until 12 Oct, then off. The week of 28 Sep was missed under `generous`, which had a
    // freeze banked after four trained weeks: it stays covered. Judging it by today's `off` broke it.
    const S = {
      weekStart: 1,
      workouts: ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'].map(d => ({ d })),
      streakRule: { rule: 'off', since: '2026-10-12', history: [{ rule: 'generous', since: null }] },
    }
    const app = streakInfo(S, '2026-11-05').current
    expect(app).toBe(9)
    expect(streakWeeks(S, '2026-11-05')).toBe(app)
    expect(summarize(S, { metrics: 'view' }, { today: '2026-11-05' }).streak).toBe(app)
  })

  it('a rule picked through the app counts the same on the server', () => {
    const S = { weekStart: 0, workouts: [] }
    for (let i = 20; i >= 0; i--) if (i % 5 !== 2) S.workouts.push({ d: day('2026-11-05', -7 * i) })
    setStreakRule(S, 'gentle', '2026-09-10')
    setStreakRule(S, 'off', '2026-10-20')
    expect(streakWeeks(S, '2026-11-05')).toBe(streakInfo(S, '2026-11-05').current)
  })

  it('agrees on 400 random profiles (weeks, gaps, rule switches, Sunday starts, future dates)', () => {
    const rand = rng(146)
    const rules = ['off', 'gentle', 'generous']
    for (let n = 0; n < 400; n++) {
      const today = day('2026-11-05', -Math.floor(rand() * 400))
      const S = { weekStart: rand() < 0.3 ? 0 : 1, workouts: [] }
      const span = 10 + Math.floor(rand() * 60)
      for (let i = 0; i < span * 3; i++) if (rand() < 0.45) S.workouts.push({ d: day(today, -Math.floor(rand() * span * 7) + (rand() < 0.05 ? 3 : 0)) })
      if (rand() < 0.8) {
        const picks = 1 + Math.floor(rand() * 4)
        const starts = Array.from({ length: picks }, () => day(today, -Math.floor(rand() * span * 7))).sort()
        if (rand() < 0.3) setStreakRule(S, rules[Math.floor(rand() * 3)], starts[0], { always: true })
        for (const at of starts) setStreakRule(S, rules[Math.floor(rand() * 3)], at)
      }
      const app = streakInfo(S, today).current
      const server = streakWeeks(S, today)
      if (server !== app) throw new Error(`profile ${n} on ${today}: app ${app}, server ${server}: ${JSON.stringify(S)}`)
    }
  })

  it('the shared week key matches lib/format.js on every day of two years, both week starts', () => {
    for (let i = 0; i < 730; i++) {
      const d = day('2025-01-01', i)
      expect(weekKeyOf(d, 1)).toBe(weekKey(d, 1))
      expect(weekKeyOf(d, 0)).toBe(weekKey(d, 0))
    }
  })
})
