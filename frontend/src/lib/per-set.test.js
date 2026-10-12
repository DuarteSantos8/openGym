import { describe, expect, it } from 'vitest'
import { perSetSessions, perSetLines, dropOffSet, PER_SET_MAX } from './per-set.js'

// Issue #145: Stats → Exercise progress, one line per set number, so you can see which set
// you drop off on. A set's number is its place among that session's working sets.
const LIFT = '0025'
const done = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const workout = (t, d, ...entries) => ({ start: t, d, entries })
const entry = (sets, id = LIFT) => ({ id, sets })

describe('perSetSessions', () => {
  it('numbers the working sets of a session and reads each one\'s weight', () => {
    const ws = [workout(1, '2026-09-01', entry([done(60, 8), done(60, 8), done(55, 6)]))]
    expect(perSetSessions(ws, LIFT)).toEqual([
      { t: 1, d: '2026-09-01', sets: [{ n: 1, y: 60, w: 60, r: 8 }, { n: 2, y: 60, w: 60, r: 8 }, { n: 3, y: 55, w: 55, r: 6 }] },
    ])
  })

  it('leaves warm-ups out of the count', () => {
    const ws = [workout(1, '2026-09-01', entry([done(20, 10, { phase: 'warmup' }), done(40, 5, { warmup: true }), done(60, 8), done(57.5, 7)]))]
    expect(perSetSessions(ws, LIFT)[0].sets.map(s => [s.n, s.y])).toEqual([[1, 60], [2, 57.5]])
  })

  it('a set that was not done keeps its number, so set 4 never reads as set 3', () => {
    const ws = [workout(1, '2026-09-01', entry([done(60, 8), done(60, 8), { w: 60, r: 8, done: false }, done(50, 8)]))]
    expect(perSetSessions(ws, LIFT)[0].sets.map(s => [s.n, s.y])).toEqual([[1, 60], [2, 60], [4, 50]])
  })

  it('a per-side set is one set: its heavier done side, and the reps of both sides', () => {
    const side = (lw, rw, extraR = {}) => ({ sides: { L: done(lw, 8), R: { ...done(rw, 7), ...extraR } } })
    const ws = [workout(1, '2026-09-01', entry([side(20, 20), side(18, 22, { done: false })]))]
    expect(perSetSessions(ws, LIFT)[0].sets).toEqual([{ n: 1, y: 20, w: 20, r: 15 }, { n: 2, y: 18, w: 18, r: 8 }])
  })

  it('a drop set is plotted at its main set; the drops do not become sets of their own', () => {
    const ws = [workout(1, '2026-09-01', entry([done(60, 8), done(60, 6, { type: 'dropset', drops: [{ w: 45, r: 6 }, { w: 30, r: 8 }] })]))]
    expect(perSetSessions(ws, LIFT)[0].sets.map(s => [s.n, s.y])).toEqual([[1, 60], [2, 60]])
  })

  it('the same exercise twice in one workout keeps counting across both entries', () => {
    const ws = [workout(1, '2026-09-01', entry([done(60, 8), done(60, 8)]), entry([done(40, 12)], '0001'), entry([done(50, 10)]))]
    expect(perSetSessions(ws, LIFT)[0].sets.map(s => [s.n, s.y])).toEqual([[1, 60], [2, 60], [3, 50]])
  })

  it('reads reps instead of weight when asked, for unloaded work', () => {
    const ws = [workout(1, '2026-09-01', entry([done(0, 12), done(0, 10), done(0, 7)]))]
    expect(perSetSessions(ws, LIFT, { metric: 'reps' })[0].sets.map(s => s.y)).toEqual([12, 10, 7])
  })

  it('e1rm tells apart sets at the same weight, and skips a set too long to estimate', () => {
    // Straight sets share a weight, so a weight line per set would lie on top of each other;
    // the rep that went missing in set 3 is what this chart is for.
    const ws = [workout(1, '2026-09-01', entry([done(100, 10), done(100, 10), done(100, 8), done(60, 20)]))]
    const sets = perSetSessions(ws, LIFT, { metric: 'e1rm' })[0].sets
    expect(sets.map(s => s.n)).toEqual([1, 2, 3])
    expect(sets[0].y).toBe(sets[1].y)
    expect(sets[2].y).toBeLessThan(sets[1].y)
  })

  it('e1rm of a per-side set reads the reps of one side, not both added up', () => {
    const ws = [workout(1, '2026-09-01', entry([{ sides: { L: done(20, 8), R: done(20, 8) } }, done(20, 8)]))]
    const [a, b] = perSetSessions(ws, LIFT, { metric: 'e1rm' })[0].sets
    expect(a.y).toBe(b.y)
  })

  it('skips sessions with nothing plottable, other exercises, and timed or cardio rows', () => {
    const ws = [
      workout(1, '2026-09-01', entry([{ w: 60, r: 8, done: false }])),
      workout(2, '2026-09-02', entry([done(60, 8)], '0001')),
      workout(3, '2026-09-03', entry([{ sec: 45, done: true, mode: 'time' }])),
      workout(4, '2026-09-04', entry([done(0, 8)])),
    ]
    expect(perSetSessions(ws, LIFT)).toEqual([])
  })
})

