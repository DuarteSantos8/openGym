import { describe, expect, it } from 'vitest'
import { legacySyncKey, startTimeOf, sameWorkout, retimeWorkout, rebuildPrHistory, moveWorkout } from './workout-date.js'
import { backfillStart } from './backfill.js'

const set = w => ({ w, r: 5, done: true })
const entry = (id, w) => ({ id, sets: [set(w)] })
// A session on `d` starting at `time`, lasting `min` minutes.
const w = (id, d, time, min, entries = [], prs = []) => {
  const start = backfillStart(d, time)
  return { id, d, start, end: start + min * 60000, name: id, entries, prs }
}

describe('startTimeOf', () => {
  it('reads back the wall-clock time backfillStart wrote', () => {
    expect(startTimeOf({ start: backfillStart('2026-03-10', '07:45') })).toBe('07:45')
    expect(startTimeOf({ start: backfillStart('2026-03-10', '18:00') })).toBe('18:00')
  })
  it('pads and survives a missing start', () => {
    expect(startTimeOf({ start: backfillStart('2026-03-10', '06:05') })).toBe('06:05')
    expect(startTimeOf({})).toMatch(/^\d\d:\d\d$/)
  })
})

describe('sameWorkout / legacySyncKey', () => {
  it('matches on id when either side has one', () => {
    expect(sameWorkout({ id: 'a' }, { id: 'a' })).toBe(true)
    expect(sameWorkout({ id: 'a' }, { id: 'b' })).toBe(false)
    expect(sameWorkout({ id: 'a', d: '2026-01-01', start: 1 }, { d: '2026-01-01', start: 1 })).toBe(false)
  })
  it('falls back to day and start for records written before ids', () => {
    expect(sameWorkout({ d: '2026-01-01', start: 5 }, { d: '2026-01-01', start: 5 })).toBe(true)
    expect(sameWorkout({ d: '2026-01-01', start: 5 }, { d: '2026-01-02', start: 5 })).toBe(false)
    expect(legacySyncKey({ d: '2026-01-01', start: 5 })).toBe('2026-01-01|5')
  })
})

describe('retimeWorkout', () => {
  it('moves the session and keeps the length it had', () => {
    const moved = retimeWorkout(w('a', '2026-03-10', '18:00', 47), '2026-02-01', '07:30')
    expect(moved.d).toBe('2026-02-01')
    expect(startTimeOf(moved)).toBe('07:30')
    expect(moved.end - moved.start).toBe(47 * 60000)
  })
  it('leaves everything else alone and does not mutate the input', () => {
    const before = w('a', '2026-03-10', '18:00', 60, [entry('bench', 100)], ['bench'])
    const copy = JSON.parse(JSON.stringify(before))
    const moved = retimeWorkout(before, '2026-02-01', '07:30')
    expect(before).toEqual(copy)
    expect(moved.entries).toBe(before.entries)
    expect(moved.prs).toEqual(['bench'])
    expect(moved.name).toBe('a')
  })
  it('a zero-length record stays zero-length', () => {
    const moved = retimeWorkout({ id: 'a', d: '2026-03-10', start: 10, end: 10 }, '2026-02-01', '07:30')
    expect(moved.end).toBe(moved.start)
  })
  it('an end before the start cannot make the session run backwards', () => {
    const moved = retimeWorkout({ id: 'a', d: '2026-03-10', start: 100, end: 50 }, '2026-02-01', '07:30')
    expect(moved.end).toBe(moved.start)
  })
  it('a record with no end keeps a zero length rather than NaN', () => {
    const moved = retimeWorkout({ id: 'a', d: '2026-03-10', start: 100 }, '2026-02-01', '07:30')
    expect(moved.end).toBe(moved.start)
  })
  // The sync key of a legacy record is its day and start time, which is what this edit
  // changes. Freezing the old key as the id is what stops the merge duplicating it.
  it('gives a legacy record the old day-and-start as its id', () => {
    const moved = retimeWorkout({ d: '2026-03-10', start: 1741626000000, end: 1741626000000, entries: [] }, '2026-02-01', '07:30')
    expect(moved.id).toBe('2026-03-10|1741626000000')
  })
  it('never rewrites an id it already has', () => {
    expect(retimeWorkout(w('keep', '2026-03-10', '18:00', 60), '2026-02-01', '07:30').id).toBe('keep')
  })
})

