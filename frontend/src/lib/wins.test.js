import { describe, it, expect } from 'vitest'
import { firstWins, winsSummary } from './wins.js'

const S = (days, extra = {}) => ({ workouts: days.map(d => ({ d })), ...extra })
const done = s => firstWins(s).filter(w => w.done).map(w => w.id)

describe('firstWins', () => {
  it('has nothing done on an empty log, or on no profile at all', () => {
    expect(done(S([]))).toEqual([])
    expect(done(null)).toEqual([])
    expect(done({ workouts: 'nope' })).toEqual([])
    expect(firstWins(S([])).map(w => w.id)).toEqual(['first', 'two-in-week', 'five', 'two-weeks', 'ten'])
  })

  it('counts the first workout', () => {
    expect(done(S(['2026-11-02']))).toEqual(['first'])
  })

  it('needs two sessions in the same week, not just two sessions', () => {
    // Monday 2 Nov and Monday 16 Nov 2026: two weeks apart
    expect(done(S(['2026-11-02', '2026-11-16']))).toEqual(['first'])
    // Monday and Thursday of the same week
    expect(done(S(['2026-11-02', '2026-11-05']))).toEqual(['first', 'two-in-week'])
  })

  it('follows the week the profile starts on', () => {
    // Saturday 7 Nov and Sunday 8 Nov 2026: one week when it starts on Monday, two when on Sunday
    const days = ['2026-11-07', '2026-11-08']
    expect(done(S(days))).toContain('two-in-week')
    expect(done(S(days, { weekStart: 0 }))).not.toContain('two-in-week')
  })

  it('sees two weeks in a row, and not two weeks with a gap', () => {
    expect(done(S(['2026-11-02', '2026-11-09']))).toEqual(['first', 'two-weeks'])
    expect(done(S(['2026-11-02', '2026-11-16']))).toEqual(['first'])
    // across a year boundary: Monday 28 Dec 2026 and Monday 4 Jan 2027
    expect(done(S(['2026-12-28', '2027-01-04']))).toContain('two-weeks')
  })

  it('counts five and ten workouts', () => {
    const many = n => Array.from({ length: n }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`)
    expect(done(S(many(5)))).toContain('five')
    expect(done(S(many(5)))).not.toContain('ten')
    expect(done(S(many(10)))).toEqual(['first', 'two-in-week', 'five', 'two-weeks', 'ten'])
    expect(firstWins(S([])).find(w => w.id === 'five').n).toBe(5)
    expect(firstWins(S([])).find(w => w.id === 'ten').n).toBe(10)
  })

  it('skips entries without a usable date', () => {
    expect(done({ workouts: [{ d: 'yesterday' }, null, {}, { d: 20261102 }] })).toEqual([])
  })

  it('takes a win back when its workout is deleted', () => {
    const before = S(['2026-11-02', '2026-11-05'])
    expect(done(before)).toContain('two-in-week')
    expect(done(S(['2026-11-02']))).not.toContain('two-in-week')
  })
})

describe('winsSummary', () => {
  it('names the next open win, and none once all are done', () => {
    const s = winsSummary(S(['2026-11-02']))
    expect(s.done).toBe(1)
    expect(s.total).toBe(5)
    expect(s.next.id).toBe('two-in-week')
    const all = winsSummary(S(Array.from({ length: 10 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`)))
    expect(all.done).toBe(5)
    expect(all.next).toBe(null)
  })
})