describe('perSetLines', () => {
  const sessions = [
    { t: 1, d: '2026-09-01', sets: [{ n: 1, y: 60 }, { n: 2, y: 60 }, { n: 3, y: 55 }] },
    { t: 2, d: '2026-09-08', sets: [{ n: 1, y: 62.5 }, { n: 3, y: 57.5 }] },
  ]
  it('one line per set number, in order, each point dated by its session', () => {
    expect(perSetLines(sessions)).toEqual({
      lines: [
        { n: 1, points: [{ t: 1, y: 60, d: '2026-09-01' }, { t: 2, y: 62.5, d: '2026-09-08' }] },
        { n: 2, points: [{ t: 1, y: 60, d: '2026-09-01' }] },
        { n: 3, points: [{ t: 1, y: 55, d: '2026-09-01' }, { t: 2, y: 57.5, d: '2026-09-08' }] },
      ],
      hidden: 0,
    })
  })
  it(`draws at most ${PER_SET_MAX} lines and says how many sets were left out`, () => {
    const many = [{ t: 1, d: '2026-09-01', sets: Array.from({ length: PER_SET_MAX + 2 }, (_, i) => ({ n: i + 1, y: 50 })) }]
    const { lines, hidden } = perSetLines(many)
    expect(lines.map(l => l.n)).toEqual(Array.from({ length: PER_SET_MAX }, (_, i) => i + 1))
    expect(hidden).toBe(2)
  })
})

describe('dropOffSet', () => {
  const s = (...ys) => ({ t: 0, d: '', sets: ys.map((y, i) => ({ n: i + 1, y })) })
  it('the set that most often first falls below set 1, and in how many sessions', () => {
    expect(dropOffSet([s(60, 60, 55), s(60, 60, 57.5), s(60, 55, 55), s(60, 60, 60)])).toEqual({ n: 3, count: 2, of: 4 })
  })
  it('ties go to the earlier set', () => {
    expect(dropOffSet([s(60, 55, 55), s(60, 60, 55), s(60, 60, 60)])).toEqual({ n: 2, count: 1, of: 3 })
  })
  it('nothing to say when no session dropped, or with fewer than three sessions of two or more sets', () => {
    expect(dropOffSet([s(60, 60), s(60, 60), s(60, 60)])).toBeNull()
    expect(dropOffSet([s(60, 55), s(60, 55)])).toBeNull()
    expect(dropOffSet([s(60), s(60), s(60)])).toBeNull()
  })
  it('a session without a set 1 has nothing to compare against and is not counted', () => {
    const later = { t: 0, d: '', sets: [{ n: 2, y: 60 }, { n: 3, y: 50 }] }
    expect(dropOffSet([s(60, 60, 55), s(60, 60, 55), later, s(60, 60, 60)])).toEqual({ n: 3, count: 2, of: 3 })
  })
})