describe('rebuildPrHistory', () => {
  it('gives the moved session the badge when it is now the first to hit a weight', () => {
    // Logged heavy-first, so the 90 kg session never claimed a record.
    const heavy = w('heavy', '2026-01-05', '18:00', 60, [entry('bench', 100)], ['bench'])
    const light = w('light', '2026-01-09', '18:00', 60, [entry('bench', 90)], [])
    // The light one is moved to before the heavy one; it is now the first 90 kg ever.
    const out = rebuildPrHistory([light, heavy], ['bench'], light)
    expect(out.map(x => x.prs)).toEqual([['bench'], ['bench']])
  })
  it('takes the badge away from a session that no longer leads', () => {
    const stale = w('b', '2026-01-05', '18:00', 60, [entry('bench', 90)], ['bench'])
    const out = rebuildPrHistory([
      w('a', '2026-01-01', '18:00', 60, [entry('bench', 100)], ['bench']),
      stale,
    ], ['bench'])
    expect(out.map(x => x.prs)).toEqual([['bench'], []])
  })
  it('takes it away from the moved session too when it no longer leads', () => {
    const moved = w('moved', '2026-01-05', '18:00', 60, [entry('bench', 80)], ['bench'])
    const out = rebuildPrHistory([
      w('a', '2026-01-01', '18:00', 60, [entry('bench', 100)], ['bench']),
      moved,
    ], ['bench'], moved)
    expect(out.map(x => x.prs)).toEqual([['bench'], []])
  })
  // Imports and backfilled sessions are filed with no badges on purpose. Rebuilding by pure
  // chronology would hand a year of imported history trophies it never had.
  it('never hands a badge to a session that did not move', () => {
    const moved = w('mine', '2026-02-01', '18:00', 60, [entry('bench', 120)], ['bench'])
    const out = rebuildPrHistory([
      w('imported-1', '2026-01-01', '18:00', 60, [entry('bench', 70)], []),
      w('imported-2', '2026-01-08', '18:00', 60, [entry('bench', 80)], []),
      moved,
    ], ['bench'], moved)
    expect(out.map(x => [x.id, x.prs])).toEqual([['imported-1', []], ['imported-2', []], ['mine', ['bench']]])
  })
  it('a moved session does not gain a badge on an exercise it does not lead', () => {
    const moved = w('moved', '2026-01-08', '18:00', 60, [entry('bench', 60)], [])
    const out = rebuildPrHistory([
      w('imported', '2026-01-01', '18:00', 60, [entry('bench', 80)], []),
      moved,
    ], ['bench'], moved)
    expect(out.map(x => x.prs)).toEqual([[], []])
  })
  it('keeps the badges of exercises it was not asked about', () => {
    const later = w('b', '2026-01-05', '18:00', 60, [entry('bench', 90), entry('squat', 150)], ['squat'])
    const out = rebuildPrHistory([
      w('a', '2026-01-01', '18:00', 60, [entry('bench', 100), entry('squat', 140)], ['bench', 'squat']),
      later,
    ], ['bench'], later)
    expect(out[0].prs).toEqual(['squat', 'bench'])
    expect(out[1].prs).toEqual(['squat'])
  })
  it('leaves a session that does not train the exercise untouched', () => {
    const moved = w('b', '2026-01-05', '18:00', 60, [entry('bench', 90)], [])
    const list = [w('a', '2026-01-01', '18:00', 60, [entry('squat', 140)], ['squat']), moved]
    const out = rebuildPrHistory(list, ['bench'], moved)
    expect(out[0]).toBe(list[0])
    expect(out[1].prs).toEqual(['bench'])
  })
  it('an unloaded or cardio entry is never a record', () => {
    const moved = w('b', '2026-01-05', '18:00', 60, [entry('pullup', 0)], [])
    const out = rebuildPrHistory([
      w('a', '2026-01-01', '18:00', 60, [entry('pullup', 0)], []),
      moved,
    ], ['pullup'], moved)
    expect(out.map(x => x.prs)).toEqual([[], []])
  })
  it('equalling a weight is not a new record', () => {
    const moved = w('b', '2026-01-05', '18:00', 60, [entry('bench', 100)], [])
    const out = rebuildPrHistory([
      w('a', '2026-01-01', '18:00', 60, [entry('bench', 100)], ['bench']),
      moved,
    ], ['bench'], moved)
    expect(out.map(x => x.prs)).toEqual([['bench'], []])
  })
  it('a session that cannot gain a badge still raises the bar for the next', () => {
    // The imported 100 kg carries no badge, and must still stop the mover claiming 90 kg.
    const moved = w('moved', '2026-01-08', '18:00', 60, [entry('bench', 90)], [])
    const out = rebuildPrHistory([
      w('imported', '2026-01-01', '18:00', 60, [entry('bench', 100)], []),
      moved,
    ], ['bench'], moved)
    expect(out.map(x => x.prs)).toEqual([[], []])
  })
  it('does nothing without exercises and never mutates the input', () => {
    const list = [w('a', '2026-01-01', '18:00', 60, [entry('bench', 100)], ['bench'])]
    expect(rebuildPrHistory(list, [])).toBe(list)
    const copy = JSON.parse(JSON.stringify(list))
    rebuildPrHistory(list, ['bench'], list[0])
    expect(list).toEqual(copy)
  })
})

