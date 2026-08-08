import { describe, it, expect } from 'vitest'
import { estimate1RM, bestSetOf, e1rmSeries, best1RM, is1RMRecord, FORMULAS } from './onerm.js'
import { stampCompletedWorkout } from './workout-model.js'

describe('estimate1RM', () => {
  it('returns the load unchanged for a single rep', () => {
    expect(estimate1RM(100, 1)).toBe(100)
    expect(estimate1RM(62.5, 1)).toBe(62.5)
  })

  it('matches Epley by hand across the usual rep ranges', () => {
    expect(estimate1RM(100, 5)).toBe(116.7)   // 100 · (1 + 5/30)
    expect(estimate1RM(100, 10)).toBe(133.3)
    expect(estimate1RM(80, 8)).toBe(101.3)
    expect(estimate1RM(60, 3)).toBe(66)
  })

  it('rounds to one decimal', () => {
    expect(estimate1RM(101.25, 7)).toBe(124.9)
    expect(Number.isInteger(estimate1RM(100, 3) * 10)).toBe(true)
  })

  it('keeps valid high-repetition inputs usable instead of applying an unrelated target cap', () => {
    expect(estimate1RM(100, 12)).toBe(140)
    expect(estimate1RM(100, 13)).toBe(143.3)
    expect(estimate1RM(60, 30)).toBe(120)
  })

  it('rejects invalid, zero and negative input', () => {
    expect(estimate1RM(0, 5)).toBeNull()
    expect(estimate1RM(-100, 5)).toBeNull()
    expect(estimate1RM(100, 0)).toBeNull()
    expect(estimate1RM(100, -3)).toBeNull()
    expect(estimate1RM(undefined, 5)).toBeNull()
    expect(estimate1RM(100, undefined)).toBeNull()
    expect(estimate1RM(NaN, 5)).toBeNull()
    expect(estimate1RM(Infinity, 5)).toBeNull()
    expect(estimate1RM('', '')).toBeNull()
  })

  it('accepts numeric strings, the shape number inputs arrive in', () => {
    expect(estimate1RM('100', '5')).toBe(116.7)
  })

  it('offers the other documented formulas and agrees with them at low reps', () => {
    expect(estimate1RM(100, 5, 'brzycki')).toBe(112.5)
    expect(estimate1RM(100, 5, 'lombardi')).toBe(117.5)
    expect(Object.keys(FORMULAS)).toContain('epley')
  })

  it('keeps the formulas within a few percent up to 8 reps, and diverges most at the cap', () => {
    const spread = r => Math.max(...Object.keys(FORMULAS).map(f => estimate1RM(100, r, f)))
      - Math.min(...Object.keys(FORMULAS).map(f => estimate1RM(100, r, f)))
    expect(spread(1)).toBe(0)                       // one rep is measured, not estimated
    for (let r = 2; r <= 8; r++) expect(spread(r)).toBeLessThan(6)
    const upTo = []
    for (let r = 1; r < 12; r++) upTo.push(spread(r))
    expect(spread(12)).toBeGreaterThan(Math.max(...upTo))
  })

  it('falls back to the default for an unknown formula name', () => {
    expect(estimate1RM(100, 5, 'nope')).toBe(estimate1RM(100, 5))
  })
})

describe('bestSetOf', () => {
  it('picks the highest estimate, not the heaviest set', () => {
    const entry = { id: 'x', sets: [
      { w: 100, r: 5, done: true },   // 116.7
      { w: 110, r: 3, done: true },   // 121.0
      { w: 120, r: 1, done: true }    // 120.0
    ] }
    expect(bestSetOf(entry)).toEqual({ est: 121, w: 110, r: 3 })
  })

  it('ignores sets that were never checked off', () => {
    const entry = { id: 'x', sets: [{ w: 100, r: 5, done: true }, { w: 200, r: 5, done: false }] }
    expect(bestSetOf(entry).w).toBe(100)
  })

  it('excludes explicitly marked warm-up sets from estimated 1RM', () => {
    const entry = { id: 'x', sets: [
      { phase: 'warmup', w: 200, r: 5, done: true },
      { phase: 'work', w: 100, r: 5, done: true }
    ] }
    expect(bestSetOf(entry)).toEqual({ est: 116.7, w: 100, r: 5 })
  })

  it('ignores topW, which carries no rep count', () => {
    const entry = { id: 'x', topW: 200, sets: [{ w: 100, r: 5, done: true }] }
    expect(bestSetOf(entry).est).toBe(116.7)
  })

  it('returns null for cardio and timed entries', () => {
    expect(bestSetOf({ id: 'c', sets: [{ min: 20, speed: 9, done: true }] })).toBeNull()
    expect(bestSetOf({ id: 'p', sets: [{ sec: 60, w: 0, done: true }] })).toBeNull()
    expect(bestSetOf({ id: 'p', sets: [{ sec: 60, w: 20, done: true }] })).toBeNull()
  })

  it('rejects a legacy timed set even when a stale reps field is present', () => {
    expect(bestSetOf({ id: 'p', sets: [{ sec: 60, w: 200, r: 5, done: true }] })).toBeNull()
    expect(bestSetOf({ id: 'p', target: { mode: 'time', sec: 45 }, sets: [{ sec: 60, w: 200, r: 5, done: true }] })).toBeNull()
  })

  it('rejects rep-shaped rows when the persisted target is explicitly timed', () => {
    expect(bestSetOf({ id: 'p', target: { mode: 'time', sec: 45 }, sets: [
      { w: 200, r: 5, done: true }
    ] })).toBeNull()
  })

  it('rejects a mixed-mode entry instead of deriving 1RM from reps beside timed work', () => {
    const entry = { id: 'mixed', target: { mode: 'reps' }, sets: [
      { mode: 'reps', w: 100, r: 5, done: true },
      { mode: 'time', sec: 45, w: 20, done: true }
    ] }
    expect(bestSetOf(entry)).toBeNull()
  })

  it('keeps mixed-mode 1RM rejection when explicit reps work sits under a timed parent', () => {
    const entry = { id: 'mixed-timed-parent', target: { mode: 'time', sec: 45 }, sets: [
      { phase: 'work', mode: 'reps', w: 100, r: 5, done: true },
      { phase: 'work', mode: 'time', sec: 45, w: 200, done: true }
    ] }
    expect(bestSetOf(entry)).toBeNull()
  })

  it('survives a missing or empty entry', () => {
    expect(bestSetOf(null)).toBeNull()
    expect(bestSetOf({ sets: [] })).toBeNull()
  })

  it('includes a completed high-rep AMRAP result in the unit-compatible 1RM series', () => {
    const state = {
      unit: 'kg',
      workouts: [{ unit: 'kg', d: '2026-02-01', start: 1, entries: [{ id: 'bench',
        target: { mode: 'reps', kind: 'amrap', amrapMinReps: 5 },
        sets: [{ unit: 'kg', phase: 'work', w: 60, r: 15, done: true }]
      }] }]
    }
    expect(e1rmSeries(state, 'bench')).toEqual([{ t: 1, d: '2026-02-01', y: 90, w: 60, r: 15 }])
  })
})

