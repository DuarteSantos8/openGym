import { describe, it, expect } from 'vitest'
import { readRecovery, recoverySessionsOf, recoveryOn, recoveryDays, withRecovery, recoveryLine, recoveryTotals, recoveryCountsStreak } from './recovery-sessions.js'
import { streakInfo } from './streak.js'

describe('recovery sessions', () => {
  it('reads a session back and refuses a broken one', () => {
    expect(readRecovery({ d: '2026-11-01', kind: 'sauna', min: '20.4', note: ' hot ' })).toEqual({ d: '2026-11-01', kind: 'sauna', min: 20, note: 'hot' })
    expect(readRecovery({ d: '2026-11-01', kind: 'lava', min: 5 }).kind).toBe('other')
    expect(readRecovery({ d: '2026-11-01', kind: 'sauna', min: 0 })).toBeNull()
    expect(readRecovery({ d: 'nope', min: 5 })).toBeNull()
    expect(readRecovery({ _ts: 3 })).toBeNull()
    expect(readRecovery({ d: '2026-11-01', min: 5000 }).min).toBe(600)
  })
  it('lists newest first and finds a day', () => {
    let m = withRecovery({}, 'a', { d: '2026-11-01', kind: 'sauna', min: 15 }, 1)
    m = withRecovery(m, 'b', { d: '2026-11-03', kind: 'cold', min: 3 }, 2)
    m = withRecovery(m, 'c', { d: '2026-11-01', kind: 'massage', min: 45 }, 3)
    const S = { recoverySessions: m }
    expect(recoverySessionsOf(S).map(r => r.id)).toEqual(['b', 'c', 'a'])
    expect(recoveryOn(S, '2026-11-01').map(r => r.kind)).toEqual(['massage', 'sauna'])
    expect([...recoveryDays(S)].sort()).toEqual(['2026-11-01', '2026-11-03'])
    expect(recoveryTotals(S, '2026-11-01', '2026-11-02')).toEqual({ sauna: 15, massage: 45 })
  })
  it('a removal is a stamped empty entry, so it syncs', () => {
    const m = withRecovery({ a: { d: '2026-11-01', kind: 'sauna', min: 15, _ts: 1 } }, 'a', null, 9)
    expect(m.a).toEqual({ _ts: 9 })
    expect(recoverySessionsOf({ recoverySessions: m })).toEqual([])
  })
  it('reads as a line', () => {
    expect(recoveryLine({ kind: 'cold', min: 3 }, (s, n) => s.replace('{0}', n))).toBe('Ice bath · 3 min')
  })
})

describe('recovery and the week streak', () => {
  // Weeks of 2026-10-12, 10-19 (sauna only), 10-26.
  const S = {
    weekStart: 1, streakRule: { rule: 'off' },
    workouts: [{ d: '2026-10-13' }, { d: '2026-10-27' }],
    recoverySessions: { s: { d: '2026-10-21', kind: 'sauna', min: 20, _ts: 1 }, x: { _ts: 2 } },
  }
  it('does not count unless the profile opted in', () => {
    expect(recoveryCountsStreak(S)).toBe(false)
    expect(streakInfo(S, '2026-10-28').current).toBe(1)
  })
  it('counts the sauna week once opted in', () => {
    const on = { ...S, recoveryStreak: true }
    expect(recoveryCountsStreak(on)).toBe(true)
    expect(streakInfo(on, '2026-10-28').current).toBe(3)
  })
})