describe('moveWorkout', () => {
  const list = () => [
    w('a', '2026-01-01', '18:00', 60, [entry('bench', 80)], ['bench']),
    w('b', '2026-01-05', '18:00', 60, [entry('bench', 100)], ['bench']),
    w('c', '2026-01-09', '18:00', 60, [entry('bench', 90)], []),
  ]
  it('re-files the session in date order', () => {
    const out = moveWorkout(list(), { id: 'c' }, '2026-01-03', '07:00')
    expect(out.map(x => x.id)).toEqual(['a', 'c', 'b'])
  })
  it('rebuilds the badges of every exercise the session trained', () => {
    // 90 kg on 2026-01-03 beats the 80 kg before it, and the 100 kg session still leads.
    const out = moveWorkout(list(), { id: 'c' }, '2026-01-03', '07:00')
    expect(out.map(x => [x.id, x.prs])).toEqual([['a', ['bench']], ['c', ['bench']], ['b', ['bench']]])
  })
  it('a session left where it is never gains a badge from someone else moving', () => {
    // 'c' (90 kg, no badge) moves to the front. 'a' (80 kg) now trails it and loses its badge;
    // nothing that stayed put is handed one.
    const out = moveWorkout(list(), { id: 'c' }, '2025-12-31', '07:00')
    expect(out.map(x => [x.id, x.prs])).toEqual([['c', ['bench']], ['a', []], ['b', ['bench']]])
  })
  it('a session moved after a heavier one loses its badge', () => {
    const out = moveWorkout(list(), { id: 'a' }, '2026-01-07', '07:00')
    expect(out.map(x => [x.id, x.prs])).toEqual([['b', ['bench']], ['a', []], ['c', []]])
  })
  it('places the session by start time within the day it lands on', () => {
    const out = moveWorkout(list(), { id: 'c' }, '2026-01-05', '07:00')
    expect(out.map(x => x.id)).toEqual(['a', 'c', 'b'])
    expect(moveWorkout(list(), { id: 'c' }, '2026-01-05', '21:00').map(x => x.id)).toEqual(['a', 'b', 'c'])
  })
  it('returns null when the workout is not there', () => {
    expect(moveWorkout(list(), { id: 'zz' }, '2026-01-03', '07:00')).toBe(null)
    expect(moveWorkout(undefined, { id: 'a' }, '2026-01-03', '07:00')).toBe(null)
  })
  it('does not mutate the history it was given', () => {
    const before = list()
    const copy = JSON.parse(JSON.stringify(before))
    moveWorkout(before, { id: 'c' }, '2026-01-03', '07:00')
    expect(before).toEqual(copy)
  })
  it('moves a legacy record and leaves its twin no way to come back', () => {
    const legacy = { d: '2026-01-05', start: 1767636000000, end: 1767639600000, name: 'Old', entries: [], prs: [] }
    const out = moveWorkout([legacy], legacy, '2026-01-03', '07:00')
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('2026-01-05|1767636000000')
    expect(out[0].d).toBe('2026-01-03')
  })
})