const S = {
  workouts: [
    { d: '2026-01-01', start: 1, entries: [{ id: 'bench', sets: [{ w: 80, r: 5, done: true }] }] },
    { d: '2026-01-08', start: 2, entries: [{ id: 'squat', sets: [{ w: 100, r: 5, done: true }] }] },
    { d: '2026-01-15', start: 3, entries: [{ id: 'bench', sets: [{ w: 90, r: 5, done: true }, { w: 90, r: 3, done: false }] }] },
    { d: '2026-01-22', start: 4, entries: [{ id: 'bench', sets: [{ w: 85, r: 5, done: true }] }] },
    { d: '2026-01-29', start: 5, entries: [{ id: 'run', sets: [{ min: 30, speed: 10, done: true }] }] }
  ]
}

describe('e1rmSeries / best1RM', () => {
  it('yields one chronological point per workout that produced an estimate', () => {
    const pts = e1rmSeries(S, 'bench')
    expect(pts.map(p => p.d)).toEqual(['2026-01-01', '2026-01-15', '2026-01-22'])
    expect(pts.map(p => p.y)).toEqual([93.3, 105, 99.2])
  })

  it('reports the all-time best with the set behind it', () => {
    expect(best1RM(S, 'bench')).toEqual({ est: 105, w: 90, r: 5, d: '2026-01-15', t: 3 })
  })

  it('has nothing to say about cardio or an unknown exercise', () => {
    expect(e1rmSeries(S, 'run')).toEqual([])
    expect(best1RM(S, 'run')).toBeNull()
    expect(best1RM(S, 'nope')).toBeNull()
    expect(best1RM({ workouts: [] }, 'bench')).toBeNull()
    expect(best1RM({}, 'bench')).toBeNull()
  })
})

describe('is1RMRecord', () => {
  it('flags a session that beats every previous estimate', () => {
    const rec = is1RMRecord(S, 'bench', { id: 'bench', sets: [{ w: 95, r: 5, done: true }] })
    expect(rec).toEqual({ est: 110.8, w: 95, r: 5, prev: 105 })
  })

  it('stays quiet when the session does not beat the record', () => {
    expect(is1RMRecord(S, 'bench', { id: 'bench', sets: [{ w: 90, r: 5, done: true }] })).toBeNull()
    expect(is1RMRecord(S, 'bench', { id: 'bench', sets: [{ w: 80, r: 5, done: true }] })).toBeNull()
  })

  it('counts the first ever estimate as a record', () => {
    const rec = is1RMRecord(S, 'deadlift', { id: 'deadlift', sets: [{ w: 140, r: 3, done: true }] })
    expect(rec.prev).toBe(0)
    expect(rec.est).toBe(154)
  })

  it('says nothing for a timed or unfinished entry', () => {
    expect(is1RMRecord(S, 'plank', { id: 'plank', sets: [{ sec: 90, done: true }] })).toBeNull()
    expect(is1RMRecord(S, 'bench', { id: 'bench', sets: [{ w: 200, r: 5, done: false }] })).toBeNull()
  })

  it('accepts a non-mutating current-unit completion clone and rejects an incompatible clone', () => {
    const activeEntry = { id: 'bench', target: { mode: 'reps' }, sets: [
      { phase: 'work', w: 60, r: 5, done: true }
    ] }
    const raw = JSON.parse(JSON.stringify(activeEntry))
    const currentUnit = { unit: 'kg', workouts: [] }
    const kgEntry = stampCompletedWorkout({ entries: [activeEntry] }, 'kg').entries[0]
    const lbEntry = stampCompletedWorkout({ entries: [activeEntry] }, 'lb').entries[0]

    expect(kgEntry.sets[0].unit).toBe('kg')
    expect(is1RMRecord(currentUnit, 'bench', kgEntry)).toEqual({ est: 70, w: 60, r: 5, prev: 0 })
    expect(is1RMRecord(currentUnit, 'bench', lbEntry)).toBeNull()
    expect(activeEntry).toEqual(raw)
  })
})
