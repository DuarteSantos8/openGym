import { describe, expect, test } from 'vitest'
import { recapPeriod, recapOf, recapDue } from './recap.js'

const BENCH = '0025'
const wk = (d, n = 3, prs = []) => ({ id: 'w' + d, d, start: new Date(d + 'T10:00:00').getTime(), end: new Date(d + 'T11:00:00').getTime(), prs, entries: [{ id: BENCH, target: { mode: 'reps' }, sets: Array.from({ length: n }, () => ({ w: 100, r: 5, done: true })) }] })
const S = extra => ({ unit: 'kg', weekStart: 1, bodyweight: [], workouts: [wk('2026-10-20'), wk('2026-10-22', 3, [BENCH]), wk('2026-09-15')], ...extra })

describe('week and month recap', () => {
  test('a Monday looks back on last week, the 1st on last month, other days on nothing', () => {
    expect(recapPeriod(S(), '2026-10-26')).toEqual({ kind: 'week', from: '2026-10-19', to: '2026-10-25', key: 'w:2026-10-19' })
    expect(recapPeriod(S(), '2026-10-01')).toEqual({ kind: 'month', from: '2026-09-01', to: '2026-09-30', key: 'm:2026-09' })
    expect(recapPeriod(S(), '2026-10-28')).toBe(null)
    // a Sunday week start
    expect(recapPeriod(S({ weekStart: 0 }), '2026-10-25').kind).toBe('week')
  })
  test('the numbers are the report’s: workouts, volume, sets, PRs and the top muscle', () => {
    const r = recapOf(S(), recapPeriod(S(), '2026-10-26'), '2026-10-26')
    expect(r).toMatchObject({ kind: 'week', workouts: 2, volume: 3000, sets: 6, prs: 1, days: 2 })
    expect(r.top.slug).toBe('chest')
  })
  test('off, put away or a week without a workout: no card', () => {
    expect(recapDue(S(), '2026-10-26')).toBeTruthy()
    expect(recapDue(S({ recap: false }), '2026-10-26')).toBe(null)
    expect(recapDue(S({ recapSeen: 'w:2026-10-19' }), '2026-10-26')).toBe(null)
    expect(recapDue(S({ workouts: [] }), '2026-10-26')).toBe(null)
  })
})
